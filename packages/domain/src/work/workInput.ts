import { DomainError } from "../shared/DomainError.ts";
import type { UserId } from "../shared/ids.ts";
import { confidentialities, mediaTypes, type Work } from "./Work.ts";

/**
 * 制作物（Work）の生成・変更で共通に守る不変条件。
 * 登録（1 件ずつ・CSV の一括）と変更のどの経路でも、この関数を通してから保存する。
 * - 名称: 前後の空白を除いて 1 文字以上 {@link WORK_TITLE_MAX} 文字まで
 * - 区分: 前後の空白を除いて 1 文字以上 {@link WORK_CATEGORY_MAX} 文字まで
 * - 制作者: 1 人以上。空の ID は不可（重複は 1 人にまとめる）
 * - 校了権限者: ちょうど 1 人（空の ID は不可）
 * - 主管: 空の ID は不可（重複は 1 人にまとめる。0 人は可）
 * 人が実在する（委員である）かは、アプリケーション層が名簿（PeopleDirectory）で確かめる。
 */
export const WORK_TITLE_MAX = 200;
export const WORK_CATEGORY_MAX = 100;

/** 検証の対象になる項目 */
export interface WorkEssentials {
  title: string;
  category: string;
  creatorIds: readonly UserId[];
  approverId: UserId;
  managerIds: readonly UserId[];
}

type WorkInvalidField = "title" | "category" | "creatorIds" | "approverId" | "managerIds";

function invalid(
  field: WorkInvalidField | "mediaType" | "confidentiality",
  reason: string,
  extra = {},
) {
  return new DomainError("work_invalid", { field, reason, ...extra });
}

function cleanIds(ids: readonly string[], field: WorkInvalidField): UserId[] {
  const out: UserId[] = [];
  for (const raw of ids) {
    const id = typeof raw === "string" ? raw.trim() : "";
    if (id === "") throw invalid(field, "blank_id");
    if (!out.includes(id)) out.push(id);
  }
  return out;
}

/** 不変条件を確かめ、正規化した値（名称・区分は trim 済み、ID は重複なし）を返す。違反は `work_invalid` */
export function normalizeWorkEssentials<T extends WorkEssentials>(fields: T): T {
  const title = fields.title.trim();
  if (title === "") throw invalid("title", "required");
  if (title.length > WORK_TITLE_MAX) throw invalid("title", "too_long", { max: WORK_TITLE_MAX });
  const category = fields.category.trim();
  if (category === "") throw invalid("category", "required");
  if (category.length > WORK_CATEGORY_MAX)
    throw invalid("category", "too_long", { max: WORK_CATEGORY_MAX });
  const creatorIds = cleanIds(fields.creatorIds, "creatorIds");
  if (creatorIds.length === 0) throw invalid("creatorIds", "required");
  const approverId = fields.approverId.trim();
  if (approverId === "") throw invalid("approverId", "required");
  const managerIds = cleanIds(fields.managerIds, "managerIds");
  return { ...fields, title, category, creatorIds, approverId, managerIds };
}

/** Work の変更で受け付ける項目（組織・SNS アカウント・表記カテゴリの正規化と存在確認はアプリケーション層） */
export type WorkPatch = {
  [
    K in
      | "title"
      | "purpose"
      | "category"
      | "mediaType"
      | "deadlineAt"
      | "creatorIds"
      | "approverId"
      | "managerIds"
      | "confidentiality"
      | "legacyId"
      | "productionTeamIds"
      | "relatedTeamIds"
      | "notationCategories"
  ]?: Work[K] | undefined;
};

/**
 * Work に変更を当てた結果を返す（version を 1 進める）。生成時と同じ不変条件を検証する。
 * undefined の項目は「変えない」。
 */
export function applyWorkPatch(work: Work, patch: WorkPatch): Work {
  const defined: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(patch)) if (v !== undefined) defined[k] = v;
  const next = { ...work, ...(defined as WorkPatch), version: work.version + 1 } as Work;
  if (!(mediaTypes as readonly string[]).includes(next.mediaType))
    throw invalid("mediaType", "unknown");
  if (!(confidentialities as readonly string[]).includes(next.confidentiality))
    throw invalid("confidentiality", "unknown");
  return normalizeWorkEssentials(next);
}

/**
 * 変更後の Work が新たに参照する人（制作者・校了権限者・主管）。
 * 既に参照していた人は確かめ直さない（名簿から外れた人がいても、無関係な変更を止めない）。
 */
export function newlyReferencedPeople(
  before: Pick<Work, "creatorIds" | "approverId" | "managerIds"> | null,
  after: Pick<Work, "creatorIds" | "approverId" | "managerIds">,
): UserId[] {
  const known = new Set(
    before ? [...before.creatorIds, before.approverId, ...before.managerIds] : [],
  );
  return Array.from(
    new Set(
      [...after.creatorIds, after.approverId, ...after.managerIds].filter((id) => !known.has(id)),
    ),
  );
}
