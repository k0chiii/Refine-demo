import { DomainError } from "../shared/DomainError.ts";
import type { RevisionId, UserId, WorkId } from "../shared/ids.ts";
import type { Instant } from "../shared/time.ts";

/** Work.lifecycle（§5.1）。校正受付・校了とは独立した状態。 */
export const workLifecycles = ["draft", "active", "on_hold", "finalized", "cancelled"] as const;
export type WorkLifecycle = (typeof workLifecycles)[number];

/** 機密区分。細則は D3 承認待ちのため値を増減しやすい列挙にしておく。 */
export const confidentialities = ["normal", "restricted"] as const;
export type Confidentiality = (typeof confidentialities)[number];

/** 媒体種別。導入対象外（external）は外部リンクで管理する（C5 / A-12）。 */
export const mediaTypes = ["pdf", "image", "document", "video", "web", "figma", "other"] as const;
export type MediaType = (typeof mediaTypes)[number];

export interface Work {
  id: WorkId;
  /** 過年度・外部 ID。内部 ID と混同しない。 */
  legacyId?: string;
  year: number;
  title: string;
  purpose: string;
  category: string;
  mediaType: MediaType;
  /** 主管担当（将来 TeamRef に接続）。 */
  ownerTeamId?: string;
  productionTeamIds: readonly string[];
  relatedTeamIds: readonly string[];
  /** 制作統括・主管の担当者（登録・変更権限） */
  managerIds: readonly UserId[];
  /** 制作者（版提出・採否判断） */
  creatorIds: readonly UserId[];
  /** 校了権限者（一人） */
  approverId: UserId;
  deadlineAt?: Instant;
  lifecycle: WorkLifecycle;
  confidentiality: Confidentiality;
  finalRevisionId?: RevisionId;
  /** 楽観的排他用のバージョン */
  version: number;
}

const transitions: Record<WorkLifecycle, readonly WorkLifecycle[]> = {
  draft: ["active", "cancelled"],
  active: ["on_hold", "cancelled", "finalized"],
  on_hold: ["active", "cancelled"],
  finalized: ["active"], // 再開（reopen）のみ。別の監査イベントを伴う。
  cancelled: [],
};

export function canTransition(from: WorkLifecycle, to: WorkLifecycle): boolean {
  return transitions[from].includes(to);
}

export function transitionLifecycle(work: Work, to: WorkLifecycle): Work {
  if (!canTransition(work.lifecycle, to)) {
    throw new DomainError("work_invalid_lifecycle_transition", { from: work.lifecycle, to });
  }
  return { ...work, lifecycle: to, version: work.version + 1 };
}

export function assertWorkActive(work: Work): void {
  if (work.lifecycle === "finalized")
    throw new DomainError("work_already_finalized", { workId: work.id });
  if (work.lifecycle !== "active")
    throw new DomainError("work_not_active", { workId: work.id, lifecycle: work.lifecycle });
}

export function assertExpectedVersion(
  work: { version: number },
  expectedVersion: number | undefined,
): void {
  if (expectedVersion !== undefined && expectedVersion !== work.version) {
    throw new DomainError("version_conflict", { expected: expectedVersion, actual: work.version });
  }
}
