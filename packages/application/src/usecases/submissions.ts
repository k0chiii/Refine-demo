import {
  assertItemsReadyForConfirm,
  assertSessionOpen,
  assertWorkActive,
  createRevision,
  DomainError,
  markItemFailed,
  markItemVerified,
  planRevision,
  type Principal,
  type Revision,
  type RevisionKind,
  supersede,
  toArtifact,
  type UploadItem,
  type UploadSession,
  type ArtifactRole,
  type ArtifactType,
} from "@mf100/domain";
import type { AppContext } from "../ports.ts";
import { idempotent, loadAuthorizedWork } from "../shared.ts";

const SESSION_TTL_MS = 24 * 60 * 60 * 1000;

export interface PrepareSubmissionInput {
  workId: string;
  kind: RevisionKind;
  reviewType: string;
  deadlineAt: number;
  changeSummary: string;
  focusNotes: string;
  items: Array<{
    fileName: string;
    mimeType: string;
    type: ArtifactType;
    role: ArtifactRole;
    declaredSize?: number;
    externalUrl?: string;
  }>;
  requestId?: string;
}

export interface PreparedSubmission {
  session: UploadSession;
  items: UploadItem[];
}

/**
 * 版提出の準備（U-04 / F-04 ステップ1）。
 * ここでは Revision を作らない。R2 のオブジェクトキーを予約し、クライアントに転送先を返すだけ。
 * 旧版の受付状態には一切触れない（A-16）。
 */
export async function prepareSubmission(ctx: AppContext, principal: Principal, input: PrepareSubmissionInput): Promise<PreparedSubmission> {
  const { work } = await loadAuthorizedWork(ctx, principal, input.workId, "revision.submit");
  assertWorkActive(work);
  const now = ctx.clock.now();
  if (input.deadlineAt <= now) throw new DomainError("revision_deadline_in_past", { now, deadlineAt: input.deadlineAt });
  // 0版の重複・通常版の後の0版は準備段階で早期に弾く（確定時にも再検証する）
  planRevision(await ctx.revisions.listByWork(work.id), input.kind);
  if (input.items.length === 0) throw new DomainError("revision_no_artifacts");

  return idempotent(ctx, `prepareSubmission:${work.id}:${principal.userId}`, input.requestId, async () => {
    const session = await ctx.uploads.insert({
      workId: work.id,
      submittedBy: principal.userId,
      kind: input.kind,
      reviewType: input.reviewType,
      deadlineAt: input.deadlineAt,
      changeSummary: input.changeSummary,
      focusNotes: input.focusNotes,
      state: "open",
      createdAt: now,
      expiresAt: now + SESSION_TTL_MS,
    });
    const items: UploadItem[] = [];
    for (const [index, it] of input.items.entries()) {
      const base: Omit<UploadItem, "id"> = {
        sessionId: session.id,
        fileName: it.fileName,
        mimeType: it.mimeType,
        type: it.type,
        role: it.role,
        status: it.role === "external" ? "verified" : "pending",
      };
      if (it.declaredSize !== undefined) base.declaredSize = it.declaredSize;
      if (it.role === "external") {
        if (!it.externalUrl) throw new DomainError("anchor_invalid", { reason: "external_url_required" });
        base.externalUrl = it.externalUrl;
      } else {
        // オブジェクトキーは推測困難かつ作品/セッションで名前空間を分ける。公開バケットには置かない。
        base.objectKey = `works/${work.id}/sessions/${session.id}/${index}-${sanitizeFileName(it.fileName)}`;
      }
      items.push(await ctx.uploads.insertItem(base));
    }
    await ctx.audit.record({ entityType: "uploadSession", entityId: session.id, operation: "prepare", actorId: principal.userId, after: { workId: work.id, kind: input.kind, itemCount: items.length }, at: now });
    return { session, items };
  });
}

/** Hono（R2 実体確認後）から呼ばれる。サイズ・ハッシュを記録し verified にする。 */
export async function recordItemVerified(
  ctx: AppContext,
  principal: Principal,
  input: { itemId: string; size: number; sha256: string; pageCount?: number },
): Promise<UploadItem> {
  const { item, session } = await loadOwnItem(ctx, principal, input.itemId);
  assertSessionOpen(session, ctx.clock.now());
  const meta: { size: number; sha256: string; pageCount?: number } = { size: input.size, sha256: input.sha256 };
  if (input.pageCount !== undefined) meta.pageCount = input.pageCount;
  const next = markItemVerified(item, meta);
  await ctx.uploads.updateItem(next);
  return next;
}

