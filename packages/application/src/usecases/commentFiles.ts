import {
  COMMENT_FILES_MAX,
  COMMENT_FILE_TTL_MS,
  assertAttemptAdoptable,
  assertCanPostComment,
  assertCommentFileAttachable,
  assertCommentFileUploadable,
  assertCommentThumbUploadable,
  adoptAttempt,
  attachCommentFile,
  canReadCommentFile,
  commentFileKeyPrefix,
  commentFileObjectKeys,
  commentThumbObjectKey,
  DomainError,
  discardAttempt,
  failCommentFile,
  isAccepting,
  isCommentFileServable,
  recordCommentThumb,
  removeCommentFile,
  replyEntries,
  toCommentFileView,
  validateCommentFileDeclaration,
  validateCommentFileIds,
  validateCommentThumb,
  verifyCommentFile,
  type CommentFile,
  type CommentFileDeclaration,
  type CommentFileStatus,
  type CommentFileView,
  type Principal,
} from "@mf100/domain";
import type { AppContext } from "../ports.ts";
import { loadAuthorizedWork } from "../shared.ts";
import { loadOwnUploadAttempt, reserveUploadAttempt } from "./uploadAttempts.ts";

/*
 * コメント・返信の添付（FB の添付 usecases/feedback.ts と同じ流れ）。
 * 準備（R2 のキーを予約）→ Hono が実体を検証して採用 → コメント / 返信に付ける。
 * 試行の開始・採用・破棄とサムネイルの記録は、実体を検証するサービス（Hono）からサービス認証付きの境界を通してだけ呼ばれる。
 */

/**
 * 添付の準備。R2 のキーを予約し、ブラウザが Hono の PUT /comment-files/:fileId（サムネイルは …/thumb）で実体を送る。
 * 投稿と同じ条件で受け付ける:
 * - コメント（purpose: "comment"）: 受付中・期限前・最新の受付対象版で、校了前（assertCanPostComment）。
 * - 返信（purpose: "reply"）: 制作物を見られる人なら受付の前後に依らず可。校了前。
 */
export async function prepareCommentFiles(
  ctx: AppContext,
  principal: Principal,
  input: {
    revisionId: string;
    purpose: "comment" | "reply";
    files: CommentFileDeclaration[];
  },
): Promise<Array<{ fileId: string }>> {
  const revision = await ctx.revisions.findById(input.revisionId);
  if (!revision) throw new DomainError("forbidden", { revisionId: input.revisionId });
  const { work } = await loadAuthorizedWork(
    ctx,
    principal,
    revision.workId,
    input.purpose === "comment" ? "comment.post" : "comment.reply",
  );
  if (work.lifecycle === "finalized")
    throw new DomainError("work_already_finalized", { workId: work.id });
  const now = ctx.clock.now();
  if (input.purpose === "comment") {
    const latestAccepting = (await ctx.revisions.listByWork(work.id)).find(isAccepting) ?? null;
    assertCanPostComment(revision, now, latestAccepting?.id ?? null);
  }
  if (input.files.length === 0)
    throw new DomainError("comment_file_invalid", { field: "files", reason: "required" });
  if (input.files.length > COMMENT_FILES_MAX)
    throw new DomainError("comment_file_invalid", {
      field: "files",
      reason: "too_many",
      max: COMMENT_FILES_MAX,
    });
  // 全部の申告を先に検査する（途中で拒否して、予約だけ残さない）
  const declared = input.files.map((f) => validateCommentFileDeclaration(f));
  const out: Array<{ fileId: string }> = [];
  for (const d of declared) {
    const created = await ctx.commentFiles.insertFile({
      workId: work.id,
      revisionId: revision.id,
      uploaderId: principal.userId,
      fileName: d.fileName,
      originalName: d.originalName,
      mimeType: d.mimeType,
      type: d.type,
      declaredSize: d.size,
      ...(d.originalSize !== undefined ? { originalSize: d.originalSize } : {}),
      ...(d.width !== undefined && d.height !== undefined
        ? { width: d.width, height: d.height }
        : {}),
      objectKey: "",
      status: "pending",
      createdAt: now,
    });
    // キーの名前空間は払い出された ID で分ける（推測困難・重複しない）。実体は試行ごとにこの下へ置く
    await ctx.commentFiles.updateFile({
      ...created,
      keyPrefix: commentFileKeyPrefix(work.id, created.id, d.fileName),
    });
    out.push({ fileId: created.id });
  }
  return out;
}

