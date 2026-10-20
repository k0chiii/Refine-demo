import {
  computeWorkStats,
  DomainError,
  workMatchesTeam,
  type Principal,
  type WorkStatsRow,
} from "@mf100/domain";
import type { AppContext } from "../ports.ts";

/**
 * 制作物ごとの集計（システム管理者だけ）。局・担当で絞れる（局はその配下の担当も含む）。
 * 数え方は domain の computeWorkStats。並びは制作物名順。
 */
export async function exportWorkStats(
  ctx: AppContext,
  principal: Principal,
  input: { teamId?: string } = {},
): Promise<WorkStatsRow[]> {
  if (!principal.isSystemAdmin) throw new DomainError("forbidden", { action: "work_stats" });
  const teams = await ctx.teams.list();
  if (input.teamId !== undefined && !teams.some((t) => t.id === input.teamId))
    throw new DomainError("team_not_found", { teamId: input.teamId });
  const rows: WorkStatsRow[] = [];
  for (const work of await ctx.works.list(2000)) {
    if (input.teamId !== undefined && !workMatchesTeam(work, input.teamId, teams)) continue;
    const revisions = await ctx.revisions.listByWork(work.id);
    const threads = [];
    for (const r of revisions)
      for (const thread of await ctx.threads.listByRevision(r.id))
        threads.push({
          thread,
          events:
            thread.resolution === "rejected" || thread.resolution === "deferred"
              ? await ctx.threads.listEvents(thread.id)
              : [],
        });
    rows.push(
      computeWorkStats({
        work,
        teams,
        revisions,
        threads,
        approvals: await ctx.approvals.listByWork(work.id),
      }),
    );
  }
  return rows.sort((a, b) => a.title.localeCompare(b.title, "ja"));
}
