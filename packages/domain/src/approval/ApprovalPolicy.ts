import type { CommentThread, Severity } from "../comment/CommentThread.ts";
import { incompleteChecks, type RequiredCheck } from "../review/RequiredCheck.ts";
import { isBlockingForApproval } from "../comment/CommentThread.ts";
import type { Revision } from "../revision/Revision.ts";
import { latestStandardRevision } from "../revision/Revision.ts";
import { DomainError } from "../shared/DomainError.ts";
import type { RevisionId, UserId, WorkId } from "../shared/ids.ts";
import type { Instant } from "../shared/time.ts";
import type { WorkPermissionGrant } from "../acl/Permission.ts";
import { approvalSetupOf, isApproverOf } from "../work/approvers.ts";
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
  /**
   * この制作物の校了の履歴（記録した順）。校了者ごとの宣言を数えるのに使う（利用者決定 2026-10-18）。
   * 省略すると宣言は 0 件として扱い、校了とみなす人数が 1 ならこの宣言だけで校了になる。
   */
  events?: readonly ApprovalEvent[];
  policy?: ApprovalPolicy;
}

export interface FinalizationOutcome {
  /** この宣言で「校了とみなす人数」に届いたか（届いたら校了に進む。届かなければ宣言の記録だけ） */
  reached: boolean;
  /** 校了とみなす人数 */
  quorum: number;
  /** この宣言を含めて、校了を宣言した校了者（記録した順） */
  declaredApproverIds: readonly UserId[];
  /** 先に宣言した人が付けた例外理由（届いたときの校了を例外校了として残すため）。無ければ undefined */
  priorExceptionReason: string | undefined;
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
  const setup = approvalSetupOf(work);
  if (!setup.approverIds.includes(req.actorId))
    throw new DomainError("approval_not_approver", { actorId: req.actorId });

  const target = assertFinalCandidate(req.revisions, req.revisionId);

  // 校了者ごとの宣言（この版・最後の再開より後・いまの校了者のみ）。同じ人の宣言は 1 人と数える
  const prior = declarationsOf(req.events ?? [], target.id).filter((d) =>
    setup.approverIds.includes(d.actorId),
  );
  const declared = prior.map((d) => d.actorId);
  // 人数に届いていないのに同じ人が重ねて宣言することはできない。
  // すでに届いている（人数を減らした・校了者を外したなど）のに校了に進んでいないときは、残りの校了者の宣言で校了に進める
  if (declared.includes(req.actorId) && declared.length < setup.quorum)
    throw new DomainError("approval_already_declared", { actorId: req.actorId });
  const declaredApproverIds = declared.includes(req.actorId)
    ? declared
    : [...declared, req.actorId];

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
    reached: declaredApproverIds.length >= setup.quorum,
    quorum: setup.quorum,
    declaredApproverIds,
    priorExceptionReason: prior.find((d) => d.exceptionReason !== undefined)?.exceptionReason,
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
      approval: { quorum: setup.quorum, declaredApproverIds },
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

/**
 * 自己校了（制作者＝校了権限者）の校了者がいて、その人の校了の前に独立確認が要る制作物か（D2。ポリシー値で切り替える）。
 * 校了者が複数のときは、制作者でもある校了者が 1 人でもいれば真（独立確認の欄を出す・記録を受け付ける）。
 * 要るのはその校了者本人の宣言だけ（{@link requiresIndependentConfirmationFor}）
 */
export function requiresIndependentConfirmation(
  work: Pick<Work, "creatorIds" | "approverId" | "approverIds">,
  policy: ApprovalPolicy = defaultApprovalPolicy,
): boolean {
  return (
    !policy.allowSelfApproval &&
    approvalSetupOf(work).approverIds.some((id) => work.creatorIds.includes(id))
  );
}

/** その校了者が宣言するのに独立確認が要るか（制作者本人が校了者のとき。D2 は校了者ごとに見る） */
export function requiresIndependentConfirmationFor(
  work: Pick<Work, "creatorIds" | "approverId" | "approverIds">,
  userId: UserId,
  policy: ApprovalPolicy = defaultApprovalPolicy,
): boolean {
  return (
    !policy.allowSelfApproval && isApproverOf(work, userId) && work.creatorIds.includes(userId)
  );
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

/**
 * `declared` は、校了とみなす人数に届かない段階の校了者 1 人の宣言（校了にはまだ進まない）。
 * 届いた宣言は従来どおり `finalized` / `exception_finalized` として残す（人数が 1 のときはこれだけ）。
 */
export type ApprovalAction = "declared" | "finalized" | "reopened" | "exception_finalized";

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

/** 版ごとの校了者 1 人の宣言（宣言の記録と、校了そのものの記録を同じ形で扱う） */
export interface ApprovalDeclaration {
  actorId: UserId;
  at: Instant;
  exceptionReason?: string;
}

/**
 * その版に対する校了者ごとの宣言（同じ人は最初の 1 件だけ）。履歴は記録した順に渡す。
 * 再開（reopened）が入ったら、それより前の宣言は数えない（再開のあとは宣言し直す）。
 * `declared`・`finalized`・`exception_finalized` が宣言。人数が 1 のとき校了の記録がそのまま 1 人分の宣言になる
 * （古い履歴も同じに読める）。いまの校了者かどうかは呼び出し側で絞る。
 */
export function declarationsOf(
  events: readonly ApprovalEvent[],
  revisionId: RevisionId,
): ApprovalDeclaration[] {
  let current: ApprovalDeclaration[] = [];
  for (const e of events) {
    if (e.action === "reopened") {
      current = [];
      continue;
    }
    if (e.revisionId !== revisionId || current.some((d) => d.actorId === e.actorId)) continue;
    current.push({
      actorId: e.actorId,
      at: e.createdAt,
      ...(e.exceptionReason !== undefined ? { exceptionReason: e.exceptionReason } : {}),
    });
  }
  return current;
}

export interface ApprovalProgress {
  /** 校了者の全員 */
  approverIds: readonly UserId[];
  /** 校了とみなす人数 */
  quorum: number;
  /** 宣言した校了者（いまの校了者のみ） */
  declaredIds: readonly UserId[];
  /** 数えている版（進行中は校了候補の版、校了後は校了した版）。無ければ null */
  revisionId: RevisionId | null;
  /** 人数に届いているか */
  reached: boolean;
}

/** 校了の進み具合（n 人中 m 人）。画面はこれをそのまま出す */
export function approvalProgressOf(
  work: Pick<
    Work,
    "lifecycle" | "finalRevisionId" | "approverId" | "approverIds" | "approvalQuorum"
  >,
  events: readonly ApprovalEvent[],
  revisions: readonly Revision[],
): ApprovalProgress {
  const setup = approvalSetupOf(work);
  const revisionId =
    work.lifecycle === "finalized"
      ? (work.finalRevisionId ?? null)
      : (latestStandardRevision(revisions)?.id ?? null);
  const declaredIds =
    revisionId === null
      ? []
      : declarationsOf(events, revisionId)
          .map((d) => d.actorId)
          .filter((id) => setup.approverIds.includes(id));
  return {
    approverIds: setup.approverIds,
    quorum: setup.quorum,
    declaredIds,
    revisionId,
    reached: declaredIds.length >= setup.quorum,
  };
}
