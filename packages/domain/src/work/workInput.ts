import { DomainError } from "../shared/DomainError.ts";
import type { UserId } from "../shared/ids.ts";
import {
  approvalSetupOf,
  approversOf,
  creatorsAmongApprovers,
  normalizeApprovalSetup,
} from "./approvers.ts";
import { normalizeWorkTags, WORK_SIZE_MAX, workGenres, workSubGenreCodes } from "./metadata.ts";
import { confidentialities, mediaTypes, type Work } from "./Work.ts";

/**
 * 制作物（Work）の生成・変更で共通に守る不変条件。
 * 登録（1 件ずつ・CSV の一括）と変更のどの経路でも、この関数を通してから保存する。
 * - 名称: 前後の空白を除いて 1 文字以上 {@link WORK_TITLE_MAX} 文字まで
 * - 区分: 前後の空白を除いて 1 文字以上 {@link WORK_CATEGORY_MAX} 文字まで
 * - 制作者: 1 人以上。空の ID は不可（重複は 1 人にまとめる）
 * - 校了権限者: 1 人以上（空の ID は不可）と、校了とみなす人数（1..校了者の数。省略は 1。利用者決定 2026-10-18）。
 *   制作者は校了者に含められない（利用者決定 2026-10-18「制作者が校了者になることはないです」）
 * - 主管: 空の ID は不可（重複は 1 人にまとめる。0 人は可）
 * 人が実在する（委員である）かは、アプリケーション層が名簿（PeopleDirectory）で確かめる。
 */
export const WORK_TITLE_MAX = 200;
export const WORK_CATEGORY_MAX = 100;

/**
 * 制作物に付ける担当の数のポリシー値。
 * 利用者決定 2026-10-17「制作担当は基本 1 つ。あとから変更される場合はある」（2026-10-15 の「複数」を置き換える）。
 * 保存の形は配列のまま（古い行に 2 つ以上あっても読める。確かめるのは書き込みで、しかも項目を変えるときだけ）。
 * 複数に戻すなら `maxProductionTeams` を上げる。
 */
export interface WorkTeamPolicy {
  /** 制作担当（productionTeamIds）に選べる数の上限 */
  maxProductionTeams: number;
}

export const defaultWorkTeamPolicy: WorkTeamPolicy = { maxProductionTeams: 1 };

/** 検証の対象になる項目 */
export interface WorkEssentials {
  title: string;
  category: string;
  creatorIds: readonly UserId[];
  /** 校了権限者。approverIds があればそちらが優先（無ければ approverId の 1 人） */
  approverId?: UserId | undefined;
  approverIds?: readonly UserId[] | undefined;
  approvalQuorum?: number | undefined;
  managerIds: readonly UserId[];
}

type WorkInvalidField =
  | "title"
  | "category"
  | "creatorIds"
  | "approverIds"
  | "managerIds"
  | "stakeholderIds"
  | "productionTeamIds";

