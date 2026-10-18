import {
  applyWorkPatch,
  approversOf,
  assertExpectedVersion,
  assignWorkMetadata,
  type Confidentiality,
  DomainError,
  type MediaType,
  newlyReferencedPeople,
  normalizeProductionTeamIds,
  normalizeWorkEssentials,
  normalizeWorkMetadata,
  orgPermissions,
  type Principal,
  requireOrgPermission,
  transitionLifecycle,
  type Work,
  type WorkImportInput,
  type WorkLifecycle,
  type WorkMetadataInput,
  WORK_IMPORT_MAX_ROWS,
  workMetadataKeys,
  type WorkPatch,
  type UserId,
} from "@mf100/domain";
import type { AppContext } from "../ports.ts";
import { loadAuthorizedWork } from "../shared.ts";

export interface CreateWorkInput extends WorkMetadataInput {
  title: string;
  purpose: string;
  category: string;
  mediaType: MediaType;
  year: number;
  legacyId?: string;
  ownerTeamId?: string;
  /** 制作担当。数の上限はドメインの WorkTeamPolicy（既定 1 つ。利用者決定 2026-10-17） */
  productionTeamIds?: string[];
  relatedTeamIds?: string[];
  managerIds?: string[];
  creatorIds: string[];
  /** 校了者。approverIds があればそちら（複数可）。無ければ approverId の 1 人（利用者決定 2026-10-18） */
  approverId?: string;
  approverIds?: string[];
  /** 校了とみなす人数（1..校了者の数。省略は 1） */
  approvalQuorum?: number;
  deadlineAt?: number;
  confidentiality?: Confidentiality;
  /** 表記統一のルールカテゴリ（人が選ぶ。空なら検査しない） */
  notationCategories?: string[];
  /** 登録と有効化を分ける案（§7.2）に備え、既定は即時 active。 */
  activate?: boolean;
  /**
   * 登録した人を主管に含めるか（既定 true）。一括登録では含めない: 管理者が全件の主管になってしまうため。
   * 主管は CSV の「主管」列だけ（利用者決定 2026-10-15・UI_M3E §36）
   */
  addRegistrantAsManager?: boolean;
}

/**
 * 制作物登録（F-02 / UC-01）。
 * 実装上の仮置き: 認証済みユーザーは誰でも登録でき、登録者は自動的に主管担当（managerIds）に含まれる。
 * 登録できる人は Nogiku の組織権限 `works:create` で管理する（利用者決定 2026-10-10）。Nogiku Access 未接続の MVP では全員が持つ。
 */
export async function createWork(
  ctx: AppContext,
  principal: Principal,
  input: CreateWorkInput,
): Promise<Work> {
  requireOrgPermission(principal, orgPermissions.worksCreate);
  // 名称・区分・制作者・校了権限者（複数・校了とみなす人数）・主管の不変条件は変更と同じドメイン関数で確かめる
  const essentials = normalizeWorkEssentials({
    title: input.title,
    category: input.category,
    creatorIds: input.creatorIds,
    approverId: input.approverId,
    approverIds: input.approverIds,
    approvalQuorum: input.approvalQuorum,
    managerIds: input.managerIds ?? [],
  });
  const managerIds = Array.from(
    new Set([
      ...essentials.managerIds,
      ...(input.addRegistrantAsManager === false ? [] : [principal.userId]),
    ]),
  );
  // Notion に揃えた任意の項目（大ジャンル・小ジャンル・関係者・入稿・タグ・リンク）はドメインで整える
  const meta = normalizeWorkMetadata(pickMetadata(input));
  // 登録した本人（主管に自動で入る）は確かめない。それ以外の職責・関係者の人は委員の名簿にいること
  await assertPeopleExist(ctx, { ...essentials, stakeholderIds: meta.stakeholderIds ?? [] });
  const ownerTeamId = input.ownerTeamId?.trim() || undefined;
  // 制作担当は 1 つまで（ポリシー値 WorkTeamPolicy）。関係担当は複数
  const productionTeamIds = normalizeProductionTeamIds(input.productionTeamIds ?? []);
  const relatedTeamIds = cleanTeamIds(input.relatedTeamIds ?? []);
  await assertTeamsExist(ctx, ownerTeamId, productionTeamIds, relatedTeamIds);
  const data: Omit<Work, "id"> = {
    year: input.year,
    title: essentials.title,
    purpose: input.purpose,
    category: essentials.category,
    mediaType: input.mediaType,
    productionTeamIds,
    relatedTeamIds,
    managerIds,
    creatorIds: essentials.creatorIds,
    approverId: essentials.approverId,
    approverIds: essentials.approverIds,
    approvalQuorum: essentials.approvalQuorum,
    lifecycle: input.activate === false ? "draft" : "active",
    confidentiality: input.confidentiality ?? "normal",
    version: 1,
  };
  if (input.legacyId !== undefined) data.legacyId = input.legacyId;
  if (ownerTeamId !== undefined) data.ownerTeamId = ownerTeamId;
  if (input.deadlineAt !== undefined) data.deadlineAt = input.deadlineAt;
  if (input.notationCategories !== undefined)
    data.notationCategories = cleanCategories(input.notationCategories);
  assignWorkMetadata(data, meta);
  const work = await ctx.works.insert(data);
  await ctx.audit.record({
    entityType: "work",
    entityId: work.id,
    operation: "create",
    actorId: principal.userId,
    after: work,
    at: ctx.clock.now(),
  });
  return work;
}

