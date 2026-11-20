import { approvalProgressOf, type ApprovalEvent } from "../approval/ApprovalPolicy.ts";
import type { CommentThread } from "../comment/CommentThread.ts";
import {
  isAccepting,
  revisionLabel,
  type Revision,
  type RevisionKind,
} from "../revision/Revision.ts";
import type { RequiredCheck } from "../review/RequiredCheck.ts";
import type { ReviewAssignment } from "../review/ReviewAssignment.ts";
import type { RevisionId } from "../shared/ids.ts";
import type { Instant } from "../shared/time.ts";
import { approvalSetupOf } from "../work/approvers.ts";
import type { Work } from "../work/Work.ts";
import { isUnresolvedResolution } from "./overview.ts";

/**
 * 制作物ごとの要約（一覧・ダッシュボード・提出先が、版とスレッドを全部読まずに使う値）。
 * 書込みの側が同じ関数で作り直すので、要約が揃っていれば全件を読んだときと同じ結果になる（docs/COST.md 推奨 1）。
 */

/** 版について読む側が要る値だけ */
export interface RevisionGlance {
  id: RevisionId;
  label: string;
  kind: RevisionKind;
  submittedAt: Instant;
  deadlineAt: Instant;
  reviewUrgent?: boolean;
  /** 期限到来で受付が終わった版 */
  lapsed: boolean;
}

export interface RevisionHeads {
  /** 無効を除いて、提出の新しい版 */
  latest: RevisionGlance | null;
  /** 受付中の版 */
  accepting: RevisionGlance | null;
}

/** 指摘の数（削除済みは呼び出し側で除く） */
export interface ThreadTally {
  unresolved: number;
  total: number;
  lastCreatedAt: Instant | null;
}

export interface WorkSummary extends RevisionHeads {
  /** {@link focusRevisionIdOf} の版の指摘。その版が無ければ 0 */
  threads: ThreadTally;
  /** 校了の宣言の済んだ人数（{@link countsDeclarations} のときだけ。それ以外は 0） */
  declared: number;
}

export function glanceOf(revision: Revision): RevisionGlance {
  return {
    id: revision.id,
    label: revisionLabel(revision),
    kind: revision.kind,
    submittedAt: revision.submittedAt,
    deadlineAt: revision.deadlineAt,
    ...(revision.reviewUrgent === true ? { reviewUrgent: true } : {}),
    lapsed: revision.reviewState === "closed" && revision.reviewClosedReason === "deadline",
  };
}

export function revisionHeadsOf(revisions: readonly Revision[]): RevisionHeads {
  let latest: Revision | null = null;
  for (const r of revisions)
    if (r.reviewState !== "void" && (latest === null || r.submittedAt > latest.submittedAt))
      latest = r;
  const accepting = revisions.find(isAccepting) ?? null;
  return {
    latest: latest && glanceOf(latest),
    accepting: accepting && glanceOf(accepting),
  };
}

/** 指摘を数える版: 受付中の版、無ければ期限で受付が終わった最新の版 */
export function focusRevisionIdOf(heads: RevisionHeads): RevisionId | null {
  return heads.accepting?.id ?? (heads.latest?.lapsed ? heads.latest.id : null);
}

export function threadTallyOf(
  threads: Iterable<Pick<CommentThread, "resolution" | "createdAt">>,
): ThreadTally {
  const tally: ThreadTally = { unresolved: 0, total: 0, lastCreatedAt: null };
  for (const t of threads) {
    tally.total++;
    if (isUnresolvedResolution(t.resolution)) tally.unresolved++;
    tally.lastCreatedAt = Math.max(tally.lastCreatedAt ?? t.createdAt, t.createdAt);
  }
  return tally;
}

/** 宣言の数を数える制作物か（数えないなら校了の履歴は読まなくてよい） */
export function countsDeclarations(work: Work): boolean {
  return work.lifecycle === "active" && approvalSetupOf(work).quorum > 1;
}

export function workSummaryOf(input: {
  work: Work;
  revisions: readonly Revision[];
  /** {@link focusRevisionIdOf} の版の、削除されていない指摘 */
  focusThreads: Iterable<Pick<CommentThread, "resolution" | "createdAt">>;
  approvalEvents: readonly ApprovalEvent[];
}): WorkSummary {
  const { work, revisions } = input;
  return {
    ...revisionHeadsOf(revisions),
    threads: threadTallyOf(input.focusThreads),
    declared: countsDeclarations(work)
      ? approvalProgressOf(work, input.approvalEvents, revisions).declaredIds.length
      : 0,
  };
}

/**
 * 受付中の版の校正の進み具合（校正者の割当と専門確認の数）。全体の状況の表が、割当・専門確認を 1 件ずつ読まずに使う値。
 * 要約（{@link WorkSummary}）とは別の行に持つ: 校正者が完了を押すたびに変わるので、要約に混ぜると
 * 要約だけを読む一覧・提出先の購読まで再実行される。受付中の版が無ければ全部 0
 */
export interface WorkProgress {
  /** 割り当てた校正者の数と、確認を終えた数（完了・免除） */
  reviewers: { total: number; done: number };
  /** 専門確認の数と、未完了の数 */
  checks: { total: number; pending: number };
}

export function workProgressOf(input: {
  assignments: ReadonlyArray<Pick<ReviewAssignment, "state">>;
  checks: ReadonlyArray<Pick<RequiredCheck, "state">>;
}): WorkProgress {
  return {
    reviewers: {
      total: input.assignments.length,
      done: input.assignments.filter((a) => a.state === "responded" || a.state === "excused")
        .length,
    },
    checks: {
      total: input.checks.length,
      pending: input.checks.filter((c) => c.state === "pending").length,
    },
  };
}