async function loadOwnFile(ctx: AppContext, principal: Principal, fileId: string) {
  const file = await ctx.commentFiles.findFile(fileId);
  // 他人の添付は存在を漏らさない
  if (!file || file.uploaderId !== principal.userId)
    throw new DomainError("comment_file_not_found", { fileId });
  await loadAuthorizedWork(ctx, principal, file.workId, "work.view");
  return file;
}

/**
 * 実体の転送の開始（Hono が PUT を受ける前に、サービス認証付きの境界から呼ぶ）。
 * 本人の、コメントに付ける前の、未検証の添付に限り、この試行だけのキーを払い出す。
 */
export async function beginCommentFileUpload(
  ctx: AppContext,
  principal: Principal,
  input: { fileId: string },
): Promise<{
  attemptId: string;
  objectKey: string;
  mimeType: string;
  declaredSize: number | null;
  fileName: string;
}> {
  const file = await loadOwnFile(ctx, principal, input.fileId);
  assertCommentFileUploadable(file, principal.userId);
  const attempt = await reserveUploadAttempt(ctx, {
    target: "commentFile",
    targetId: file.id,
    uploaderId: principal.userId,
    keyPrefix: file.keyPrefix!,
  });
  return {
    attemptId: attempt.id,
    objectKey: attempt.objectKey,
    mimeType: file.mimeType,
    declaredSize: file.declaredSize ?? null,
    fileName: file.fileName,
  };
}

/**
 * 実体の検証完了（Hono が R2 で sha256 を確かめた後に、サービス認証付きの境界から呼ぶ）。申告サイズと違えば failed。
 * 添付がまだ受付中・未検証で、試行が予約中・期限内のときだけ、この試行を原子的に採用する。
 */
export async function completeCommentFileUpload(
  ctx: AppContext,
  principal: Principal,
  input: { attemptId: string; size: number; sha256: string },
): Promise<{ status: CommentFileStatus; failureMessage: string | null }> {
  const now = ctx.clock.now();
  const attempt = await loadOwnUploadAttempt(ctx, principal, input.attemptId, "commentFile");
  const file = await loadOwnFile(ctx, principal, attempt.targetId);
  assertCommentFileUploadable(file, principal.userId);
  assertAttemptAdoptable(attempt, now);
  const next = verifyCommentFile(file, {
    size: input.size,
    sha256: input.sha256,
    objectKey: attempt.objectKey,
  });
  await ctx.attempts.update(
    next.status === "verified" ? adoptAttempt(attempt, now) : discardAttempt(attempt, now),
  );
  await ctx.commentFiles.updateFile(next);
  return { status: next.status, failureMessage: next.failureMessage ?? null };
}

/**
 * 転送の失敗（Hono の補償。自分の試行のキーを消した後に呼ぶ）。試行を破棄し、清掃の対象にする。
 * 添付は受付中・未検証のときだけ failed にする（採用済みの実体・コメントに付いた添付には触れない）。
 */
export async function failCommentFileUpload(
  ctx: AppContext,
  principal: Principal,
  input: { attemptId: string; message: string },
): Promise<void> {
  const now = ctx.clock.now();
  const attempt = await loadOwnUploadAttempt(ctx, principal, input.attemptId, "commentFile");
  await ctx.attempts.update(discardAttempt(attempt, now));
  const file = await ctx.commentFiles.findFile(attempt.targetId);
  if (!file || file.threadId !== undefined || file.abandonedAt !== undefined) return;
  const next = failCommentFile(file, input.message);
  if (next !== file) await ctx.commentFiles.updateFile(next);
}

/**
 * サムネイルの転送の開始。置き場は添付の名前空間の下の固定キー（試行は作らない。サムネイルは付加的なもので、
 * 本人が付ける前にだけ置ける）。本人の、付ける前の、画像の添付だけ。
 */
export async function beginCommentThumbUpload(
  ctx: AppContext,
  principal: Principal,
  input: { fileId: string },
): Promise<{ objectKey: string; fileName: string }> {
  const file = await loadOwnFile(ctx, principal, input.fileId);
  assertCommentThumbUploadable(file, principal.userId);
  return { objectKey: commentThumbObjectKey(file.keyPrefix!), fileName: file.fileName };
}

