import {
  assertExpectedVersion,
  type Confidentiality,
  DomainError,
  type MediaType,
  type Principal,
  transitionLifecycle,
  type Work,
  type WorkLifecycle,
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
  /** 登録と有効化を分ける案（§7.2）に備え、既定は即時 active。 */
  activate?: boolean;
}

/**
 * 制作物登録（F-02 / UC-01）。
 * 実装上の仮置き: 認証済みユーザーは誰でも登録でき、登録者は自動的に主管担当（managerIds）に含まれる。
 * 「登録できる人」の制度上の範囲は D3/D10 と合わせて確認する。
 */
export async function createWork(
  ctx: AppContext,
  principal: Principal,
  input: CreateWorkInput,
): Promise<Work> {
  if (input.title.trim() === "") throw new DomainError("forbidden", { reason: "title_required" });
  if (input.creatorIds.length === 0)
    throw new DomainError("forbidden", { reason: "creator_required" });
  const managerIds = Array.from(new Set([...(input.managerIds ?? []), principal.userId]));
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
    >
  >;
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
  const next: Work = { ...work, ...stripUndefined(input.patch), version: work.version + 1 };
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
