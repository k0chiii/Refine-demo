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
  type CheckType,
  type RequiredCheck,
  checkTypeLabels,
  revisionLabel,
  voidRevision,
} from "@mf100/domain";
import type { AppContext } from "../ports.ts";
import { idempotent, loadAuthorizedWork } from "../shared.ts";
import { about, excerpt, notify, personName, workStakeholders } from "./notifications.ts";
import { currentRuleSet } from "./notation.ts";
import { createProofreadingRun } from "./autoProofread.ts";

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
  /** この版で必要な専門確認（§2.2-4）。確定時に RequiredCheck として作られる。 */
  requiredChecks?: Array<{ type: CheckType; label?: string; assigneeId?: string }>;
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
export async function prepareSubmission(
  ctx: AppContext,
  principal: Principal,
  input: PrepareSubmissionInput,
): Promise<PreparedSubmission> {
  const { work } = await loadAuthorizedWork(ctx, principal, input.workId, "revision.submit");
  assertWorkActive(work);
  const now = ctx.clock.now();
  if (input.deadlineAt <= now)
    throw new DomainError("revision_deadline_in_past", { now, deadlineAt: input.deadlineAt });
  // 0版の重複・通常版の後の0版は準備段階で早期に弾く（確定時にも再検証する）
  planRevision(await ctx.revisions.listByWork(work.id), input.kind);
  if (input.items.length === 0) throw new DomainError("revision_no_artifacts");

  return idempotent(
    ctx,
    `prepareSubmission:${work.id}:${principal.userId}`,
    input.requestId,
    async () => {
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
        ...(input.requiredChecks && input.requiredChecks.length > 0
          ? {
              requiredChecks: input.requiredChecks.map((c) => ({
                type: c.type,
                label: c.label?.trim() || checkTypeLabels[c.type],
                ...(c.assigneeId ? { assigneeId: c.assigneeId } : {}),
              })),
            }
          : {}),
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
          if (!it.externalUrl)
            throw new DomainError("anchor_invalid", { reason: "external_url_required" });
          base.externalUrl = it.externalUrl;
        } else {
          // オブジェクトキーは推測困難かつ作品/セッションで名前空間を分ける。公開バケットには置かない。
          base.objectKey = `works/${work.id}/sessions/${session.id}/${index}-${sanitizeFileName(it.fileName)}`;
        }
        items.push(await ctx.uploads.insertItem(base));
      }
      await ctx.audit.record({
        entityType: "uploadSession",
        entityId: session.id,
        operation: "prepare",
        actorId: principal.userId,
        after: { workId: work.id, kind: input.kind, itemCount: items.length },
        at: now,
      });
      return { session, items };
    },
  );
}

/** Hono（R2 実体確認後）から呼ばれる。サイズ・ハッシュを記録し verified にする。 */
export async function recordItemVerified(
  ctx: AppContext,
  principal: Principal,
  input: { itemId: string; size: number; sha256: string; pageCount?: number },
): Promise<UploadItem> {
  const { item, session } = await loadOwnItem(ctx, principal, input.itemId);
  assertSessionOpen(session, ctx.clock.now());
  const meta: { size: number; sha256: string; pageCount?: number } = {
    size: input.size,
    sha256: input.sha256,
  };
  if (input.pageCount !== undefined) meta.pageCount = input.pageCount;
  const next = markItemVerified(item, meta);
  await ctx.uploads.updateItem(next);
  return next;
}

export async function recordItemFailed(
  ctx: AppContext,
  principal: Principal,
  input: { itemId: string; message: string },
): Promise<UploadItem> {
  const { item, session } = await loadOwnItem(ctx, principal, input.itemId);
  assertSessionOpen(session, ctx.clock.now());
  const next = markItemFailed(item, input.message);
  await ctx.uploads.updateItem(next);
  return next;
}

/** 失敗したファイルの再アップロードに備え pending に戻す（A-02 の復旧手順）。 */
export async function resetItem(
  ctx: AppContext,
  principal: Principal,
  input: { itemId: string },
): Promise<UploadItem> {
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
export async function confirmSubmission(
  ctx: AppContext,
  principal: Principal,
  input: ConfirmSubmissionInput,
): Promise<ConfirmedSubmission> {
  const session = await ctx.uploads.findById(input.sessionId);
  if (!session || session.submittedBy !== principal.userId)
    throw new DomainError("forbidden", { sessionId: input.sessionId });
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
      throw new DomainError("version_conflict", {
        expected: input.expectedWorkVersion,
        actual: work.version,
      });
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
    // 表記統一: どのルールのどの版で検査するかを版に記録する（後からルールが変わっても版の結果は変わらない）
    if (work.notationCategories?.length) {
      const set = await currentRuleSet(ctx, work.notationCategories, work.year);
      newRevision.notationSnapshot = set.snapshot;
    }
    const revision = await ctx.revisions.insert(newRevision);
    const inserted = [];
    for (const item of items)
      inserted.push(await ctx.artifacts.insert(toArtifact(item, revision.id)));
    // 自動校正の実行を作る（重い処理はブラウザで行う。ここでは待ち状態を作るだけ）
    await createProofreadingRun(ctx, work, revision, inserted);
    for (const c of session.requiredChecks ?? []) {
      const data: Omit<RequiredCheck, "id"> = {
        revisionId: revision.id,
        type: c.type as CheckType,
        label: c.label,
        state: "pending",
      };
      if (c.assigneeId) data.assigneeId = c.assigneeId;
      await ctx.checks.insert(data);
    }

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
    const who = await personName(ctx, principal.userId);
    await notify(ctx, workStakeholders(work), principal.userId, {
      kind: "revision_submitted",
      title: "新しい版が提出されました",
      body: `${about(work.title, revisionLabel(revision), who)}: ${
        revision.changeSummary?.trim() ? excerpt(revision.changeSummary) : "変更点の記載なし"
      }`,
      workId: work.id,
      revisionId: revision.id,
    });
    for (const c of session.requiredChecks ?? []) {
      if (c.assigneeId) {
        await notify(ctx, [c.assigneeId], principal.userId, {
          kind: "check_requested",
          title: "専門確認を依頼されました",
          body: `${about(work.title, revisionLabel(revision), who ? `${who}から` : null)}: ${c.label}`,
          workId: work.id,
          revisionId: revision.id,
        });
      }
    }
    return { revision, supersededRevisionId };
  });
}

