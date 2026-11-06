import {
  beginItemUpload,
  completeItemUpload,
  failItemUpload,
  loadAuthorizedWork,
  resumeItemUpload,
} from "@mf100/application";
import { DomainError, isAllowed } from "@mf100/domain";
import { z } from "zod";
import { consume } from "../rateLimit.ts";
import { Docs } from "../sqlite/docs.ts";
import type { Sql } from "../sqlite/sql.ts";
import { mutation, query, reject, type FnCtx, type FnDef } from "./define.ts";
import { adminSubjectsOf, loadUser, principalOf } from "./principal.ts";
import { object, vFigmaImportMeta, vId } from "./validators.ts";

// apps/convex/convex/processing.ts と lib/processingValidators.ts の写し。ファイル処理（画像・動画のフレーム・Stream・
// Web のスナップショット・Figma の取り込み）の台帳で、実際の処理は apps/api の Queue / Workflow がする。
// 失敗は Convex では素の Error（message が理由）。ここでは同じ理由を code にして返す（define.ts の reject）

const processingKind = z.enum([
  "figma",
  "image",
  "video-frame",
  "stream",
  "web-snapshot",
  "container-preview",
]);
const processingOptions = object({
  artifactId: vId.optional(),
  itemId: vId.optional(),
  workId: vId.optional(),
  url: z.string().optional(),
  time: z.number().optional(),
});
const processingOutput = object({
  key: z.string().optional(),
  contentType: z.string().optional(),
  size: z.number().optional(),
  width: z.number().optional(),
  height: z.number().optional(),
  time: z.number().optional(),
  streamUid: z.string().optional(),
});

type ProcessingState = "queued" | "running" | "ready" | "failed" | "cancelled";

/** processingJobs の doc（Convex の schema.ts と同じ項目。id は払い出した ID） */
interface ProcessingJob {
  id: string;
  kind: z.output<typeof processingKind>;
  options: z.output<typeof processingOptions>;
  workId: string;
  userId: string;
  state: ProcessingState;
  attemptId?: string;
  output?: z.output<typeof processingOutput>;
  error?: string;
  streamUid?: string;
  streamUploadUrl?: string;
  createdAt: number;
  cleaned?: boolean;
}

/** apps/api の processingGateway が呼ぶ 7 つの operation（POST /internal/processing の operation。名前は `processing:<operation>`） */
export const PROCESSING_OPERATIONS = [
  "cleanupCandidates",
  "markCleaned",
  "inspect",
  "complete",
  "fail",
  "figmaComplete",
  "streamSession",
] as const;

const HOUR = 3_600_000;
/** 同時に走らせてよい処理の数（本人の queued + running） */
const ACTIVE_LIMIT = 3;

const jobsOf = (ctx: Pick<FnCtx, "sql">) => new Docs<ProcessingJob>(ctx.sql, "processingJobs");

