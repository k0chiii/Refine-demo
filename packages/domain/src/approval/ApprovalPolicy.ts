import type { CommentThread, Severity } from "../comment/CommentThread.ts";
import { incompleteChecks, type RequiredCheck } from "../review/RequiredCheck.ts";
import { isBlockingForApproval } from "../comment/CommentThread.ts";
import type { Revision } from "../revision/Revision.ts";
import { latestStandardRevision } from "../revision/Revision.ts";
import { DomainError } from "../shared/DomainError.ts";
import type { RevisionId, UserId, WorkId } from "../shared/ids.ts";
import type { Instant } from "../shared/time.ts";
import type { WorkPermissionGrant } from "../acl/Permission.ts";
import { assertWorkActive, type Work } from "../work/Work.ts";
import {
  type ApprovalConfirmation,
  findValidConfirmation,
  isIndependentOf,
} from "./ApprovalConfirmation.ts";

/**
 * 校了ポリシー（C3 / C6 / D2 / D6）。
 * 制度承認前の項目は値として外出しし、コードを変えずに差し替えられるようにする。
 * 既定値は安全側: 自己校了不可、critical/major をブロック、例外は理由必須かつ校了権限者本人のみ。
 */
export interface ApprovalPolicy {
  blockingSeverities: readonly Severity[];
  /**
   * D2: 制作者本人による校了を独立確認なしに許すか。承認まで false。
   * false のとき、制作者＝校了権限者の制作物は、制作者・校了権限者以外の人が自分の操作で記録した
   * 独立確認（ApprovalConfirmation）が対象版に無ければ校了できない。
   */
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
  /**
   * D2: 対象版に記録された独立確認（確認者本人の操作で保存されたもの）。
   * 呼び出し側が申告した確認者 ID は受け取らない。有効性は {@link findValidConfirmation} で確かめ直す。
   */
  confirmations?: readonly ApprovalConfirmation[];
  /** 制作物の ACL（確認者がいまも確認できる人かを判定する） */
  grants?: readonly WorkPermissionGrant[];
  /** これより前の独立確認は無効（再開した後は確認し直す） */
  confirmationsNotBefore?: Instant;
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

  const target = assertFinalCandidate(req.revisions, req.revisionId);

  const isSelf = work.creatorIds.includes(req.actorId);
  let confirmation: ApprovalConfirmation | null = null;
  if (isSelf && !policy.allowSelfApproval) {
    const validity = {
      work,
      revisionId: target.id,
      grants: req.grants ?? [],
      actorId: req.actorId,
      ...(req.confirmationsNotBefore !== undefined
        ? { notBefore: req.confirmationsNotBefore }
        : {}),
    };
    confirmation = findValidConfirmation(req.confirmations ?? [], validity);
    if (!confirmation)
      throw new DomainError("approval_self_approval_not_allowed", {
        actorId: req.actorId,
        revisionId: target.id,
        hint: "independent_confirmation_required",
      });
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
      independentConfirmation: confirmation
        ? {
            id: confirmation.id,
            confirmerId: confirmation.confirmerId,
            confirmedAt: confirmation.confirmedAt,
          }
        : null,
      revisionSequence: target.sequence,
    },
  };
}

/**
 * 校了できる版（最新の通常版）かを確かめて、その版を返す。0版（ラフ）・古い版・知らない版は拒否。
 * 校了と独立確認で共用する。
 */
export function assertFinalCandidate(
  revisions: readonly Revision[],
  revisionId: RevisionId,
): Revision {
  const candidate = latestStandardRevision(revisions);
  const target = revisions.find((r) => r.id === revisionId);
  if (!target) throw new DomainError("approval_revision_not_candidate", { revisionId });
  if (target.kind === "rough")
    throw new DomainError("approval_rough_revision", { revisionId: target.id });
  if (!candidate || candidate.id !== target.id) {
    throw new DomainError("approval_revision_not_candidate", {
      revisionId: target.id,
      latest: candidate?.id ?? null,
    });
  }
  return target;
}

/** 自己校了（制作者＝校了権限者）のため、校了の前に独立確認が要る制作物か（D2。ポリシー値で切り替える） */
export function requiresIndependentConfirmation(
  work: Pick<Work, "creatorIds" | "approverId">,
  policy: ApprovalPolicy = defaultApprovalPolicy,
): boolean {
  return !policy.allowSelfApproval && work.creatorIds.includes(work.approverId);
}

export interface IndependentConfirmationRequest {
  work: Work;
  revisions: readonly Revision[];
  revisionId: RevisionId;
  confirmerId: UserId;
  policy?: ApprovalPolicy;
}

/**
 * 独立確認を記録してよいかを評価し、対象版を返す（D2）。
 * 認可（制作物の確認に参加できる人か = `approval.confirm`）は呼び出し側で先に通す。
 * - 進行中の制作物で、自己校了のため独立確認が要ること
 * - 確認者が制作者・校了権限者でないこと
 * - 対象版がいまの校了候補（最新の通常版）であること
 */
export function evaluateIndependentConfirmation(req: IndependentConfirmationRequest): Revision {
  const policy = req.policy ?? defaultApprovalPolicy;
  assertWorkActive(req.work);
  if (!requiresIndependentConfirmation(req.work, policy))
    throw new DomainError("approval_confirmation_not_needed", { workId: req.work.id });
  if (!isIndependentOf(req.work, req.confirmerId))
    throw new DomainError("approval_confirmer_not_independent", { confirmerId: req.confirmerId });
  return assertFinalCandidate(req.revisions, req.revisionId);
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
