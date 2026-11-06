import { loadAuthorizedWork, resolveRulesForWork, type AppContext } from "@mf100/application";
import { aiBlockReason, DomainError, isAllowed, placeAiCandidates } from "@mf100/domain";
import { z } from "zod";
import { aiConfig, createProvider, type Fetch } from "../ai/provider.ts";
import { Docs } from "../sqlite/docs.ts";
import type { Sql } from "../sqlite/sql.ts";
import { reserveAi } from "./ai.ts";
import { mutation, query, reject, type FnDef } from "./define.ts";
import { adminSubjectsOf, loadUser, principalOf } from "./principal.ts";
import { object } from "./validators.ts";

// apps/convex/convex/aiWorkflow.ts の写し。AI 校正を、画面を閉じても動く仕事にする。
// Convex の workflow 部品（step の引数は ID だけ、並列度 2、retry なし）の代わりは src/jobs.ts の kind `aiProofread`:
// start が aiJobs の行と仕事を同じトランザクションで積み、alarm が executeAiJob を動かす。
// 本文は持たない（下書きから引く）。結果は 1 時間で消える

type AiJobState = "queued" | "running" | "completed" | "failed" | "cancelled";

/** aiJobs の doc（Convex の schema.ts と同じ項目。id は払い出した ID。workflowId は仕事が代わるので持たない） */
interface AiJob {
  id: string;
  workId: string;
  userId: string;
  draftVersion: number;
  state: AiJobState;
  result?: string;
  error?: string;
  createdAt: number;
  expiresAt: number;
}

const HOUR = 3_600_000;

const jobsOf = (sql: Sql) => new Docs<AiJob>(sql, "aiJobs");

/** 仕事を動かす側に要るもの（alarm の中の runJob が組む。FnCtx は要らない: 利用者の呼び出しではない） */
export interface AiJobRuntime {
  db: AppContext;
  sql: Sql;
  env: Env;
  now: () => number;
  fetch: Fetch;
}

/**
 * 動かす直前と、外から戻った直後に、権限・方針・下書きの版を引き直す（Convex の aiWorkflow.prepare）。
 * 外へ送っている間に、権限が外れた・下書きが変わったものは採用しない
 */
async function prepareJob(rt: Pick<AiJobRuntime, "db" | "sql" | "env" | "now">, jobId: string) {
  const job = jobsOf(rt.sql).get(jobId);
  if (!job || job.expiresAt <= rt.now() || job.state === "cancelled") throw reject("job_expired");
  const [user] = rt.sql.exec("SELECT id FROM users WHERE id = ?", job.userId);
  if (!user) throw new DomainError("forbidden", { jobId });
  const principal = await principalOf(rt.db, loadUser(rt.sql, job.userId), adminSubjectsOf(rt.env));
  const { work, grants } = await loadAuthorizedWork(
    rt.db,
    principal,
    job.workId,
    "revision.submit",
  );
  if (
    !isAllowed("revision.submit", { principal, work, grants }) ||
    aiBlockReason(aiConfig(rt.env).policy)
  )
    throw new DomainError("forbidden", { jobId });
  const draft = await rt.db.documents.findByWork(work.id);
  if (!draft || draft.version !== job.draftVersion) throw reject("draft_changed");
  const rules = await resolveRulesForWork(rt.db, principal, work.id);
  return { job, text: draft.text, rules: rules.rules };
}

/** 結果を書く（Convex の finish）。動いている途中のものだけ。外から戻った後なので、権限と版をもう一度確かめてから */
async function finish(
  rt: AiJobRuntime,
  jobId: string,
  outcome: { failed: true } | { failed: false; result: string },
): Promise<void> {
  const jobs = jobsOf(rt.sql);
  const job = jobs.get(jobId);
  if (!job || !["queued", "running"].includes(job.state) || job.expiresAt <= rt.now()) return;
  if (outcome.failed) {
    jobs.put({ ...job, state: "failed", error: "AI の処理を完了できませんでした" });
    return;
  }
  await prepareJob(rt, jobId);
  jobs.put({ ...job, state: "completed", result: outcome.result });
}

/**
 * kind `aiProofread` の本体（Convex の execute）。claim して、外へ送って、結果か失敗を書く。
 * 例外は何でも「失敗」として書く（Convex の step は retry: false）ので、仕事としては必ず完了で返る。
 * transaction は使わない: claim も finish の書き込みも 1 文で、外への fetch は transaction の外に置きたい
 */
