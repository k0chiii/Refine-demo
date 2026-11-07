import type { AppContext } from "@mf100/application";
import { z } from "zod";
import { cosine, embed, EMBEDDING_MODEL, isVector } from "../ai/embed.ts";
import { aiConfig, type Fetch } from "../ai/provider.ts";
import { Rows } from "../sqlite/docs.ts";
import type { Sql } from "../sqlite/sql.ts";
import { prepareAi, reserveAi, type PreparedAi } from "./ai.ts";
import { action, reject, type FnDef } from "./define.ts";
import { object } from "./validators.ts";

// apps/convex/convex/semanticRules.ts の写し。ルールの意味検索（本文の言い回しに近いルールを引く）。
// 埋め込みは RULE_EMBEDDINGS_ENABLED=true のとき、ルールの保存で積まれる indexRule の仕事（src/jobs.ts）が作る

/** ruleEmbeddings の doc。id は ruleId（1 ルール 1 行）。Convex の schema.ts の項目に、書いた時刻を足した */
interface RuleEmbedding {
  id: string;
  ruleId: string;
  revision: number;
  vector: number[];
  model: string;
  updatedAt: number;
}

/** 上位から返す件数（Convex の vectorSearch の limit） */
const SEARCH_LIMIT = 20;

/**
 * kind `indexRule` の本体（Convex の indexRule + store）。有効なルールだけ。
 * 送っている間にルールが変わっていたら、古い版の埋め込みは書かない（DO は fetch の間に別の呼び出しを受ける）
 */
export async function indexRule(
  rt: { db: AppContext; sql: Sql; env: Env; now: () => number; fetch: Fetch },
  ruleId: string,
): Promise<void> {
  if (rt.env.RULE_EMBEDDINGS_ENABLED !== "true") return;
  const rule = await rt.db.notation.findRule(ruleId);
  if (!rule || !rule.enabled) return;
  const vector = await embed(
    rt.env,
    rt.fetch,
    `${rule.title}\n${rule.correct.join(" / ")}\n${rule.incorrect.join(" / ")}\n${rule.description}`,
  );
  const current = await rt.db.notation.findRule(ruleId);
  if (!current || current.revision !== rule.revision || !current.enabled) return;
  new Rows<RuleEmbedding>(rt.sql, "ruleEmbeddings").upsert(ruleId, {
    id: ruleId,
    ruleId,
    revision: rule.revision,
    vector,
    model: EMBEDDING_MODEL,
    updatedAt: rt.now(),
  });
}

/**
 * 近い順の候補から、今の ACL・カテゴリ・ルールの版に合うものだけ残す（Convex の semanticRules.resolve）。
 * 古い版の埋め込み・別のモデルのもの・この制作物に当たらないルールは捨てる
 */
function resolve(prepared: PreparedAi, hits: readonly RuleEmbedding[]) {
  const rules = new Map(prepared.rules.map((r) => [r.ruleId, r]));
  return hits.flatMap((row) => {
    const rule = rules.get(row.ruleId);
    return rule && rule.revision === row.revision && row.model === EMBEDDING_MODEL ? [rule] : [];
  });
}

export const semanticRules = {
  "semanticRules:search": action({
    auth: "user",
    args: object({
      workId: z.string(),
      text: z.string(),
      consentToExternalSend: z.boolean(),
    }),
    handler: async (ctx, args) => {
      if (
        !args.consentToExternalSend ||
        !args.text.trim() ||
        args.text.length > aiConfig(ctx.env).policy.maxChars
      )
        throw reject("invalid_search");
      const principal = ctx.principal!;
      const prepared = await prepareAi(ctx.db, principal, ctx.env, args.workId);
      if (prepared.blocked) throw reject("ai_unavailable");
      const reserved = await reserveAi(ctx, principal, args.workId, args.text.length);
      if (!reserved.ok) throw reject("ai_quota_exceeded");
      const query = await embed(ctx.env, ctx.fetch, args.text);
      // ponytail: Convex の vectorSearch の代わりに、全件を読んで JS でコサイン類似度。ルールは数百件で、Vectorize を足すほどでない。
      // 千を超えるようになったら Vectorize（か、先に ACL と版で絞る）へ
      const hits = new Rows<RuleEmbedding>(ctx.sql, "ruleEmbeddings")
        .all()
        .filter((r) => isVector(r.vector))
        .map((r) => ({ r, score: cosine(query, r.vector) }))
        .sort((a, b) => b.score - a.score)
        .slice(0, SEARCH_LIMIT)
        .map((h) => h.r);
      return resolve(prepared, hits);
    },
  }),
} satisfies Record<string, FnDef>;
