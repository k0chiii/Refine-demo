import { v } from "convex/values";
import { action, internalAction, internalMutation, internalQuery } from "./_generated/server";
import { internal } from "./_generated/api";
import { aiConfig } from "./lib/ai/provider";

export async function embed(text: string): Promise<number[]> {
  const endpoint = process.env.WORKERS_AI_URL;
  const secret = process.env.WORKERS_AI_SECRET;
  if (process.env.RULE_EMBEDDINGS_ENABLED !== "true" || !endpoint || !secret || secret.length < 32)
    throw new Error("semantic_search_disabled");
  const url = new URL(endpoint);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== "/internal/ai/proofread"
  )
    throw new Error("invalid_workers_ai_url");
  url.pathname = "/internal/ai/embed";
  const response = await fetch(url, {
    method: "POST",
    redirect: "error",
    signal: AbortSignal.timeout(60_000),
    headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  });
  if (!response.ok) throw new Error("embedding_failed");
  const { vector } = (await response.json()) as { vector: number[] };
  if (
    !Array.isArray(vector) ||
    vector.length !== 1024 ||
    !vector.every((n) => typeof n === "number" && Number.isFinite(n))
  )
    throw new Error("invalid_embedding");
  return vector;
}
export const current = internalQuery({
  args: { ruleId: v.string() },
  handler: (ctx, args) =>
    ctx.db
      .query("notationRules")
      .withIndex("by_ruleId", (q) => q.eq("ruleId", args.ruleId))
      .unique(),
});
export const store = internalMutation({
  args: { ruleId: v.string(), revision: v.number(), vector: v.array(v.number()) },
  handler: async (ctx, args) => {
    const rule = await ctx.db
      .query("notationRules")
      .withIndex("by_ruleId", (q) => q.eq("ruleId", args.ruleId))
      .unique();
    if (!rule || rule.revision !== args.revision || !rule.enabled) return;
    if (args.vector.length !== 1024 || !args.vector.every(Number.isFinite))
      throw new Error("invalid_embedding");
    const existing = await ctx.db
      .query("ruleEmbeddings")
      .withIndex("by_rule", (q) => q.eq("ruleId", args.ruleId))
      .unique();
    const value = { ...args, model: "@cf/baai/bge-m3" };
    if (existing) await ctx.db.replace(existing._id, value);
    else await ctx.db.insert("ruleEmbeddings", value);
  },
});
export const indexRule = internalAction({
  args: { ruleId: v.string() },
  handler: async (ctx, args): Promise<void> => {
    if (process.env.RULE_EMBEDDINGS_ENABLED !== "true") return;
    const rule = await ctx.runQuery(internal.semanticRules.current, args);
    if (!rule || !rule.enabled) return;
    const vector = await embed(
      `${rule.title}\n${rule.correct.join(" / ")}\n${rule.incorrect.join(" / ")}\n${rule.description}`,
    );
    await ctx.runMutation(internal.semanticRules.store, {
      ruleId: rule.ruleId,
      revision: rule.revision,
      vector,
    });
  },
});
type SearchRule = {
  ruleId: string;
  revision: number;
  title: string;
  correct: string[];
  incorrect: string[];
  description: string;
};
export const resolve = internalQuery({
  args: { workId: v.string(), ids: v.array(v.id("ruleEmbeddings")) },
  handler: async (ctx, args): Promise<SearchRule[]> => {
    // ai.prepare checks the current ACL, allowed categories, rule revisions and external-send policy again.
    const prepared = await ctx.runQuery(internal.ai.prepare, { workId: args.workId });
    if (prepared.blocked) throw new Error("ai_unavailable");
    const rules = new Map(prepared.rules.map((r) => [r.ruleId, r]));
    const result = [];
    for (const id of args.ids.slice(0, 20)) {
      const row = await ctx.db.get(id);
      const rule = row ? rules.get(row.ruleId) : null;
      if (row && rule && rule.revision === row.revision && row.model === "@cf/baai/bge-m3")
        result.push(rule);
    }
    return result;
  },
});
export const search = action({
  args: { workId: v.string(), text: v.string(), consentToExternalSend: v.boolean() },
  handler: async (
    ctx,
    args,
  ): Promise<
    Array<{
      ruleId: string;
      revision: number;
      title: string;
      correct: string[];
      incorrect: string[];
      description: string;
    }>
  > => {
    if (
      !args.consentToExternalSend ||
      !args.text.trim() ||
      args.text.length > aiConfig().policy.maxChars
    )
      throw new Error("invalid_search");
    const prepared = await ctx.runQuery(internal.ai.prepare, { workId: args.workId });
    if (prepared.blocked) throw new Error("ai_unavailable");
    const reserved = await ctx.runMutation(internal.ai.reserve, {
      workId: args.workId,
      chars: args.text.length,
    });
    if (!reserved.ok) throw new Error("ai_quota_exceeded");
    const vector = await embed(args.text);
    const hits = await ctx.vectorSearch("ruleEmbeddings", "by_vector", { vector, limit: 20 });
    return ctx.runQuery(internal.semanticRules.resolve, {
      workId: args.workId,
      ids: hits.map((h) => h._id),
    });
  },
});