export async function recordItemFailed(ctx: AppContext, principal: Principal, input: { itemId: string; message: string }): Promise<UploadItem> {
  const { item, session } = await loadOwnItem(ctx, principal, input.itemId);
  assertSessionOpen(session, ctx.clock.now());
  const next = markItemFailed(item, input.message);
  await ctx.uploads.updateItem(next);
  return next;
}

/** 失敗したファイルの再アップロードに備え pending に戻す（A-02 の復旧手順）。 */
export async function resetItem(ctx: AppContext, principal: Principal, input: { itemId: string }): Promise<UploadItem> {
  const { item, session } = await loadOwnItem(ctx, principal, input.itemId);
  assertSessionOpen(session, ctx.clock.now());
  const next: UploadItem = { ...item, status: "pending" };
  delete next.failureMessage;
  delete next.sha256;
  delete next.size;
  await ctx.uploads.updateItem(next);
  return next;
}

export interface ConfirmSubmissionInput {
  sessionId: string;
  requestId?: string;
  expectedWorkVersion?: number;
}

export interface ConfirmedSubmission {
  revision: Revision;
  supersededRevisionId: string | null;
}

/**
 * 版の提出確定（D1 / F-08 / A-16 / A-17 / A-10）。
 * 1 トランザクションで: 全ファイル検証済みを確認 → Revision 作成 → Artifact 作成 → 旧受付版を superseded で閉じる。
 * いずれかに失敗すれば何も変わらない（旧版の受付は維持される）。
 */
export async function confirmSubmission(ctx: AppContext, principal: Principal, input: ConfirmSubmissionInput): Promise<ConfirmedSubmission> {
  const session = await ctx.uploads.findById(input.sessionId);
  if (!session || session.submittedBy !== principal.userId) throw new DomainError("forbidden", { sessionId: input.sessionId });
  const { work } = await loadAuthorizedWork(ctx, principal, session.workId, "revision.submit");

  return idempotent(ctx, `confirmSubmission:${session.id}`, input.requestId, async () => {
    const now = ctx.clock.now();
    if (session.state === "confirmed" && session.confirmedRevisionId) {
      // requestId 無しの再送でも二重版を作らない
      const existing = await ctx.revisions.findById(session.confirmedRevisionId);
      if (existing) return { revision: existing, supersededRevisionId: null };
    }
    assertSessionOpen(session, now);
    assertWorkActive(work);
    if (input.expectedWorkVersion !== undefined && input.expectedWorkVersion !== work.version) {
      throw new DomainError("version_conflict", { expected: input.expectedWorkVersion, actual: work.version });
    }

    const items = await ctx.uploads.listItems(session.id);
    assertItemsReadyForConfirm(items);

    const existingRevisions = await ctx.revisions.listByWork(work.id);
    const plan = planRevision(existingRevisions, session.kind);
    const newRevision = createRevision(
      {
        workId: work.id,
        kind: session.kind,
        reviewType: session.reviewType,
        submittedBy: principal.userId,
        now,
        deadlineAt: session.deadlineAt,
        changeSummary: session.changeSummary,
        focusNotes: session.focusNotes,
      },
      plan,
    );
    const revision = await ctx.revisions.insert(newRevision);
    for (const item of items) await ctx.artifacts.insert(toArtifact(item, revision.id));

    let supersededRevisionId: string | null = null;
    if (plan.toSupersede) {
      const closed = supersede(plan.toSupersede, revision, now);
      await ctx.revisions.update(closed);
      supersededRevisionId = closed.id;
    }
    await ctx.uploads.update({ ...session, state: "confirmed", confirmedRevisionId: revision.id });
    await ctx.works.update({ ...work, version: work.version + 1 });
    await ctx.audit.record({
      entityType: "revision",
      entityId: revision.id,
      operation: "confirm",
      actorId: principal.userId,
      ...(input.requestId !== undefined ? { requestId: input.requestId } : {}),
      after: { sequence: revision.sequence, kind: revision.kind, supersededRevisionId },
      at: now,
    });
    return { revision, supersededRevisionId };
  });
}

async function loadOwnItem(ctx: AppContext, principal: Principal, itemId: string): Promise<{ item: UploadItem; session: UploadSession }> {
  const item = await ctx.uploads.findItem(itemId);
  if (!item) throw new DomainError("upload_item_not_found", { itemId });
  const session = await ctx.uploads.findById(item.sessionId);
  if (!session) throw new DomainError("upload_item_not_found", { itemId });
  if (session.submittedBy !== principal.userId) {
    // 他人のセッションは存在を漏らさない
    throw new DomainError("upload_item_not_found", { itemId });
  }
  return { item, session };
}

function sanitizeFileName(name: string): string {
  return name.replace(/[^\w.\-぀-ヿ一-龯]+/g, "_").slice(0, 120) || "file";
}
