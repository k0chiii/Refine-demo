import type { CommentThread, Severity } from "../comment/CommentThread.ts";
import { incompleteChecks, type RequiredCheck } from "../review/RequiredCheck.ts";
import { isBlockingForApproval } from "../comment/CommentThread.ts";
import type { Revision } from "../revision/Revision.ts";
import { latestStandardRevision } from "../revision/Revision.ts";
import { DomainError } from "../shared/DomainError.ts";
import type { RevisionId, UserId, WorkId } from "../shared/ids.ts";
import type { Instant } from "../shared/time.ts";
import type { Work } from "../work/Work.ts";

/**
 * 校了ポリシー（C3 / C6 / D2 / D6）。
 * 制度承認前の項目は値として外出しし、コードを変えずに差し替えられるようにする。
 * 既定値は安全側: 自己校了不可、critical/major をブロック、例外は理由必須かつ校了権限者本人のみ。
 */
export interface ApprovalPolicy {
  blockingSeverities: readonly Severity[];
  /** D2: 制作者本人による校了を独立承認なしに許すか。承認まで false。 */
  allowSelfApproval: boolean;
  /** 例外校了（重大未解決を残して校了）を許すか。 */
  allowException: boolean;
  /** 専門確認（必須チェック）が未完了なら校了をブロックするか（C3 / D6）。 */
  requireChecksComplete: boolean;
}

export const defaultApprovalPolicy: ApprovalPolicy = {
  blockingSeverities: ["critical", "major"],
  allowSelfApproval: false,
  allowException: true,
  requireChecksComplete: true,
};

export interface FinalizationRequest {
  work: Work;
  revisionId: RevisionId;
  revisions: readonly Revision[];
  /** 対象版に紐づくスレッド（前版の持越しを含めるかは呼び出し側で決める） */
  threads: readonly CommentThread[];
  /** 対象版の専門確認。未指定なら無し。 */
  checks?: readonly RequiredCheck[];
  actorId: UserId;
  exceptionReason?: string;
  /** D2 暫定: 自己校了時に独立した確認者の証跡（ユーザー ID）があれば許容する余地を残す。 */
  independentConfirmerId?: UserId;
  policy?: ApprovalPolicy;
}

export interface FinalizationOutcome {
  revision: Revision;
  blockingThreadIds: readonly string[];
  incompleteCheckIds: readonly string[];
  usedException: boolean;
  requiredChecksSnapshot: Record<string, unknown>;
}

/** 校了の可否を評価する。UI の警告だけで済ませない。すべてサーバー側で呼ぶ（§14 やってはいけないこと）。 */
export function evaluateFinalization(req: FinalizationRequest): FinalizationOutcome {
  const policy = req.policy ?? defaultApprovalPolicy;
  const { work } = req;

  if (work.lifecycle === "finalized")
    throw new DomainError("work_already_finalized", { workId: work.id });
  if (work.lifecycle !== "active")
    throw new DomainError("work_not_active", { lifecycle: work.lifecycle });
  if (work.approverId !== req.actorId)
    throw new DomainError("approval_not_approver", { actorId: req.actorId });

  const candidate = latestStandardRevision(req.revisions);
  const target = req.revisions.find((r) => r.id === req.revisionId);
  if (!target)
    throw new DomainError("approval_revision_not_candidate", { revisionId: req.revisionId });
  if (target.kind === "rough")
    throw new DomainError("approval_rough_revision", { revisionId: target.id });
  if (!candidate || candidate.id !== target.id) {
    throw new DomainError("approval_revision_not_candidate", {
      revisionId: target.id,
      latest: candidate?.id ?? null,
    });
  }

  const isSelf = work.creatorIds.includes(req.actorId);
  if (isSelf && !policy.allowSelfApproval) {
    const confirmer = req.independentConfirmerId;
    const independent =
      confirmer !== undefined && confirmer !== req.actorId && !work.creatorIds.includes(confirmer);
    if (!independent)
      throw new DomainError("approval_self_approval_not_allowed", { actorId: req.actorId });
  }

  const blocking = req.threads
    .filter(
      (t) => t.revisionId === target.id && isBlockingForApproval(t, policy.blockingSeverities),
    )
    .map((t) => t.id);

  const incomplete = policy.requireChecksComplete
    ? incompleteChecks(req.checks ?? [])
        .filter((c) => c.revisionId === target.id)
        .map((c) => c.id)
    : [];

  let usedException = false;
  const reason = req.exceptionReason?.trim() ?? "";
  if (blocking.length > 0) {
    if (!policy.allowException)
      throw new DomainError("approval_blocking_threads_remain", { blocking });
    if (reason === "")
      throw new DomainError("approval_blocking_threads_remain", {
        blocking,
        hint: "exception_reason_required",
      });
    usedException = true;
  }
  if (incomplete.length > 0) {
    if (!policy.allowException || reason === "") {
      throw new DomainError("approval_required_checks_incomplete", {
        incomplete,
        hint: "exception_reason_required",
      });
    }
    usedException = true;
  }

  return {
    revision: target,
    blockingThreadIds: blocking,
    incompleteCheckIds: incomplete,
    usedException,
    requiredChecksSnapshot: {
      policy,
      blockingThreadIds: blocking,
      incompleteCheckIds: incomplete,
      checks: (req.checks ?? [])
        .filter((c) => c.revisionId === target.id)
        .map((c) => ({ id: c.id, type: c.type, state: c.state, doneBy: c.doneBy ?? null })),
      selfApproval: isSelf,
      independentConfirmerId: req.independentConfirmerId ?? null,
      revisionSequence: target.sequence,
    },
  };
}

export type ApprovalAction = "finalized" | "reopened" | "exception_finalized";

export interface ApprovalEvent {
  workId: WorkId;
  revisionId: RevisionId;
  actorId: UserId;
  action: ApprovalAction;
  requiredChecksSnapshot: Record<string, unknown>;
  exceptionReason?: string;
  reason?: string;
  createdAt: Instant;
}

export function assertReopenReason(reason: string | undefined): string {
  const r = reason?.trim() ?? "";
  if (r === "") throw new DomainError("approval_reopen_reason_required");
  return r;
}