/**
 * 誤提出の無効化（§5.2-6）。受付中の最新版を理由付きで void にする。コメント・添付・監査は残す。
 * 無効化後は受付中の版が無くなる。正しい版を再提出する（番号は進む）。
 */
export async function voidRevisionUseCase(
  ctx: AppContext,
  principal: Principal,
  input: { revisionId: string; reason: string },
): Promise<Revision> {
  const revision = await ctx.revisions.findById(input.revisionId);
  if (!revision) throw new DomainError("forbidden", { revisionId: input.revisionId });
  const { work } = await loadAuthorizedWork(ctx, principal, revision.workId, "revision.submit");
  assertWorkActive(work);
  const now = ctx.clock.now();
  const next = voidRevision(revision, input.reason, now);
  await ctx.revisions.update(next);
  await ctx.audit.record({
    entityType: "revision",
    entityId: revision.id,
    operation: "void",
    actorId: principal.userId,
    after: { reason: input.reason.trim() },
    at: now,
  });
  const reviewers = (await ctx.assignments.listByRevision(revision.id)).map((a) => a.reviewerId);
  const who = await personName(ctx, principal.userId);
  await notify(ctx, [...workStakeholders(work), ...reviewers], principal.userId, {
    kind: "revision_voided",
    title: "版が無効になりました",
    body: `${about(work.title, revisionLabel(revision), who)}が無効にしました（理由: ${excerpt(
      input.reason,
      80,
    )}）`,
    workId: work.id,
    revisionId: revision.id,
  });
  return next;
}

/** 放置された提出準備を abandoned にする（§8.1 孤立ファイルの清掃。R2 側の削除は Hono の責務）。 */
export async function expireUploadSessions(ctx: AppContext, limit = 100): Promise<string[]> {
  const now = ctx.clock.now();
  const ids: string[] = [];
  for (const s of await ctx.uploads.listOpenExpired(now, limit)) {
    await ctx.uploads.update({ ...s, state: "abandoned" });
    await ctx.audit.record({
      entityType: "uploadSession",
      entityId: s.id,
      operation: "abandoned",
      actorId: "system",
      at: now,
    });
    ids.push(s.id);
  }
  return ids;
}

async function loadOwnItem(
  ctx: AppContext,
  principal: Principal,
  itemId: string,
): Promise<{ item: UploadItem; session: UploadSession }> {
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

/** 清掃対象の孤立オブジェクト（§8.1 / D14）。Hono（R2 を持つ側）が取りに来る。 */
export interface OrphanUploadObject {
  itemId: string;
  objectKey: string;
}

/**
 * abandoned セッションのうち、まだ R2 から削除されていないオブジェクトを列挙する。
 * 削除対象が残っていないセッションはここで purgedAt を付けて、次回以降の走査から外す。
 */
export async function listOrphanUploadObjects(
  ctx: AppContext,
  limit = 100,
): Promise<OrphanUploadObject[]> {
  const now = ctx.clock.now();
  const out: OrphanUploadObject[] = [];
  for (const session of await ctx.uploads.listAbandonedUnpurged(limit)) {
    const pending = (await ctx.uploads.listItems(session.id)).filter(
      (i) => i.objectKey !== undefined && i.purgedAt === undefined,
    );
    if (pending.length === 0) {
      await ctx.uploads.update({ ...session, purgedAt: now });
      continue;
    }
    for (const i of pending) out.push({ itemId: i.id, objectKey: i.objectKey! });
  }
  return out;
}

/**
 * R2 から削除済みのオブジェクトを記録する（冪等）。セッションの全項目が削除済みになれば purgedAt を付ける。
 * objectKey 自体は監査のために残す（削除の事実は purgedAt と監査ログ）。
 */
export async function markUploadObjectsPurged(ctx: AppContext, itemIds: string[]): Promise<number> {
  const now = ctx.clock.now();
  const touched = new Set<string>();
  let count = 0;
  for (const itemId of new Set(itemIds)) {
    const item = await ctx.uploads.findItem(itemId);
    if (!item || item.objectKey === undefined || item.purgedAt !== undefined) continue;
    const session = await ctx.uploads.findById(item.sessionId);
    if (!session || session.state !== "abandoned") continue; // 確定済み・進行中の実体は絶対に消さない
    await ctx.uploads.updateItem({ ...item, purgedAt: now });
    touched.add(session.id);
    count++;
  }
  for (const sessionId of touched) {
    const session = await ctx.uploads.findById(sessionId);
    if (!session) continue;
    const remaining = (await ctx.uploads.listItems(sessionId)).filter(
      (i) => i.objectKey !== undefined && i.purgedAt === undefined,
    );
    if (remaining.length === 0) await ctx.uploads.update({ ...session, purgedAt: now });
    await ctx.audit.record({
      entityType: "uploadSession",
      entityId: sessionId,
      operation: "objects_purged",
      actorId: "system",
      after: { remaining: remaining.length },
      at: now,
    });
  }
  return count;
}
