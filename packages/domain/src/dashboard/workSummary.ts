import { approvalProgressOf, type ApprovalEvent } from "../approval/ApprovalPolicy.ts";
import type { CommentThread } from "../comment/CommentThread.ts";
import {
  isAccepting,
  revisionLabel,
  type Revision,
  type RevisionKind,
} from "../revision/Revision.ts";
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
  deadlineAt?: Instant;
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
    ...(revision.deadlineAt !== undefined ? { deadlineAt: revision.deadlineAt } : {}),
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
