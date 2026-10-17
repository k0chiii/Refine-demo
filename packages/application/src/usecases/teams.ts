import {
  DomainError,
  planTeamImport,
  sortTeams,
  TEAM_MAX,
  teamNameKey,
  validateTeam,
  type Principal,
  type Team,
  type TeamInput,
} from "@mf100/domain";
import type { AppContext } from "../ports.ts";

/**
 * 組織（局 › 担当）。利用者決定 2026-10-15「組織は管理画面で管理する（Nogiku との同期は後で）」。
 * 登録・変更・削除・CSV の取り込みはシステム管理者だけ。一覧はサインインしていれば誰でも（制作物の担当の表示・選択で使う）。
 */
export async function listTeams(ctx: AppContext, _principal: Principal): Promise<Team[]> {
  return sortTeams(await ctx.teams.list());
}

function requireSystemAdmin(principal: Principal): void {
  if (!principal.isSystemAdmin) throw new DomainError("forbidden", { reason: "system_admin_only" });
}

export async function saveTeam(
  ctx: AppContext,
  principal: Principal,
  input: TeamInput & { id?: string },
): Promise<Team> {
  requireSystemAdmin(principal);
  const { id, ...rest } = input;
  const all = await ctx.teams.list();
  const now = ctx.clock.now();
  if (id) {
    const before = all.find((t) => t.id === id) ?? (await ctx.teams.findById(id));
    if (!before) throw new DomainError("team_not_found", { teamId: id });
    // 並び順を省略したら、親が同じ間は今の並び順のまま
    const sameParent = (rest.parentId?.trim() || undefined) === before.parentId;
    const clean = validateTeam(
      {
        ...rest,
        order: rest.order ?? (sameParent && rest.kind === before.kind ? before.order : undefined),
      },
      all,
      id,
    );
    if (clean.kind !== before.kind) {
      // 種類（局 ⇔ 担当）は、担当を持つ局・制作物が使っている局・担当では変えられない
      const hasChildren = all.some((t) => t.parentId === id);
      const used = await ctx.teams.countWorksUsing(id);
      if (hasChildren || used > 0)
        throw new DomainError("team_invalid", {
          field: "kind",
          reason: hasChildren ? "has_children" : "in_use",
        });
    }
    const next: Team = { id, ...clean, updatedAt: now, updatedBy: principal.userId };
    await ctx.teams.update(next);
    await ctx.audit.record({
      entityType: "team",
      entityId: id,
      operation: "update",
      actorId: principal.userId,
      before,
      after: next,
      at: now,
    });
    return next;
  }
  if (all.length >= TEAM_MAX)
    throw new DomainError("team_invalid", { reason: "limit", max: TEAM_MAX });
  const clean = validateTeam(rest, all);
  const created = await ctx.teams.insert({ ...clean, updatedAt: now, updatedBy: principal.userId });
  await ctx.audit.record({
    entityType: "team",
    entityId: created.id,
    operation: "create",
    actorId: principal.userId,
    after: created,
    at: now,
  });
  return created;
}

/** 削除。制作物が主管担当・制作担当にしている局・担当と、担当を持つ局は消せない（team_in_use） */
export async function deleteTeam(ctx: AppContext, principal: Principal, id: string): Promise<void> {
  requireSystemAdmin(principal);
  const before = await ctx.teams.findById(id);
  if (!before) return;
  const children = (await ctx.teams.list()).filter((t) => t.parentId === id).length;
  const works = await ctx.teams.countWorksUsing(id);
  if (children > 0 || works > 0)
    throw new DomainError("team_in_use", { teamId: id, works, children });
  await ctx.teams.remove(id);
  await ctx.audit.record({
    entityType: "team",
    entityId: id,
    operation: "delete",
    actorId: principal.userId,
    before,
    at: ctx.clock.now(),
  });
}

/**
 * CSV での取り込み（画面が parseTeamCsv で読んで確認した行を受け取る）。
 * 名前で照合して、無い局・担当だけを作る（局を先に）。同じ CSV を何度取り込んでも二重にはならない。
 * どれか 1 つでも作れなければ何も作らない（1 トランザクション）。監査は一括で 1 件。
 */
export async function importTeams(
  ctx: AppContext,
  principal: Principal,
  rows: { bureau: string; team: string | null; order?: number }[],
): Promise<{ created: number; existing: number }> {
  requireSystemAdmin(principal);
  if (rows.length === 0 || rows.length > TEAM_MAX)
    throw new DomainError("team_invalid", {
      reason: "row_count",
      count: rows.length,
      max: TEAM_MAX,
    });
  const all = await ctx.teams.list();
  const plan = planTeamImport(
    rows.map((r, i) => ({ ...r, line: i + 1 })),
    all,
  );
  if (all.length + plan.create.length > TEAM_MAX)
    throw new DomainError("team_invalid", { reason: "limit", max: TEAM_MAX });
  const now = ctx.clock.now();
  const current = [...all];
  const createdIds: string[] = [];
  const insert = async (input: TeamInput) => {
    const created = await ctx.teams.insert({
      ...validateTeam(input, current),
      updatedAt: now,
      updatedBy: principal.userId,
    });
    current.push(created);
    createdIds.push(created.id);
    return created;
  };
  for (const c of plan.create)
    if (c.team === null) await insert({ name: c.bureau, kind: "bureau", order: c.order });
  for (const c of plan.create) {
    if (c.team === null) continue;
    // 局は作り終えているので、名前で引ける（planTeamImport と同じ照合）
    const key = teamNameKey(c.bureau);
    const bureau = current.find((t) => t.kind === "bureau" && teamNameKey(t.name) === key);
    if (!bureau) throw new DomainError("team_not_found", { bureau: c.bureau });
    await insert({ name: c.team, kind: "team", parentId: bureau.id, order: c.order });
  }
  await ctx.audit.record({
    entityType: "team",
    entityId: "bulk",
    operation: "bulk_import",
    actorId: principal.userId,
    after: { created: createdIds.length, existing: plan.existing, teamIds: createdIds },
    at: now,
  });
  return { created: createdIds.length, existing: plan.existing };
}