/** サムネイルの保存を記録する（Hono が R2 に置き終えた後に呼ぶ）。形式と大きさはここでも検査する */
export async function completeCommentThumbUpload(
  ctx: AppContext,
  principal: Principal,
  input: { fileId: string; size: number; mimeType: string },
): Promise<{ hasThumb: true }> {
  const mimeType = validateCommentThumb({ mimeType: input.mimeType, size: input.size });
  const file = await loadOwnFile(ctx, principal, input.fileId);
  assertCommentThumbUploadable(file, principal.userId);
  await ctx.commentFiles.updateFile(recordCommentThumb(file, { size: input.size, mimeType }));
  return { hasThumb: true };
}

// ---------------------------------------------------------------- コメント・返信に付ける

/**
 * 付ける添付の確認（投稿の前に呼ぶ）。重複を除いて 10 件まで、全て本人が同じ制作物に上げた検証済みの、まだ付けていないもの。
 * 満たさない添付が 1 つでもあれば comment_file_not_ready（何も付けない）
 */
export async function checkCommentFiles(
  ctx: AppContext,
  principal: Principal,
  workId: string,
  fileIds: readonly string[] | undefined,
): Promise<{ ids: string[]; files: CommentFile[] }> {
  const ids = validateCommentFileIds(fileIds);
  const files: CommentFile[] = [];
  for (const id of ids)
    files.push(
      assertCommentFileAttachable(await ctx.commentFiles.findFile(id), id, {
        uploaderId: principal.userId,
        workId,
      }),
    );
  return { ids, files };
}

/** 確認済みの添付を、コメント（threadId）または返信（eventId つき）に付ける */
export async function attachCommentFiles(
  ctx: AppContext,
  files: readonly CommentFile[],
  to: { threadId: string; eventId?: string; revisionId: string },
): Promise<void> {
  for (const file of files) await ctx.commentFiles.updateFile(attachCommentFile(file, to));
}

/**
 * コメントの削除で添付を手放す（以後は誰も読めず、清掃が R2 から消す）。
 * eventIds を渡すとその返信の添付だけ、省くとスレッド全体（コメント本体と全ての返信の添付）。
 */
export async function releaseCommentFiles(
  ctx: AppContext,
  threadId: string,
  opts: { eventIds?: readonly string[] } = {},
): Promise<number> {
  const now = ctx.clock.now();
  let count = 0;
  for (const file of await ctx.commentFiles.listByThread(threadId)) {
    if (opts.eventIds !== undefined && !(file.eventId && opts.eventIds.includes(file.eventId)))
      continue;
    if (file.removedAt !== undefined) continue;
    await ctx.commentFiles.updateFile(removeCommentFile(file, now));
    count++;
  }
  return count;
}

// ---------------------------------------------------------------- 画面に渡す形

/** 添付の要約（付けた順）。検証済みで手放されていないものだけ。ID の数は高々 COMMENT_FILES_MAX */
export async function listCommentFileViews(
  ctx: AppContext,
  fileIds: readonly string[] | undefined,
): Promise<CommentFileView[]> {
  const out: CommentFileView[] = [];
  for (const id of (fileIds ?? []).slice(0, COMMENT_FILES_MAX)) {
    const file = await ctx.commentFiles.findFile(id);
    const view = file ? toCommentFileView(file) : null;
    if (view) out.push(view);
  }
  return out;
}

/** 返信イベントの payload から添付の ID を取り出す（無ければ空） */
export function replyFileIds(payload: Record<string, unknown> | undefined): string[] {
  const ids = payload?.fileIds;
  return Array.isArray(ids) ? ids.filter((x): x is string => typeof x === "string") : [];
}

// ---------------------------------------------------------------- 読み取り

/**
 * 添付の読み取り認可（Hono の GET /comment-files/:fileId と …/thumb）。署名付き URL は出さない。
 * - コメント・返信に付いた添付: その制作物を見られる人。コメント（返信）が削除されたら誰も読めない。
 * - まだ付けていない添付: 上げた本人だけ（投稿前の確認用）。
 * cacheable: サムネイルを端末の HTTP キャッシュに残してよいか（機密でない制作物のサムネイルだけ）。
 */