/** 公開の create / status / cancel が使う、環境変数からの受付設定 */
const enabledKinds = (env: Env): string[] =>
  (env.PROCESSING_CAPABILITIES ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

/** 処理の対象外になった（失敗・取り消し）かを、台帳の外へ出る前に見る */
const isTerminal = (state: ProcessingState) => state === "failed" || state === "cancelled";

/**
 * 台帳の持ち主として、その人の権限で制作物を引き直す（Queue の処理は JWT を持たず、job への参照だけを持つ）。
 * 持ち主が権限を失っていたら forbidden。書く処理は進行中の制作物だけ
 */
async function authorizeJob(ctx: FnCtx, job: ProcessingJob, write = true) {
  const [owner] = ctx.sql.exec("SELECT id FROM users WHERE id = ?", job.userId);
  if (!owner) throw new DomainError("forbidden", { jobId: job.id });
  const principal = await principalOf(
    ctx.db,
    loadUser(ctx.sql, job.userId),
    adminSubjectsOf(ctx.env),
  );
  const { work } = await loadAuthorizedWork(
    ctx.db,
    principal,
    job.workId,
    write ? "revision.submit" : "work.view",
  );
  if (write && work.lifecycle !== "active") throw new DomainError("work_not_active");
  return principal;
}

/**
 * 期限の切れた処理を失敗にする（cron、毎時）。db.ts の runJobs と processing:expire が呼ぶ。
 * 6 時間経っても queued / running のままのもの。状態ごとに 50 件まで（残りは次の時間に）
 */
export function expireProcessingJobs(sql: Sql, now: number): void {
  const jobs = new Docs<ProcessingJob>(sql, "processingJobs");
  for (const state of ["queued", "running"] as const)
    for (const job of jobs.select(
      "WHERE state = ? AND createdAt < ? ORDER BY createdAt, rowid LIMIT 50",
      state,
      now - 6 * HOUR,
    ))
      jobs.put({ ...job, state: "failed", error: "処理の期限が切れました" });
}

/** Queue / Workflow が呼ぶ。誰の JWT も持たず、PROCESSING_SECRET だけで入る */
const internal = { service: "PROCESSING_SECRET", withUser: false } as const;

export const processing = {
  /** この制作物で処理を使えるか。画面が「処理に出す」ボタンを出すかどうかの判断 */
  "processing:status": query({
    auth: "user",
    args: object({ workId: z.string() }),
    handler: async (ctx, { workId }) => {
      const principal = ctx.principal!;
      const { work, grants } = await loadAuthorizedWork(ctx.db, principal, workId, "work.view");
      const enabled =
        ctx.env.PROCESSING_ENABLED === "true" &&
        isAllowed("revision.submit", { principal, work, grants }) &&
        work.lifecycle === "active";
      return { enabled, kinds: enabled ? enabledKinds(ctx.env) : [] };
    },
  }),

  /** 処理の依頼。同じ依頼が走っていればその ID を返す（二重に積まない）。戻りは job の ID */
  "processing:create": mutation({
    auth: "user",
    args: object({
      kind: processingKind,
      options: processingOptions,
      consentToProcessing: z.boolean(),
    }),
    handler: async (ctx, args) => {
      const principal = ctx.principal!;
      const userId = ctx.userId!;
      if (
        ctx.env.PROCESSING_ENABLED !== "true" ||
        !enabledKinds(ctx.env).includes(args.kind) ||
        !args.consentToProcessing
      )
        throw reject("processing_disabled_or_consent_missing");

      let workId = args.options.workId;
      let existingJob: string | undefined;
      if (args.options.artifactId) {
        const artifact = await ctx.db.artifacts.findById(args.options.artifactId);
        const revision = artifact ? await ctx.db.revisions.findById(artifact.revisionId) : null;
        if (!artifact?.objectKey || !revision || (workId && workId !== revision.workId))
          throw new DomainError("forbidden");
        workId = revision.workId;
        const mime = artifact.mimeType;
        if (
          (args.kind === "image" && !mime.startsWith("image/")) ||
          (["video-frame", "stream"].includes(args.kind) && !mime.startsWith("video/")) ||
          (args.kind === "container-preview" &&
            mime !== "application/pdf" &&
            !mime.startsWith("video/"))
        )
          throw reject("invalid_processing_media");
      }
      if (args.kind === "figma" && args.options.itemId) {
        const item = await ctx.db.uploads.findItem(args.options.itemId);
        const session = item ? await ctx.db.uploads.findById(item.sessionId) : null;
        if (
          !item ||
          item.origin?.kind !== "figma" ||
          !session ||
          session.submittedBy !== userId ||
          (workId && session.workId !== workId)
        )
          throw new DomainError("forbidden");
        workId = session.workId;
        // 同じ項目の取り込みが進行中なら、それを返す（Figma の API を二重に叩かない）
        existingJob = jobsOf(ctx).select(
          "WHERE options_itemId = ? AND state IN ('queued', 'running', 'ready') ORDER BY rowid LIMIT 1",
          args.options.itemId,
        )[0]?.id;
      } else if (args.kind === "figma") throw reject("item_required");
      if (args.kind !== "figma" && args.kind !== "web-snapshot" && !args.options.artifactId)
        throw reject("artifact_required");
      if (args.kind === "web-snapshot") {
        const url = parseUrl(args.options.url ?? "");
        if (
          !url ||
          url.protocol !== "https:" ||
          url.username ||
          url.password ||
          url.port ||
          url.hash ||
          url.href.length > 2048
        )
          throw reject("invalid_snapshot_url");
      }
      if (
        args.options.time !== undefined &&
        (!Number.isFinite(args.options.time) || args.options.time < 0 || args.options.time > 3600)
      )
        throw reject("invalid_frame_time");
      if (!workId) throw reject("work_required");
      const { work } = await loadAuthorizedWork(ctx.db, principal, workId, "revision.submit");
      if (work.lifecycle !== "active") throw reject("processing_not_allowed");
      if (existingJob) return existingJob;

      const mine = jobsOf(ctx).select("WHERE userId = ? ORDER BY rowid", userId);
      const active = mine.filter((j) => j.state === "queued" || j.state === "running");
      const duplicate = active.find(
        (j) => j.kind === args.kind && JSON.stringify(j.options) === JSON.stringify(args.options),
      );
      if (duplicate) return duplicate.id;
      if (active.length >= ACTIVE_LIMIT) throw reject("processing_quota_exceeded");
      // 利用者ごと・制作物ごとの 1 日の上限。落ちれば（この mutation ごと）消費も巻き戻る
      for (const [name, key] of [
        ["processingUser", userId],
        ["processingWork", workId],
      ] as const) {
        const verdict = consume(ctx.sql, name, key, 1, ctx.now());
        if (!verdict.ok)
          throw reject("processing_quota_exceeded", { retryAfterMs: verdict.retryAfterMs });
      }

      const attempt =
        args.kind === "figma"
          ? await beginItemUpload(ctx.db, principal, { itemId: args.options.itemId! })
          : null;
      return jobsOf(ctx).insert({
        kind: args.kind,
        options: args.options,
        workId,
        userId,
        state: "queued",
        ...(attempt ? { attemptId: attempt.attemptId } : {}),
        createdAt: ctx.now(),
      }).id;
    },
  }),

  /** 進み具合。制作物を見られる人なら誰でも（持ち主だけではない） */
  "processing:get": query({
    auth: "user",
    args: object({ jobId: vId }),
    handler: async (ctx, { jobId }) => {
      const job = jobsOf(ctx).get(jobId);
      if (!job) throw new DomainError("forbidden", { jobId });
      await loadAuthorizedWork(ctx.db, ctx.principal!, job.workId, "work.view");
      return {
        id: job.id,
        kind: job.kind,
        state: job.state,
        output: job.output ?? null,
        error: job.error ?? null,
      };
    },
  }),

  /** 依頼した本人だけが取り消せる（完了したものは取り消せない） */
  "processing:cancel": mutation({
    auth: "user",
    args: object({ jobId: vId }),
    handler: async (ctx, { jobId }) => {
      const jobs = jobsOf(ctx);
      const job = jobs.get(jobId);
      if (!job || job.userId !== ctx.userId || job.state === "ready")
        throw new DomainError("forbidden", { jobId });
      jobs.put({ ...job, state: "cancelled" });
      if (job.attemptId)
        await failItemUpload(ctx.db, ctx.principal!, {
          attemptId: job.attemptId,
          message: "processing_cancelled",
        });
      return null;
    },
  }),

  /** 処理に要るものを渡す（元の実体・Figma の取り込み先など）。失敗・取り消しの job は渡さない */
  "processing:inspect": query({
    auth: internal,
    args: object({ jobId: vId }),
    handler: async (ctx, { jobId }) => {
      const job = jobsOf(ctx).get(jobId);
      if (!job || isTerminal(job.state)) throw reject("job_unavailable");
      await authorizeJob(ctx, job);
      const artifact = job.options.artifactId
        ? await ctx.db.artifacts.findById(job.options.artifactId)
        : null;
      const item = job.options.itemId ? await ctx.db.uploads.findItem(job.options.itemId) : null;
      const attempt = job.attemptId ? await ctx.db.attempts.findById(job.attemptId) : null;
      // Convex の doc に合わせて、id は _id、作成時刻は _creationTime（apps/api の streamProcessing が job._id を読む）
      const { id, ...rest } = job;
      return {
        job: { ...rest, _id: id, _creationTime: job.createdAt },
        adopted: attempt?.state === "adopted",
        source: artifact?.objectKey ?? null,
        mimeType: artifact?.mimeType ?? null,
        origin: item?.origin ?? null,
        target: attempt
          ? {
              attemptId: attempt.id,
              objectKey: attempt.objectKey,
              mimeType: item!.mimeType,
              declaredSize: item!.declaredSize ?? null,
              fileName: item!.fileName,
            }
          : null,
      };
    },
  }),

  /** 処理の完了。結果の置き場は job ごとの固定キーだけ（他の実体を差し替えさせない） */
  "processing:complete": mutation({
    auth: internal,
    args: object({ jobId: vId, output: processingOutput }),
    handler: async (ctx, { jobId, output }) => {
      const jobs = jobsOf(ctx);
      const job = jobs.get(jobId);
      if (!job) throw reject("job_not_found", { jobId });
      await authorizeJob(ctx, job);
      if (job.state === "ready") return null;
      if (isTerminal(job.state)) throw reject("job_unavailable");
      if (output.key && output.key !== `derived/${job.id}/result`)
        throw reject("invalid_derived_key");
      if (output.streamUid && output.streamUid !== job.streamUid)
        throw reject("invalid_stream_uid");
      jobs.put({ ...job, state: "ready", output });
      return null;
    },
  }),

  /** 処理の失敗。完了したものは変えない。権限は見ない（失敗にするだけで、害が無い） */
  "processing:fail": mutation({
    auth: internal,
    args: object({ jobId: vId }),
    handler: async (ctx, { jobId }) => {
      const jobs = jobsOf(ctx);
      const job = jobs.get(jobId);
      if (job && job.state !== "ready")
        jobs.put({ ...job, state: "failed", error: "処理を完了できませんでした" });
      return null;
    },
  }),

  /** Figma から取り込んだ実体の検証完了。採用済みなら何もしない */
  "processing:figmaComplete": mutation({
    auth: internal,
    args: object({ jobId: vId, size: z.number(), sha256: z.string(), figma: vFigmaImportMeta }),
    handler: async (ctx, args) => {
      const job = jobsOf(ctx).get(args.jobId);
      if (!job?.attemptId || job.kind !== "figma") throw reject("invalid_job");
      const principal = await authorizeJob(ctx, job);
      const target = await resumeItemUpload(ctx.db, principal, { attemptId: job.attemptId });
      if (target.adopted) return { status: "verified", failureMessage: null };
      const result = await completeItemUpload(ctx.db, principal, {
        attemptId: job.attemptId,
        size: args.size,
        sha256: args.sha256,
        figma: args.figma,
      });
      return { status: result.status, failureMessage: result.failureMessage ?? null };
    },
  }),

  /** Stream の払い出し（uid と upload URL）を job に記録する。Cloudflare Stream のホスト以外は受けない */
  "processing:streamSession": mutation({
    auth: internal,
    args: object({ jobId: vId, uid: z.string(), uploadUrl: z.string() }),
    handler: async (ctx, args) => {
      const jobs = jobsOf(ctx);
      const job = jobs.get(args.jobId);
      if (!job || job.kind !== "stream") throw reject("invalid_job");
      await authorizeJob(ctx, job);
      if (!/^[a-f0-9]{32}$/.test(args.uid)) throw reject("invalid_stream_uid");
      const url = parseUrl(args.uploadUrl);
      if (
        !url ||
        url.protocol !== "https:" ||
        !["upload.videodelivery.net", "upload.cloudflarestream.com"].includes(url.hostname) ||
        url.username ||
        url.password
      )
        throw reject("invalid_stream_url");
      if (job.streamUid && job.streamUid !== args.uid) throw reject("stream_already_reserved");
      jobs.put({ ...job, streamUid: args.uid, streamUploadUrl: args.uploadUrl });
      return null;
    },
  }),

  /** 清掃の対象: 失敗・取り消しから 24 時間たって、まだ清掃していない job（状態ごとに 25 件まで）。消してよいのは自分の派生キーだけ */
  "processing:cleanupCandidates": query({
    auth: internal,
    args: object({}),
    handler: async (ctx) => {
      const cutoff = ctx.now() - 24 * HOUR;
      return (["failed", "cancelled"] as const).flatMap((state) =>
        jobsOf(ctx)
          .select(
            "WHERE state = ? AND cleaned IS NULL AND createdAt < ? ORDER BY createdAt, rowid LIMIT 25",
            state,
            cutoff,
          )
          .map((j) => ({
            jobId: j.id,
            key: `derived/${j.id}/result`,
            streamUid: j.streamUid ?? null,
          })),
      );
    },
  }),

  /** 清掃済みの印。upload URL はもう使えないので消す */
  "processing:markCleaned": mutation({
    auth: internal,
    args: object({ jobId: vId }),
    handler: async (ctx, { jobId }) => {
      const jobs = jobsOf(ctx);
      const job = jobs.get(jobId);
      if (job && isTerminal(job.state)) {
        const { streamUploadUrl: _drop, ...rest } = job;
        jobs.put({ ...rest, cleaned: true });
      }
      return null;
    },
  }),

  /** 期限切れの処理を失敗にする。cron（db.ts の runJobs）が直に呼ぶので、公開の口には出さない（秘密が要る） */
  "processing:expire": mutation({
    auth: internal,
    args: object({}),
    handler: async (ctx) => {
      expireProcessingJobs(ctx.sql, ctx.now());
      return null;
    },
  }),
} satisfies Record<string, FnDef>;

/** 壊れた URL は例外ではなく null（Convex の `new URL` の例外は、どの道その理由で拒否になる） */
function parseUrl(text: string): URL | null {
  try {
    return new URL(text);
  } catch {
    return null;
  }
}