/**
 * 制作物の一括登録（CSV。利用者決定 2026-10-15「制作物の登録は管理者が一括で行う」）。
 * 画面で CSV を解析・照合（domain の parseWorkCsv / resolveWorkImport）して確認した行だけを受け取り、
 * 1 件ずつの登録と同じ {@link createWork}（権限 `works:create`・検証・監査）を通して、まとめて（1 トランザクションで）登録する。
 * どれか 1 行でも登録できなければ、何も登録しない。
 */
export async function importWorks(
  ctx: AppContext,
  principal: Principal,
  input: { rows: readonly WorkImportInput[]; source?: string },
): Promise<Work[]> {
  requireOrgPermission(principal, orgPermissions.worksCreate);
  if (input.rows.length === 0 || input.rows.length > WORK_IMPORT_MAX_ROWS)
    throw new DomainError("work_import_invalid", {
      reason: "row_count",
      count: input.rows.length,
      max: WORK_IMPORT_MAX_ROWS,
    });
  const created: Work[] = [];
  for (const [index, row] of input.rows.entries()) {
    try {
      created.push(
        await createWork(ctx, principal, {
          ...row,
          managerIds: row.managerIds,
          notationCategories: row.notationCategories,
          addRegistrantAsManager: false,
        }),
      );
    } catch (e) {
      // 1 件ずつの登録と同じ検証（createWork）で落ちた行は、何行目かを添えて返す
      if (e instanceof DomainError && e.code === "work_invalid")
        throw new DomainError("work_import_invalid", {
          ...e.details,
          reason: "row_invalid",
          index,
          cause: e.code,
          causeReason: e.details.reason ?? null,
        });
      throw e;
    }
  }
  await ctx.audit.record({
    entityType: "work",
    entityId: "bulk",
    operation: "bulk_import",
    actorId: principal.userId,
    after: {
      count: created.length,
      workIds: created.map((w) => w.id),
      ...(input.source ? { source: input.source } : {}),
    },
    at: ctx.clock.now(),
  });
  return created;
}

export interface UpdateWorkInput {
  workId: string;
  expectedVersion?: number;
  patch: WorkPatch & {
    /** 主管担当（空文字で外す） */
    ownerTeamId?: string;
    /** SNS のアカウント（本体の設定）の割り当て。null で外す */
    socialProfileId?: string | null;
  };
}

export async function updateWork(
  ctx: AppContext,
  principal: Principal,
  input: UpdateWorkInput,
): Promise<Work> {
  const { work } = await loadAuthorizedWork(ctx, principal, input.workId, "work.edit");
  assertExpectedVersion(work, input.expectedVersion);
  if (work.lifecycle === "finalized")
    throw new DomainError("work_already_finalized", { workId: work.id });
  const { socialProfileId, ownerTeamId, ...rest } = input.patch;
  const patch: WorkPatch = stripUndefined(rest);
  if (patch.notationCategories)
    patch.notationCategories = cleanCategories(patch.notationCategories);
  // 制作担当・関係担当は全体の置き換え（重複・空を除く）。制作担当の数の上限は applyWorkPatch（WorkTeamPolicy）で確かめる
  if (patch.productionTeamIds)
    patch.productionTeamIds = normalizeProductionTeamIds(patch.productionTeamIds);
  if (patch.relatedTeamIds) patch.relatedTeamIds = cleanTeamIds(patch.relatedTeamIds);
  const owner = ownerTeamId === undefined ? undefined : ownerTeamId.trim();
  await assertTeamsExist(
    ctx,
    owner || undefined,
    patch.productionTeamIds ?? [],
    patch.relatedTeamIds ?? [],
  );
  // 生成時と同じ不変条件（空でない名称・区分、1 人以上の制作者、1 人以上の校了権限者と校了とみなす人数、Notion に揃えた項目の形）をドメインで確かめる
  const next = applyWorkPatch(work, patch);
  // 新しく職責・関係者に入った人は委員の名簿にいること
  await assertPeopleExist(ctx, next, work);
  // 主管担当: 空文字は「主管担当なし」（外す）
  if (owner === "") delete next.ownerTeamId;
  else if (owner !== undefined) next.ownerTeamId = owner;
  if (socialProfileId === null) delete next.socialProfileId;
  else if (socialProfileId !== undefined) {
    if (!(await ctx.socialProfiles.findById(socialProfileId)))
      throw new DomainError("social_profile_invalid", { field: "socialProfileId" });
    next.socialProfileId = socialProfileId;
  }
  await ctx.works.update(next);
  await ctx.audit.record({
    entityType: "work",
    entityId: work.id,
    operation: "update",
    actorId: principal.userId,
    before: work,
    after: next,
    at: ctx.clock.now(),
  });
  return next;
}