export async function authorizeCommentFile(
  ctx: AppContext,
  principal: Principal,
  input: { fileId: string; variant: "original" | "thumb" },
): Promise<{
  objectKey: string;
  mimeType: string;
  fileName: string;
  size: number | null;
  cacheable: boolean;
  /** 保存させる（ブラウザで開かない）。画像と PDF 以外 */
  attachment: boolean;
}> {
  const { fileId, variant } = input;
  const file = await ctx.commentFiles.findFile(fileId);
  if (!file) throw new DomainError("forbidden", { fileId });
  const { work } = await loadAuthorizedWork(ctx, principal, file.workId, "work.view");
  let host: { threadDeleted: boolean; replyDeleted: boolean } | null = null;
  if (file.threadId !== undefined) {
    const thread = await ctx.threads.findById(file.threadId);
    if (thread) {
      host = {
        threadDeleted: thread.deletedAt !== undefined,
        replyDeleted:
          file.eventId === undefined
            ? false
            : (replyEntries(await ctx.threads.listEvents(thread.id)).find(
                (r) => r.id === file.eventId,
              )?.deleted ?? true),
      };
    }
  }
  if (!canReadCommentFile(file, { userId: principal.userId, canView: true }, host))
    throw new DomainError("forbidden", { fileId });
  if (!isCommentFileServable(file, variant))
    throw new DomainError("comment_file_not_ready", { fileId, status: file.status });
  if (variant === "thumb")
    return {
      objectKey: file.thumbObjectKey!,
      mimeType: file.thumbMime ?? "image/webp",
      fileName: file.fileName,
      size: file.thumbSize ?? null,
      cacheable: work.confidentiality === "normal",
      attachment: false,
    };
  return {
    objectKey: file.objectKey,
    mimeType: file.mimeType,
    fileName: file.fileName,
    size: file.size ?? null,
    cacheable: false,
    attachment: file.type !== "image" && file.type !== "pdf",
  };
}

// ---------------------------------------------------------------- 清掃（D14 と同じ流れ）

/** コメントに付けないまま 24 時間たった添付を放置扱いにする（R2 の削除は Hono の清掃が行う） */
export async function expireCommentFiles(ctx: AppContext, limit = 100): Promise<string[]> {
  const now = ctx.clock.now();
  const ids: string[] = [];
  for (const f of await ctx.commentFiles.listUnattachedFilesBefore(
    now - COMMENT_FILE_TTL_MS,
    limit,
  )) {
    if (f.threadId !== undefined || f.abandonedAt !== undefined) continue;
    await ctx.commentFiles.updateFile({ ...f, abandonedAt: now });
    ids.push(f.id);
  }
  if (ids.length)
    await ctx.audit.record({
      entityType: "commentFile",
      entityId: ids[0]!,
      operation: "abandoned",
      actorId: "system",
      after: { fileIds: ids },
      at: now,
    });
  return ids;
}

/** 清掃の一覧で他の種類と区別するための頭（Hono には不透明な itemId として渡る） */
export const COMMENT_ORPHAN_PREFIX = "comment:";

/**
 * 放置扱い、またはコメントの削除で手放した添付で、R2 の実体がまだ残っているもの（itemId は "comment:{添付 ID}"）。
 * 原本とサムネイルは 1 つの項目にまとめて extraObjectKeys に載せ、Hono が全部消してから記録する。
 * 消す実体が 1 つも無い添付（準備しただけで送られなかった）は、ここですぐ清掃済みにする。
 */
export async function listOrphanCommentObjects(
  ctx: AppContext,
  limit = 100,
): Promise<Array<{ itemId: string; objectKey: string; extraObjectKeys?: string[] }>> {
  const now = ctx.clock.now();
  const out: Array<{ itemId: string; objectKey: string; extraObjectKeys?: string[] }> = [];
  for (const f of await ctx.commentFiles.listReleasedUnpurgedFiles(limit)) {
    const keys = commentFileObjectKeys(f);
    if (keys.length === 0) {
      await ctx.commentFiles.updateFile({ ...f, purgedAt: now });
      continue;
    }
    const [first, ...rest] = keys;
    out.push({
      itemId: `${COMMENT_ORPHAN_PREFIX}${f.id}`,
      objectKey: first!,
      ...(rest.length ? { extraObjectKeys: rest } : {}),
    });
  }
  return out;
}

/** R2 から削除済みの添付を記録する（冪等）。コメントに付いたままの添付は絶対に消さない */
export async function markCommentObjectsPurged(
  ctx: AppContext,
  fileIds: string[],
): Promise<number> {
  const now = ctx.clock.now();
  let count = 0;
  for (const id of new Set(fileIds)) {
    const f = await ctx.commentFiles.findFile(id);
    if (!f || f.purgedAt !== undefined) continue;
    const released =
      f.removedAt !== undefined || (f.abandonedAt !== undefined && f.threadId === undefined);
    if (!released) continue;
    await ctx.commentFiles.updateFile({ ...f, purgedAt: now });
    count++;
  }
  return count;
}
