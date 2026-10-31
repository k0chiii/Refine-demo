import { DomainError } from "../shared/DomainError.ts";
import type { RevisionId, UserId, WorkId } from "../shared/ids.ts";
import { isBeforeDeadline, type Instant } from "../shared/time.ts";
import { assertSubmitRevisionDeadline } from "./submitDeadline.ts";
import type { RuleSetSnapshot } from "../notation/ruleset.ts";
import type { RevisionDeclarations, SubmissionCheckId } from "../work/metadata.ts";

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
  /** 提出ダイアログの「緊急」で短い校正期日を付けた版（一覧・校画面の印） */
  reviewUrgent?: boolean;
  reviewState: ReviewState;
  reviewClosedReason?: ReviewClosedReason;
  reviewClosedAt?: Instant;
  supersededByRevisionId?: RevisionId;
  changeSummary: string;
  focusNotes: string;
  snapshotHash?: string;
  /** 提出時の表記統一ルールの組（どのルールのどの版で検査するか）。後からルールを変えても版の結果は変わらない */
  notationSnapshot?: RuleSetSnapshot;
  /** 提出時の申告（写真・めい・指針外の色の使用。Notion の版 DB のチェックボックス）。古い版には無い */
  declarations?: RevisionDeclarations;
  /** 提出前に本人が確認した項目（Notion の版 DB のチェックボックス） */
  selfChecks?: readonly SubmissionCheckId[];
  /**
   * 指摘の件数（投稿・採否・削除と同じ transaction で更新。無い古い行は works.get がスレッドから数える）。
   * unresolved = 未対応・確認済み・採用済み未反映。openBot = 自動校正の未確認（open / acknowledged）。
   */
  unresolvedCount?: number;
  openBotCount?: number;
  threadCount?: number;
}

export function isAccepting(revision: Revision): boolean {
  return revision.reviewState === "open";
}

/**
 * 新しい版の計画（提出確定の前段）。
 * - rough: 通常版が存在する前に限る。再提出は可（利用者決定 2026-10-10）。sequence は 0 始まりの提出回数で、
 *   表示は常に「0版（ラフ）」。旧ラフは新ラフの確定で superseded になる。0版からの直接校了は不可。
 * - standard: 既存 standard の最大 sequence + 1（最小 1）。0版の回数は通常版の番号に影響しない。
 * - 受付中の版は高々 1 件なので、open な版があればそれを superseded として閉じる対象にする。
 */
export interface RevisionPlan {
  sequence: number;
  toSupersede: Revision | null;
}

export function planRevision(existing: readonly Revision[], kind: RevisionKind): RevisionPlan {
  // 版番号は無効化した版も含めて一意（§5.2-6: 誤提出の訂正は履歴を持つ）
  const standards = existing.filter((r) => r.kind === "standard");
  const roughs = existing.filter((r) => r.kind === "rough");
  const live = existing.filter((r) => r.reviewState !== "void");

  let sequence: number;
  if (kind === "rough") {
    if (standards.some((r) => r.reviewState !== "void"))
      throw new DomainError("revision_rough_after_standard");
    sequence = roughs.length;
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
  reviewUrgent?: boolean;
  /** 緊急の上限計算用。受付中の版を supersede するときはその deadlineAt */
  openAcceptingDeadlineAt?: Instant;
  changeSummary: string;
  focusNotes: string;
  snapshotHash?: string;
  declarations?: RevisionDeclarations;
  selfChecks?: readonly SubmissionCheckId[];
}

export function createRevision(input: NewRevisionInput, plan: RevisionPlan): NewRevision {
  const openAccepting =
    input.openAcceptingDeadlineAt ?? plan.toSupersede?.deadlineAt ?? undefined;
  assertSubmitRevisionDeadline({
    now: input.now,
    deadlineAt: input.deadlineAt,
    ...(input.reviewUrgent === true ? { reviewUrgent: true } : {}),
    ...(openAccepting !== undefined ? { openAcceptingDeadlineAt: openAccepting } : {}),
  });
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
    unresolvedCount: 0,
    openBotCount: 0,
    threadCount: 0,
  };
  if (input.snapshotHash !== undefined) revision.snapshotHash = input.snapshotHash;
  if (input.declarations !== undefined) revision.declarations = { ...input.declarations };
  if (input.selfChecks !== undefined && input.selfChecks.length > 0)
    revision.selfChecks = [...input.selfChecks];
  if (input.reviewUrgent === true) revision.reviewUrgent = true;
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

/**
 * 誤提出の無効化（§5.2-6）。受付中の最新版のみ、理由必須。指摘・添付は履歴として残す（削除しない）。
 * 無効化後は受付中の版が無くなる（旧版は再開しない。必要なら正しい版を再提出する）。
 */
export function voidRevision(
  revision: Revision,
  reason: string | undefined,
  now: Instant,
): Revision {
  if (revision.reviewState !== "open")
    throw new DomainError("revision_void_not_allowed", {
      revisionId: revision.id,
      reviewState: revision.reviewState,
    });
  const r = reason?.trim() ?? "";
  if (r === "") throw new DomainError("revision_void_reason_required");
  return { ...revision, reviewState: "void", reviewClosedReason: "void", reviewClosedAt: now };
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

/** 表示用ラベル: 0版は「ラフ」（再提出は回数を併記）、通常版は「第n版」。連番扱いしない。 */
export function revisionLabel(revision: Pick<Revision, "kind" | "sequence">): string {
  if (revision.kind === "rough")
    return revision.sequence === 0 ? "0版（ラフ）" : `0版（ラフ・${revision.sequence + 1}回目）`;
  return `第${revision.sequence}版`;
}