export async function changeWorkLifecycle(
  ctx: AppContext,
  principal: Principal,
  input: { workId: string; to: Exclude<WorkLifecycle, "finalized">; expectedVersion?: number },
): Promise<Work> {
  const { work } = await loadAuthorizedWork(ctx, principal, input.workId, "work.edit");
  assertExpectedVersion(work, input.expectedVersion);
  // 校了・再開は approvals ユースケース経由のみ（監査イベントを伴う）。
  if (work.lifecycle === "finalized")
    throw new DomainError("work_already_finalized", { workId: work.id });
  const next = transitionLifecycle(work, input.to);
  await ctx.works.update(next);
  await ctx.audit.record({
    entityType: "work",
    entityId: work.id,
    operation: `lifecycle:${input.to}`,
    actorId: principal.userId,
    before: work.lifecycle,
    after: next.lifecycle,
    at: ctx.clock.now(),
  });
  return next;
}

/**
 * 職責（制作者・校了権限者・主管）と関係者に入る人が委員の名簿（PeopleDirectory）にいるか。
 * before を渡すと、既に入っていた人は確かめ直さない。知らない人は `work_invalid`（unknown_user）。
 */
async function assertPeopleExist(
  ctx: AppContext,
  after: {
    creatorIds: readonly UserId[];
    approverId: UserId;
    approverIds?: readonly UserId[] | undefined;
    managerIds: readonly UserId[];
    stakeholderIds?: readonly UserId[] | undefined;
  },
  before: Work | null = null,
): Promise<void> {
  const ids = newlyReferencedPeople(before, after);
  if (ids.length === 0) return;
  const known = new Set((await ctx.people.profiles(ids)).map((p) => p.id));
  const missing = ids.filter((id) => !known.has(id));
  if (missing.length === 0) return;
  const field = after.creatorIds.includes(missing[0]!)
    ? "creatorIds"
    : approversOf(after).includes(missing[0]!)
      ? "approverIds"
      : after.managerIds.includes(missing[0]!)
        ? "managerIds"
        : "stakeholderIds";
  throw new DomainError("work_invalid", { field, reason: "unknown_user", userIds: missing });
}

/** 登録の入力から Notion に揃えた項目だけを抜く（undefined の項目は入れない） */
function pickMetadata(input: WorkMetadataInput): WorkMetadataInput {
  const out: Record<string, unknown> = {};
  for (const k of workMetadataKeys) if (input[k] !== undefined) out[k] = input[k];
  return out as WorkMetadataInput;
}

function cleanTeamIds(ids: readonly string[]): string[] {
  return Array.from(new Set(ids.map((id) => id.trim()).filter((id) => id !== "")));
}

/** 主管担当・制作担当・関係担当が組織（局 › 担当）にあるか。空なら確かめない */
async function assertTeamsExist(
  ctx: AppContext,
  ownerTeamId: string | undefined,
  productionTeamIds: readonly string[],
  relatedTeamIds: readonly string[] = [],
): Promise<void> {
  const ids = [...(ownerTeamId ? [ownerTeamId] : []), ...productionTeamIds, ...relatedTeamIds];
  for (const id of new Set(ids))
    if (!(await ctx.teams.findById(id)))
      throw new DomainError("team_not_found", {
        teamId: id,
        field:
          id === ownerTeamId
            ? "ownerTeamId"
            : productionTeamIds.includes(id)
              ? "productionTeamIds"
              : "relatedTeamIds",
      });
}

function stripUndefined<T extends object>(obj: T): Partial<T> {
  const out: Partial<T> = {};
  for (const [k, v] of Object.entries(obj))
    if (v !== undefined) (out as Record<string, unknown>)[k] = v;
  return out;
}

/** カテゴリコードの正規化（重複・空を除く。存在確認は表記統一側で行い、知らないコードは検査で無視される） */
function cleanCategories(codes: readonly string[]): string[] {
  return Array.from(
    new Set(codes.map((c) => c.trim()).filter((c) => /^[A-Za-z][A-Za-z0-9_-]{0,15}$/.test(c))),
  ).slice(0, 20);
}