function invalid(field: string, reason: string, extra = {}) {
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

/**
 * 制作担当の ID を整える（前後の空白・空・重なりを除く。画面の「なし」は空文字で届く）。
 * ポリシーの上限（既定 1 つ）を超えると `work_invalid`（field productionTeamIds・reason too_many・max）。
 * 担当が組織にあるかは、アプリケーション層が確かめる。
 */
export function normalizeProductionTeamIds(
  ids: readonly string[],
  policy: WorkTeamPolicy = defaultWorkTeamPolicy,
): string[] {
  const out = Array.from(new Set(ids.map((id) => id.trim()).filter((id) => id !== "")));
  if (out.length > policy.maxProductionTeams)
    throw invalid("productionTeamIds", "too_many", { max: policy.maxProductionTeams });
  return out;
}

/** 不変条件を確かめ、正規化した値（名称・区分は trim 済み、ID は重複なし）を返す。違反は `work_invalid` */
export function normalizeWorkEssentials<T extends WorkEssentials>(
  fields: T,
  /** 変更のとき: 決定前から「制作者でもある校了者」だった人（据え置きとして通す）。登録では渡さない */
  existingOverlap: readonly UserId[] = [],
): T & { approverId: UserId; approverIds: UserId[]; approvalQuorum: number } {
  const title = fields.title.trim();
  if (title === "") throw invalid("title", "required");
  if (title.length > WORK_TITLE_MAX) throw invalid("title", "too_long", { max: WORK_TITLE_MAX });
  const category = fields.category.trim();
  if (category === "") throw invalid("category", "required");
  if (category.length > WORK_CATEGORY_MAX)
    throw invalid("category", "too_long", { max: WORK_CATEGORY_MAX });
  const creatorIds = cleanIds(fields.creatorIds, "creatorIds");
  if (creatorIds.length === 0) throw invalid("creatorIds", "required");
  const { approverIds, quorum } = normalizeApprovalSetup(fields, { creatorIds, existingOverlap });
  const managerIds = cleanIds(fields.managerIds, "managerIds");
  return {
    ...fields,
    title,
    category,
    creatorIds,
    // approverId は先頭の 1 人（古い読み手・索引のために残す）
    approverId: approverIds[0]!,
    approverIds,
    approvalQuorum: quorum,
    managerIds,
  };
}

/**
 * Notion の制作物 DB に揃えた任意の項目（docs/NOTION_ALIGNMENT.md）。登録・変更・CSV で共通。
 * null は「消す」（変更のとき）。生成時は null も undefined も「無し」
 */
export type WorkMetadataInput = {
  [
    K in
      | "genre"
      | "subGenre"
      | "stakeholderIds"
      | "publishAt"
      | "requiresPrinterSubmission"
      | "printQuantity"
      | "sizeOrLength"
      | "productionDays"
      | "tags"
  ]?: Work[K] | null | undefined;
};
export const workMetadataKeys = [
  "genre",
  "subGenre",
  "stakeholderIds",
  "publishAt",
  "requiresPrinterSubmission",
  "printQuantity",
  "sizeOrLength",
  "productionDays",
  "tags",
] as const satisfies ReadonlyArray<keyof WorkMetadataInput>;

/**
 * Notion に揃えた項目を確かめて整える。undefined は「触らない」（返り値にも入れない）、null は「消す」（null で返す）。
 * - 大ジャンル・小ジャンルは選択肢の中の値。選択肢の一覧は metadata.ts（Notion の select）
 * - 関係者: 空の ID は不可、重なりは 1 人に。実在は application が名簿で確かめる
 * - 部数・制作日数: 0 以上の整数。サイズ・尺: 100 文字まで。タグ: 20 個・各 30 文字まで
 */
export function normalizeWorkMetadata(input: WorkMetadataInput): WorkMetadataInput {
  const out: WorkMetadataInput = {};
  const { genre, subGenre, stakeholderIds, publishAt, sizeOrLength, tags } = input;
  if (genre !== undefined) {
    if (genre !== null && !(workGenres as readonly string[]).includes(genre))
      throw invalid("genre", "unknown");
    out.genre = genre;
  }
  if (subGenre !== undefined) {
    if (subGenre !== null && !(workSubGenreCodes as readonly string[]).includes(subGenre))
      throw invalid("subGenre", "unknown");
    out.subGenre = subGenre;
  }
  if (stakeholderIds !== undefined)
    out.stakeholderIds =
      stakeholderIds === null || stakeholderIds.length === 0
        ? null
        : cleanIds(stakeholderIds, "stakeholderIds");
  if (publishAt !== undefined) {
    if (publishAt !== null && (!Number.isFinite(publishAt) || publishAt <= 0))
      throw invalid("publishAt", "not_a_time");
    out.publishAt = publishAt;
  }
  if (input.requiresPrinterSubmission !== undefined)
    out.requiresPrinterSubmission = input.requiresPrinterSubmission;
  for (const k of ["printQuantity", "productionDays"] as const) {
    const n = input[k];
    if (n === undefined) continue;
    if (n !== null && (!Number.isInteger(n) || n < 0 || n > 1_000_000_000))
      throw invalid(k, "not_a_count");
    out[k] = n;
  }
  if (sizeOrLength !== undefined) {
    const s = sizeOrLength?.trim() ?? "";
    if (Array.from(s).length > WORK_SIZE_MAX)
      throw invalid("sizeOrLength", "too_long", { max: WORK_SIZE_MAX });
    out.sizeOrLength = s === "" ? null : s;
  }
  if (tags !== undefined) {
    const clean = tags === null ? [] : normalizeWorkTags(tags);
    out.tags = clean.length === 0 ? null : clean;
  }
  return out;
}

/** 整えた項目を Work に当てる（null の項目は消す）。生成・変更で共通 */
export function assignWorkMetadata<T extends Partial<Work>>(target: T, meta: WorkMetadataInput): T {
  const t = target as Record<string, unknown>;
  for (const k of workMetadataKeys) {
    const v = meta[k];
    if (v === undefined) continue;
    if (v === null) delete t[k];
    else t[k] = v;
  }
  return target;
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
      | "approverIds"
      | "approvalQuorum"
      | "managerIds"
      | "confidentiality"
      | "legacyId"
      | "productionTeamIds"
      | "relatedTeamIds"
      | "notationCategories"
  ]?: Work[K] | undefined;
} & WorkMetadataInput;

