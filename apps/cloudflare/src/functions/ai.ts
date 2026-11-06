import { loadAuthorizedWork, resolveRulesForWork, type AppContext } from "@mf100/application";
import {
  aiBlockReason,
  DomainError,
  isAllowed,
  placeAiCandidates,
  type Principal,
} from "@mf100/domain";
import { z } from "zod";
import { aiConfig, createProvider } from "../ai/provider.ts";
import { check, consume } from "../rateLimit.ts";
import { action, query, type FnCtx, type FnDef } from "./define.ts";
import { object } from "./validators.ts";

// apps/convex/convex/ai.ts の写し。任意の AI 校正（外部への送信）。キーが無い・無効・機密区分で禁止のときは使えない（理由を返す）。
// 利用者が明示的に押したときだけ動き、結果は候補だけを返す（保存しない・ルールを変えない）。
// Convex の internal の prepare / reserve / recordUse は、action が呼ぶ関数として下に出している（登録表には出さない）

export interface PreparedAi {
  userId: string;
  blocked: string | null;
  rules: {
    ruleId: string;
    revision: number;
    title: string;
    correct: string[];
    incorrect: string[];
    description: string;
  }[];
}

/** 送ってよいかの確認とルールの取得（Convex の ai.prepare）。aiWorkflow と semanticRules も使う */
export async function prepareAi(
  db: AppContext,
  principal: Principal,
  env: Env,
  workId: string,
): Promise<PreparedAi> {
  const { work, grants } = await loadAuthorizedWork(db, principal, workId, "work.view");
  const authz = { work, grants, principal };
  if (!isAllowed("revision.submit", authz) && !isAllowed("review.participate", authz))
    throw new DomainError("forbidden", { reason: "ai_not_allowed" });
  const blocked = aiBlockReason(aiConfig(env).policy);
  const set = await resolveRulesForWork(db, principal, workId);
  return {
    userId: principal.userId,
    blocked,
    rules: set.rules.map((r) => ({
      ruleId: r.ruleId,
      revision: r.revision,
      title: r.title,
      correct: r.correct,
      incorrect: r.incorrect,
      description: r.description,
    })),
  };
}

/**
 * 外へ出す前に枠を使う（Convex の reserveAi）。落ちても返さない（自動のやり直しはしない）。
 * 3 つの枠を全部見てから、まとめて取る。見てから取るまでに await は無いので、DO では間に別の呼び出しが入らない
 */
export async function reserveAi(
  ctx: Pick<FnCtx, "db" | "sql" | "env" | "now">,
  principal: Principal,
  workId: string,
  chars: number,
): Promise<{ ok: boolean; retryAfter: number; blocked?: string }> {
  await loadAuthorizedWork(ctx.db, principal, workId, "review.participate");
  const policy = aiConfig(ctx.env).policy;
  const blocked = aiBlockReason(policy);
  if (blocked) return { ok: false, retryAfter: 0, blocked };
  if (!Number.isInteger(chars) || chars < 1 || chars > policy.maxChars)
    throw new DomainError("forbidden");
  const now = ctx.now();
  const requests = [
    ["aiUser", principal.userId, 1],
    ["aiWork", workId, 1],
    ["aiCharacters", principal.userId, chars],
  ] as const;
  for (const [name, key, count] of requests) {
    const verdict = check(ctx.sql, name, key, count, now);
    if (!verdict.ok) return { ok: false, retryAfter: verdict.retryAfterMs };
  }
  for (const [name, key, count] of requests) consume(ctx.sql, name, key, count, now);
  return { ok: true, retryAfter: 0 };
}

/** 使った記録（Convex の ai.recordUse）。送った文字数と提供元だけで、本文は残さない */
async function recordUse(
  db: AppContext,
  at: number,
  e: {
    workId: string;
    userId: string;
    chars: number;
    provider: string;
    model: string;
    candidates: number;
  },
): Promise<void> {
  await db.audit.record({
    entityType: "work",
    entityId: e.workId,
    operation: "ai_proofread",
    actorId: e.userId,
    after: { chars: e.chars, provider: e.provider, model: e.model, candidates: e.candidates },
    at,
  });
}

const none = (blocked: string | null) => ({
  candidates: [],
  provider: "",
  model: "",
  blocked,
});

export const ai = {
  "ai:status": query({
    auth: "user",
    args: object({ workId: z.string() }),
    handler: async (ctx, { workId }) => {
      const config = aiConfig(ctx.env);
      await loadAuthorizedWork(ctx.db, ctx.principal!, workId, "work.view");
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
        semanticSearch: ctx.env.RULE_EMBEDDINGS_ENABLED === "true",
      };
    },
  }),

  /**
   * 校正の候補を返す。枠は外へ出す前に使い、提供元が落ちても返さない（自動のやり直しはしない）。
   * action なので transaction に包まれない: 外への fetch をまたぐ間、DB を握らない
   */
  "ai:proofread": action({
    auth: "user",
    args: object({ workId: z.string(), text: z.string() }),
    handler: async (ctx, { workId, text }) => {
      const config = aiConfig(ctx.env);
      const principal = ctx.principal!;
      const prep = await prepareAi(ctx.db, principal, ctx.env, workId);
      if (prep.blocked) return none(prep.blocked);
      if (text.length > config.policy.maxChars)
        return none(
          `AI に送れるのは ${config.policy.maxChars} 文字までです（${text.length} 文字）`,
        );
      if (!text.trim()) return none(null);
      const quota = await reserveAi(ctx, principal, workId, text.length);
      if (!quota.ok)
        return none(quota.blocked ?? "AI の利用上限に達しました。時間をおいて再試行してください");
      const provider = createProvider(config, ctx.env, ctx.fetch);
      const raw = await provider.proofread({ text, rules: prep.rules });
      // 候補を本文に当てはめて確かめる（本文に無いものは捨てる）
      const candidates = placeAiCandidates(
        text,
        raw,
        new Map(prep.rules.map((r) => [r.ruleId, r.revision])),
      );
      await recordUse(ctx.db, ctx.now(), {
        workId,
        userId: prep.userId,
        chars: text.length,
        provider: provider.name,
        model: provider.model,
        candidates: candidates.length,
      });
      return { candidates, provider: provider.name, model: provider.model, blocked: null };
    },
  }),
} satisfies Record<string, FnDef>;
