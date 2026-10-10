import { DomainError } from "../shared/DomainError.ts";
import type { RevisionId, UserId, WorkId } from "../shared/ids.ts";
import { isBeforeDeadline, type Instant } from "../shared/time.ts";

/** 0版（ラフ）と第1版以降（通常版）は別種別（C8 / D1）。 */
export type RevisionKind = "rough" | "standard";

/** Revision.review（§5.1） */
export const reviewStates = ["scheduled", "open", "closed", "void"] as const;
export type ReviewState = (typeof reviewStates)[number];

export type ReviewClosedReason = "deadline" | "superseded" | "void";

export interface Revision {
  id: RevisionId;
  workId: WorkId;
  kind: RevisionKind;
  /** rough は常に 0、standard は 1 以上。混在する連番として数えない（§5.2-6）。 */
  sequence: number;
  reviewType: string;
  submittedBy: UserId;
  submittedAt: Instant;
  deadlineAt: Instant;
  reviewState: ReviewState;
  reviewClosedReason?: ReviewClosedReason;
  reviewClosedAt?: Instant;
  supersededByRevisionId?: RevisionId;
  changeSummary: string;
  focusNotes: string;
  snapshotHash?: string;
}

export function isAccepting(revision: Revision): boolean {
  return revision.reviewState === "open";
}

/**
 * 新しい版の計画（提出確定の前段）。
 * - rough: 作品につき 1 件、かつ通常版が存在する前に限る（実装上の仮置き §2.3）。
 * - standard: 既存 standard の最大 sequence + 1（最小 1）。
 * - 受付中の版は高々 1 件なので、open な版があればそれを superseded として閉じる対象にする。
 */
export interface RevisionPlan {
  sequence: number;
  toSupersede: Revision | null;
}

export function planRevision(existing: readonly Revision[], kind: RevisionKind): RevisionPlan {
  const live = existing.filter((r) => r.reviewState !== "void");
  const standards = live.filter((r) => r.kind === "standard");
  const roughs = live.filter((r) => r.kind === "rough");

  let sequence: number;
  if (kind === "rough") {
    if (standards.length > 0) throw new DomainError("revision_rough_after_standard");
    if (roughs.length > 0) throw new DomainError("revision_rough_already_exists");
    sequence = 0;
  } else {
    sequence = standards.reduce((max, r) => Math.max(max, r.sequence), 0) + 1;
  }

  const open = live.filter(isAccepting);
  if (open.length > 1) {
    // 不変条件違反。データ修復が必要なので黙って続行しない。
    throw new DomainError("revision_sequence_conflict", { openCount: open.length });
  }
  return { sequence, toSupersede: open[0] ?? null };
}

/** 永続化層が ID を払い出すため、ID 未確定の版。 */
export type NewRevision = Omit<Revision, "id">;

export interface NewRevisionInput {
  workId: WorkId;
  kind: RevisionKind;
  reviewType: string;
  submittedBy: UserId;
  now: Instant;
  deadlineAt: Instant;
  changeSummary: string;
  focusNotes: string;
  snapshotHash?: string;
}

export function createRevision(input: NewRevisionInput, plan: RevisionPlan): NewRevision {
  if (!isBeforeDeadline(input.now, input.deadlineAt)) {
    throw new DomainError("revision_deadline_in_past", {
      now: input.now,
      deadlineAt: input.deadlineAt,
    });
  }
  const revision: NewRevision = {
    workId: input.workId,
    kind: input.kind,
    sequence: plan.sequence,
    reviewType: input.reviewType,
    submittedBy: input.submittedBy,
    submittedAt: input.now,
    deadlineAt: input.deadlineAt,
    reviewState: "open",
    changeSummary: input.changeSummary,
    focusNotes: input.focusNotes,
  };
  if (input.snapshotHash !== undefined) revision.snapshotHash = input.snapshotHash;
  return revision;
}

/** 新版確定と同一トランザクションで旧版を superseded で閉じる（D1 / A-17）。既に閉じている版は変更しない。 */
export function supersede(previous: Revision, by: Pick<Revision, "id">, now: Instant): Revision {
  if (previous.reviewState !== "open") return previous;
  return {
    ...previous,
    reviewState: "closed",
    reviewClosedReason: "superseded",
    reviewClosedAt: now,
    supersededByRevisionId: by.id,
  };
}

/** 期限到来で受付のみ終了する（A-05）。未読・指摘・校了状態には触れない。 */
export function closeByDeadline(revision: Revision, now: Instant): Revision {
  if (revision.reviewState !== "open") return revision;
  if (isBeforeDeadline(now, revision.deadlineAt)) return revision;
  return {
    ...revision,
    reviewState: "closed",
    reviewClosedReason: "deadline",
    reviewClosedAt: now,
  };
}

/**
 * 新規指摘の可否（§5.2-1,2 / A-04）。
 * `now < deadlineAt` かつ受付中、かつ当該制作物の最新の受付対象版であること。
 * 表示上の期限ジョブが遅延していても、ここでの比較で拒否する。
 */
export function assertCanPostComment(
  revision: Revision,
  now: Instant,
  latestAcceptingRevisionId: RevisionId | null,
): void {
  if (revision.reviewState !== "open") {
    throw new DomainError("revision_not_accepting", {
      revisionId: revision.id,
      reviewState: revision.reviewState,
      reason: revision.reviewClosedReason,
    });
  }
  if (!isBeforeDeadline(now, revision.deadlineAt)) {
    throw new DomainError("revision_deadline_passed", {
      revisionId: revision.id,
      now,
      deadlineAt: revision.deadlineAt,
    });
  }
  if (latestAcceptingRevisionId !== revision.id) {
    throw new DomainError("revision_not_latest", {
      revisionId: revision.id,
      latestAcceptingRevisionId,
    });
  }
}

/** 校了候補となる最終版: void でない最新の standard 版（0版からの直接校了は制度承認まで不可）。 */
export function latestStandardRevision(revisions: readonly Revision[]): Revision | null {
  let best: Revision | null = null;
  for (const r of revisions) {
    if (r.kind !== "standard" || r.reviewState === "void") continue;
    if (best === null || r.sequence > best.sequence) best = r;
  }
  return best;
}

/** 表示用ラベル: 0版は「ラフ」、通常版は「第n版」。連番扱いしない。 */
export function revisionLabel(revision: Pick<Revision, "kind" | "sequence">): string {
  return revision.kind === "rough" ? "0版（ラフ）" : `第${revision.sequence}版`;
}