/**
 * Work に変更を当てた結果を返す（version を 1 進める）。生成時と同じ不変条件を検証する。
 * undefined の項目は「変えない」。Notion に揃えた任意の項目は null で消せる。
 * 制作担当は変えるときだけ上限（{@link WorkTeamPolicy}）を確かめる（古い行に 2 つ以上あっても、ほかの変更は止めない）。
 */
export function applyWorkPatch(
  work: Work,
  patch: WorkPatch,
  teamPolicy: WorkTeamPolicy = defaultWorkTeamPolicy,
): Work {
  const defined: Record<string, unknown> = {};
  const meta: WorkMetadataInput = {};
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) continue;
    if ((workMetadataKeys as readonly string[]).includes(k))
      (meta as Record<string, unknown>)[k] = v;
    else defined[k] = v;
  }
  if (patch.productionTeamIds !== undefined)
    defined.productionTeamIds = normalizeProductionTeamIds(patch.productionTeamIds, teamPolicy);
  const next = { ...work, ...(defined as WorkPatch), version: work.version + 1 } as Work;
  // 決定（2026-10-18）より前に保存された行には、制作者が校了者に入っているものが残る。その据え置きは通し、新しい重なりだけ弾く
  const existingOverlap = creatorsAmongApprovers(work.creatorIds, approversOf(work));
  // 校了者: これまでの approverId だけの変更は「その 1 人に置き換える」。人数は、指定が無ければ今の値を校了者の数に収める
  const approversPatched = patch.approverIds !== undefined || patch.approverId !== undefined;
  if (approversPatched) {
    // 空の approverId は「校了者なし」（required で弾く）
    const ids = patch.approverIds ?? (patch.approverId?.trim() ? [patch.approverId] : []);
    if (patch.approverIds === undefined) next.approverIds = ids;
    if (patch.approvalQuorum === undefined)
      next.approvalQuorum = Math.min(approvalSetupOf(work).quorum, Math.max(ids.length, 1));
  }
  if (!(mediaTypes as readonly string[]).includes(next.mediaType))
    throw invalid("mediaType", "unknown");
  if (!(confidentialities as readonly string[]).includes(next.confidentiality))
    throw invalid("confidentiality", "unknown");
  assignWorkMetadata(next, normalizeWorkMetadata(meta));
  return normalizeWorkEssentials(next, existingOverlap);
}

type PeopleFields = Pick<Work, "creatorIds" | "approverId" | "managerIds"> & {
  approverIds?: readonly UserId[] | undefined;
  stakeholderIds?: readonly UserId[] | undefined;
};

const peopleOf = (w: PeopleFields) => [
  ...w.creatorIds,
  ...approversOf(w),
  ...w.managerIds,
  ...(w.stakeholderIds ?? []),
];

/**
 * 変更後の Work が新たに参照する人（制作者・校了権限者・主管・関係者）。
 * 既に参照していた人は確かめ直さない（名簿から外れた人がいても、無関係な変更を止めない）。
 */
export function newlyReferencedPeople(before: PeopleFields | null, after: PeopleFields): UserId[] {
  const known = new Set(before ? peopleOf(before) : []);
  return Array.from(new Set(peopleOf(after).filter((id) => !known.has(id))));
}