export async function executeAiJob(rt: AiJobRuntime, jobId: string): Promise<void> {
  const jobs = jobsOf(rt.sql);
  const job = jobs.get(jobId);
  if (!job || job.state !== "queued" || job.expiresAt <= rt.now()) return;
  jobs.put({ ...job, state: "running" });
  try {
    const prepared = await prepareJob(rt, jobId);
    const config = aiConfig(rt.env);
    const provider = createProvider(config, rt.env, rt.fetch);
    const candidates = placeAiCandidates(
      prepared.text,
      await provider.proofread({ text: prepared.text, rules: prepared.rules }),
      new Map(prepared.rules.map((r) => [r.ruleId, r.revision])),
    );
    await finish(rt, jobId, {
      failed: false,
      result: JSON.stringify({ candidates, provider: provider.name, model: provider.model }),
    });
  } catch {
    await finish(rt, jobId, { failed: true });
  }
}

/** 期限（作成から 1 時間）の切れた結果を消す（cron、5 分ごと。Convex の aiWorkflow.expire）。50 件まで */
export function expireAiJobs(sql: Sql, now: number): void {
  const jobs = jobsOf(sql);
  for (const job of jobs.select("WHERE expiresAt <= ? ORDER BY expiresAt LIMIT 50", now))
    sql.exec("DELETE FROM aiJobs WHERE id = ?", job.id);
}

const jobId = z.string();

export const aiWorkflow = {
  /** 同じ人・同じ制作物の動いているものがあれば、それを返す（二重に積まない）。本文は積まず、版だけ */
  "aiWorkflow:start": mutation({
    auth: "user",
    args: object({
      workId: z.string(),
      draftVersion: z.number(),
      consentToTemporaryStorage: z.boolean(),
    }),
    handler: async (ctx, args): Promise<string> => {
      const principal = ctx.principal!;
      if (!args.consentToTemporaryStorage) throw reject("temporary_storage_consent_required");
      const { work } = await loadAuthorizedWork(ctx.db, principal, args.workId, "revision.submit");
      if (aiBlockReason(aiConfig(ctx.env).policy)) throw reject("ai_unavailable");
      const draft = await ctx.db.documents.findByWork(args.workId);
      if (!draft || draft.version !== args.draftVersion || !draft.text.trim())
        throw reject("draft_changed");
      const jobs = jobsOf(ctx.sql);
      const pending = jobs
        .select("WHERE userId = ? AND workId = ? ORDER BY rowid", principal.userId, work.id)
        .find((j) => (j.state === "queued" || j.state === "running") && j.expiresAt > ctx.now());
      if (pending) return pending.id;
      const quota = await reserveAi(ctx, principal, work.id, draft.text.length);
      if (!quota.ok) throw reject("ai_quota_exceeded");
      const created = jobs.insert({
        workId: work.id,
        userId: principal.userId,
        draftVersion: draft.version,
        state: "queued",
        createdAt: ctx.now(),
        expiresAt: ctx.now() + HOUR,
      });
      ctx.schedule({ kind: "aiProofread", jobId: created.id });
      return created.id;
    },
  }),

  /** 自分の（期限内の）ものだけ。権限を失っていたら読めない */
  "aiWorkflow:get": query({
    auth: "user",
    args: object({ jobId }),
    handler: async (ctx, args) => {
      const job = jobsOf(ctx.sql).get(args.jobId);
      if (!job || job.userId !== ctx.userId || job.expiresAt <= ctx.now()) return null;
      await loadAuthorizedWork(ctx.db, ctx.principal!, job.workId, "revision.submit");
      return {
        state: job.state,
        result: job.result ?? null,
        error: job.error ?? null,
        expiresAt: job.expiresAt,
      };
    },
  }),

  /** 取り消すと結果も消す。動いている仕事は、戻ってきても finish が採用しない（cancelled は動いている途中ではない） */
  "aiWorkflow:cancel": mutation({
    auth: "user",
    args: object({ jobId }),
    handler: async (ctx, args) => {
      const jobs = jobsOf(ctx.sql);
      const job = jobs.get(args.jobId);
      if (!job || job.userId !== ctx.userId)
        throw new DomainError("forbidden", { jobId: args.jobId });
      const { result: _result, ...rest } = job;
      jobs.put({ ...rest, state: "cancelled" });
      return null;
    },
  }),
} satisfies Record<string, FnDef>;
