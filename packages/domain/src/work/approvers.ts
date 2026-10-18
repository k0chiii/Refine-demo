import { DomainError } from "../shared/DomainError.ts";
import type { UserId } from "../shared/ids.ts";

/**
 * 校了権限者（校了者）と「校了とみなす人数」（利用者決定 2026-10-18。確定方針 C3 の「一人」を置き換える）。
 *
 * 保存の形（後方互換。既存の制作物は移行しない）:
 * - `approverId` … 校了者の先頭の 1 人。これまでの項目で、古い行にはこれしか無い
 * - `approverIds` … 校了者の全員（1 人以上・重複なし）。無ければ `[approverId]`
 * - `approvalQuorum` … 校了とみなす人数（1 以上・校了者の数以下）。無ければ 1（「誰か 1 人」）
 * 読み方はこのファイルの {@link approvalSetupOf} に一本化する。書くときは {@link normalizeApprovalSetup} を通す。
 */
export interface ApprovalSetup {
  /** 校了者の全員（先頭が approverId） */
  approverIds: UserId[];
  /** 校了とみなす人数（1..approverIds.length） */
  quorum: number;
}

/** 読み書きの対象になる項目（Work の一部） */
export interface WorkApproverFields {
  approverId: UserId;
  approverIds?: readonly UserId[] | undefined;
  approvalQuorum?: number | undefined;
}

/**
 * 保存された Work から、校了者の全員と校了とみなす人数を読む（古い行にも使える）。
 * 値が範囲外でも例外にせず、読める値に寄せる（人数は 1..校了者の数）。書き込みの検証は {@link normalizeApprovalSetup}
 */
export function approvalSetupOf(work: WorkApproverFields): ApprovalSetup {
  const approverIds =
    work.approverIds && work.approverIds.length > 0 ? [...work.approverIds] : [work.approverId];
  const raw = work.approvalQuorum;
  const quorum =
    typeof raw === "number" && Number.isFinite(raw)
      ? Math.min(Math.max(Math.trunc(raw), 1), approverIds.length)
      : 1;
  return { approverIds, quorum };
}

/** 校了者の全員 */
export function approversOf(work: WorkApproverFields): UserId[] {
  return approvalSetupOf(work).approverIds;
}

/** その人は、この制作物の校了者か */
export function isApproverOf(work: WorkApproverFields, userId: UserId): boolean {
  return approversOf(work).includes(userId);
}

function invalid(field: string, reason: string, extra = {}) {
  return new DomainError("work_invalid", { field, reason, ...extra });
}

export interface ApprovalSetupInput {
  /** これまでの項目（1 人）。approverIds が無いときだけ使う */
  approverId?: string | undefined;
  approverIds?: readonly string[] | undefined;
  /** 無ければ 1（誰か 1 人） */
  approvalQuorum?: number | undefined;
}

/**
 * 書き込む校了者と人数を確かめて整える。違反は `work_invalid`。
 * - 校了者: 1 人以上。空の ID は不可（重なりは 1 人にまとめる）
 * - 校了とみなす人数: 整数で 1 以上、校了者の数（重なりを除いた数）以下。省略は 1
 * 制作者を校了者に含めてよい。制作者本人の校了は独立確認（D2）が済んでいる版にだけ数えるので、
 * 人数に届かない設定として弾くことはしない（DECISIONS 2026-10-18）。
 */
export function normalizeApprovalSetup(input: ApprovalSetupInput): ApprovalSetup {
  // これまでの項目（approverId 1 つ）が空のときは「未指定」と同じ（required）
  const legacy = input.approverId?.trim() ? [input.approverId] : [];
  const raw = input.approverIds ?? legacy;
  const approverIds: UserId[] = [];
  for (const r of raw) {
    const id = typeof r === "string" ? r.trim() : "";
    if (id === "") throw invalid("approverIds", "blank_id");
    if (!approverIds.includes(id)) approverIds.push(id);
  }
  if (approverIds.length === 0) throw invalid("approverIds", "required");
  const quorum = input.approvalQuorum ?? 1;
  if (!Number.isInteger(quorum) || quorum < 1 || quorum > approverIds.length)
    throw invalid("approvalQuorum", "out_of_range", { max: approverIds.length });
  return { approverIds, quorum };
}
