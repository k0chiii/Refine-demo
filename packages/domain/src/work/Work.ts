import { DomainError } from "../shared/DomainError.ts";
import type { RevisionId, UserId, WorkId } from "../shared/ids.ts";
import type { Instant } from "../shared/time.ts";
import type { WorkGenre, WorkSubGenre } from "./metadata.ts";
import type { RegisteredPlanInfo } from "./planInfo.ts";

/** Work.lifecycle（§5.1）。校正受付・校了とは独立した状態。 */
export const workLifecycles = ["draft", "active", "on_hold", "finalized", "cancelled"] as const;
export type WorkLifecycle = (typeof workLifecycles)[number];

/** 機密区分。細則は D3 承認待ちのため値を増減しやすい列挙にしておく。 */
export const confidentialities = ["normal", "restricted"] as const;
export type Confidentiality = (typeof confidentialities)[number];

/** 媒体種別。導入対象外（external）は外部リンクで管理する（C5 / A-12）。 */
export const mediaTypes = [
  "pdf",
  "image",
  "document",
  "sns",
  "video",
  "web",
  "figma",
  "other",
] as const;
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
  /**
   * 校了権限者の先頭の 1 人（これまでの項目。古い行にはこれしか無い）。全員は `approverIds`、
   * 読むときは必ず approvers.ts の approvalSetupOf を通す
   */
  approverId: UserId;
  /** 校了権限者の全員（利用者決定 2026-10-18）。無ければ `[approverId]` */
  approverIds?: readonly UserId[];
  /** 校了とみなす人数（1..校了者の数）。無ければ 1（誰か 1 人が宣言すれば校了） */
  approvalQuorum?: number;
  /** ◆校了目標日（decisions 81。旧「納期」語の deadlineAt） */
  deadlineAt?: Instant;
  /** ■仕上がり日（decisions 81） */
  finishAt?: Instant;
  /** 第 n 版の予定提出日（decisions 82） */
  revisionPlannedAt?: readonly { sequence: number; at: Instant }[];
  lifecycle: WorkLifecycle;
  confidentiality: Confidentiality;
  finalRevisionId?: RevisionId;
  /**
   * 表記統一で使うルールカテゴリ（A1, B など）。制作物ごとに人が選ぶ。媒体・部署から自動では決めない。
   * 未設定・空なら表記の検査をしない（登録・編集画面で選ぶよう促す）
   */
  notationCategories?: readonly string[];
  /** SNS 投稿の制作物で使うアカウント（本体の設定の SocialProfile の ID） */
  socialProfileId?: string;

  // ---- Notion の制作物 DB に揃えた項目（利用者決定 2026-10-17。docs/NOTION_ALIGNMENT.md）。古い行には無いので全部任意
  /** 大ジャンル */
  genre?: WorkGenre;
  /** 小ジャンル（区分 category はここから既定を入れる） */
  subGenre?: WorkSubGenre;
  /** 関係者（職責ではない。閲覧権限は付かない） */
  stakeholderIds?: readonly UserId[];
  /**
   * 校正者の名簿（制作物ごと）。undefined は一度も保存していない古い行。[] は明示的に誰もいない。
   * 読むのは reviewerRosterOf。書くのは登録、名簿の保存、未設定の行を版の確定で書き戻すときだけ。
   */
  reviewerIds?: readonly UserId[];
  /** 入稿日・投稿日・印刷日（時刻を含むことがある） */
  publishAt?: Instant;
  /** 入稿の有無（印刷所などへ入稿する制作物か） */
  requiresPrinterSubmission?: boolean;
  /** 印刷する部数／枚数／個数 */
  printQuantity?: number;
  /** サイズ・尺（A4、1920×1080、30 秒 など） */
  sizeOrLength?: string;
  /** 制作日数 */
  productionDays?: number;
  /** タグ（Notion の選択肢を候補にするが、ほかの語も可） */
  tags?: readonly string[];
  /** 登録済み企画情報（情報校正 AI。decisions 69–72） */
  registeredPlanInfo?: RegisteredPlanInfo;
  /** 楽観的排他用のバージョン */
  version: number;
}

/**
 * Notion の「有効性」（checkbox）に相当する値。中止（cancelled）した制作物だけが無効。別の真偽値は持たない
 * （Notion の「校了済み」も同じく lifecycle が finalized かどうかで導く）
 */
export function isWorkEffective(work: Pick<Work, "lifecycle">): boolean {
  return work.lifecycle !== "cancelled";
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
