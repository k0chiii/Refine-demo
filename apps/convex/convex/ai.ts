import { loadAuthorizedWork, resolveRulesForWork } from "@mf100/application";
import {
  aiBlockReason,
  DomainError,
  isAllowed,
  placeAiCandidates,
  type Finding,
  type Principal,
} from "@mf100/domain";
import { v } from "convex/values";
import { RateLimiter, MINUTE, DAY } from "@convex-dev/rate-limiter";
import { components, internal } from "./_generated/api";
import {
  action,
  internalMutation,
  internalQuery,
  query,
  type MutationCtx,
} from "./_generated/server";
import { aiConfig, createProvider } from "./lib/ai/provider.ts";
import { createAppContext, createReadContext } from "./lib/adapters.ts";
import { runUseCase } from "./lib/errors.ts";
import { requireUser } from "./lib/principal.ts";

/**
 * 任意の AI 校正（外部への送信）。キーが無い・無効・機密区分で禁止のときは使えない（理由を返す）。
 * 利用者が明示的に押したときだけ動き、結果は候補だけを返す（保存しない・ルールを変えない）。
 */
export const status = query({
  args: { workId: v.string() },
  handler: async (ctx, { workId }) => {
    const { principal } = await requireUser(ctx);
    const config = aiConfig();
    return runUseCase(async () => {
      const { work } = await loadAuthorizedWork(
        createReadContext(ctx.db),
        principal,
        workId,
        "work.view",
      );
      const reason = aiBlockReason(config.policy);
      return {
        available: reason === null,
        reason,
        provider:
          config.provider === "anthropic"
            ? "Anthropic"
            : config.provider === "workers-ai"
              ? "Workers AI"
              : config.provider,
        maxChars: config.policy.maxChars,
        semanticSearch: process.env.RULE_EMBEDDINGS_ENABLED === "true",
      };
    });
  },
});

/** 送ってよいかの確認とルールの取得（action から呼ぶ。認証は呼び出し元のものが引き継がれる） */
export const prepare = internalQuery({
  args: { workId: v.string() },
  handler: async (ctx, { workId }) => {
    const { principal } = await requireUser(ctx);
    return runUseCase(async () => {
      const app = createReadContext(ctx.db);
      const { work, grants } = await loadAuthorizedWork(app, principal, workId, "work.view");
      const authz = { work, grants, principal };
      if (!isAllowed("revision.submit", authz) && !isAllowed("review.participate", authz))
        throw new DomainError("forbidden", { reason: "ai_not_allowed" });
      const reason = aiBlockReason(aiConfig().policy);
      const set = await resolveRulesForWork(app, principal, workId);
      return {
        userId: principal.userId,
        blocked: reason,
        rules: set.rules.map((r) => ({
          ruleId: r.ruleId,
          revision: r.revision,
          title: r.title,
          correct: r.correct,
          incorrect: r.incorrect,
          description: r.description,
        })),
      };
    });
  },
});

export const recordUse = internalMutation({
  args: {
    workId: v.string(),
    userId: v.string(),
    chars: v.number(),
    provider: v.string(),
    model: v.string(),
    candidates: v.number(),
  },
  handler: async (ctx, args) => {
    await createAppContext(ctx).audit.record({
      entityType: "work",
      entityId: args.workId,
      operation: "ai_proofread",
      actorId: args.userId,
      after: {
        chars: args.chars,
        provider: args.provider,
        model: args.model,
        candidates: args.candidates,
      },
      at: Date.now(),
    });
  },
});

/** Quota is consumed before external work and retained on provider failure (no automatic retry). */
const limiter = new RateLimiter(components.rateLimiter, {
  aiUser: { kind: "token bucket", rate: 6, period: MINUTE, capacity: 2 },
  aiWork: { kind: "token bucket", rate: 12, period: MINUTE, capacity: 3 },
  aiCharacters: { kind: "fixed window", rate: 200_000, period: DAY },
});
export const reserve = internalMutation({
  args: { workId: v.string(), chars: v.number() },
  handler: async (ctx, { workId, chars }) => {
    const { principal } = await requireUser(ctx);
    return reserveAi(ctx, principal, workId, chars);
  },
});

interface ProofreadResult {
  candidates: Finding[];
  provider: string;
  model: string;
  blocked: string | null;
}

export const proofread = action({
  args: { workId: v.string(), text: v.string() },
  handler: async (ctx, { workId, text }): Promise<ProofreadResult> => {
    const config = aiConfig();
    const prep: {
      userId: string;
      blocked: string | null;
      rules: Array<{
        ruleId: string;
        revision: number;
        title: string;
        correct: string[];
        incorrect: string[];
        description: string;
      }>;
    } = await ctx.runQuery(internal.ai.prepare, { workId });
    if (prep.blocked) return { candidates: [], provider: "", model: "", blocked: prep.blocked };
    if (text.length > config.policy.maxChars)
      return {
        candidates: [],
        provider: "",
        model: "",
        blocked: `AI に送れるのは ${config.policy.maxChars} 文字までです（${text.length} 文字）`,
      };
    if (!text.trim()) return { candidates: [], provider: "", model: "", blocked: null };
    const quota = await ctx.runMutation(internal.ai.reserve, { workId, chars: text.length });
    if (!quota.ok)
      return {
        candidates: [],
        provider: "",
        model: "",
        blocked: quota.blocked ?? "AI の利用上限に達しました。時間をおいて再試行してください",
      };
    const provider = await createProvider(config);
    const raw = await provider.proofread({ text, rules: prep.rules });
    // 候補を本文に当てはめて確かめる（本文に無いものは捨てる）
    const candidates = placeAiCandidates(
      text,
      raw,
      new Map(prep.rules.map((r) => [r.ruleId, r.revision])),
    );
    await ctx.runMutation(internal.ai.recordUse, {
      workId,
      userId: prep.userId,
      chars: text.length,
      provider: provider.name,
      model: provider.model,
      candidates: candidates.length,
    });
    return { candidates, provider: provider.name, model: provider.model, blocked: null };
  },
});

export async function reserveAi(
  ctx: MutationCtx,
  principal: Principal,
  workId: string,
  chars: number,
) {
  const { work } = await loadAuthorizedWork(
    createReadContext(ctx.db),
    principal,
    workId,
    "review.participate",
  );
  const blocked = aiBlockReason(aiConfig().policy);
  if (blocked) return { ok: false, retryAfter: 0, blocked };
  if (!Number.isInteger(chars) || chars < 1 || chars > aiConfig().policy.maxChars)
    throw new DomainError("forbidden");
  const requests = [
    { name: "aiUser" as const, key: principal.userId, count: 1 },
    { name: "aiWork" as const, key: workId, count: 1 },
    { name: "aiCharacters" as const, key: principal.userId, count: chars },
  ];
  for (const { name, ...options } of requests) {
    const status = await limiter.check(ctx, name, options);
    if (!status.ok) return { ok: false, retryAfter: status.retryAfter ?? 0 };
  }
  for (const { name, ...options } of requests) await limiter.limit(ctx, name, options);
  return { ok: true, retryAfter: 0 };
}
