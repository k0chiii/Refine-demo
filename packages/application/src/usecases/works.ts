import {
  assertExpectedVersion,
  type Confidentiality,
  DomainError,
  type MediaType,
  orgPermissions,
  type Principal,
  requireOrgPermission,
  transitionLifecycle,
  type Work,
  type WorkImportInput,
  type WorkLifecycle,
  WORK_IMPORT_MAX_ROWS,
} from "@mf100/domain";
import type { AppContext } from "../ports.ts";
import { loadAuthorizedWork } from "../shared.ts";

export interface CreateWorkInput {
  title: string;
  purpose: string;
  category: string;
  mediaType: MediaType;
  year: number;
  legacyId?: string;
  ownerTeamId?: string;
  productionTeamIds?: string[];
  relatedTeamIds?: string[];
  managerIds?: string[];
  creatorIds: string[];
  approverId: string;
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
  if (input.title.trim() === "") throw new DomainError("forbidden", { reason: "title_required" });
  if (input.creatorIds.length === 0)
    throw new DomainError("forbidden", { reason: "creator_required" });
  const managerIds = Array.from(
    new Set([
      ...(input.managerIds ?? []),
      ...(input.addRegistrantAsManager === false ? [] : [principal.userId]),
    ]),
  );
  const data: Omit<Work, "id"> = {
    year: input.year,
    title: input.title.trim(),
    purpose: input.purpose,
    category: input.category,
    mediaType: input.mediaType,
    productionTeamIds: input.productionTeamIds ?? [],
    relatedTeamIds: input.relatedTeamIds ?? [],
    managerIds,
    creatorIds: Array.from(new Set(input.creatorIds)),
    approverId: input.approverId,
    lifecycle: input.activate === false ? "draft" : "active",
    confidentiality: input.confidentiality ?? "normal",
    version: 1,
  };
  if (input.legacyId !== undefined) data.legacyId = input.legacyId;
  if (input.ownerTeamId !== undefined) data.ownerTeamId = input.ownerTeamId;
  if (input.deadlineAt !== undefined) data.deadlineAt = input.deadlineAt;
  if (input.notationCategories !== undefined)
    data.notationCategories = cleanCategories(input.notationCategories);
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
    if (row.approverId.trim() === "" || row.creatorIds.length === 0 || row.title.trim() === "")
      throw new DomainError("work_import_invalid", { reason: "row_incomplete", index });
    created.push(
      await createWork(ctx, principal, {
        ...row,
        managerIds: row.managerIds,
        notationCategories: row.notationCategories,
        addRegistrantAsManager: false,
      }),
    );
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
  patch: Partial<
    Pick<
      Work,
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
      | "ownerTeamId"
      | "productionTeamIds"
      | "relatedTeamIds"
      | "notationCategories"
    >
  > & {
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
  const { socialProfileId, ...rest } = input.patch;
  const patch = stripUndefined(rest);
  if (patch.notationCategories)
    patch.notationCategories = cleanCategories(patch.notationCategories);
  const next: Work = { ...work, ...patch, version: work.version + 1 };
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
