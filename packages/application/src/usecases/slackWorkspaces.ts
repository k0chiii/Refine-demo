import {
  DomainError,
  type Principal,
  type SlackWorkspace,
  validateSlackWorkspace,
} from "@mf100/domain";
import type { AppContext } from "../ports.ts";

/*
 * Slack のワークスペース（管理画面「Slack」。docs/UI_M3E.md §105。利用者指示 2026-10-28「ADMINの管理画面でWS名とTEAM_IDの
 * 登録画面を作る→みんなは設定画面でWSを選ぶだけにしたい」）。登録・削除はシステム管理者だけ。一覧はサインインしていれば誰でも
 * （通知の設定でワークスペースを選ぶ）。
 */

/** 登録できるワークスペースの数の上限（一覧は 100 件まで読む） */
export const SLACK_WORKSPACE_MAX = 100;

function requireSystemAdmin(principal: Principal): void {
  if (!principal.isSystemAdmin) throw new DomainError("forbidden", { reason: "system_admin_only" });
}

export async function listSlackWorkspaces(
  ctx: AppContext,
  _principal: Principal,
): Promise<SlackWorkspace[]> {
  return ctx.slackWorkspaces.list();
}

/** 登録する。同じ team_id は二度登録できない（slack_workspace_duplicate） */
export async function addSlackWorkspace(
  ctx: AppContext,
  principal: Principal,
  input: { name: string; teamId: string },
): Promise<SlackWorkspace> {
  requireSystemAdmin(principal);
  const clean = validateSlackWorkspace(input);
  if (await ctx.slackWorkspaces.findByTeamId(clean.teamId))
    throw new DomainError("slack_workspace_duplicate", { teamId: clean.teamId });
  if ((await ctx.slackWorkspaces.list()).length >= SLACK_WORKSPACE_MAX)
    throw new DomainError("slack_workspace_invalid", { reason: "limit", max: SLACK_WORKSPACE_MAX });
  const created = await ctx.slackWorkspaces.insert(clean);
  await ctx.audit.record({
    entityType: "slack_workspace",
    entityId: created.id,
    operation: "add_slack_workspace",
    actorId: principal.userId,
    after: created,
    at: ctx.clock.now(),
  });
  return created;
}

/**
 * 削除する（もう無ければ何もしない）。選んでいた人の Slack は no_workspace になり、送らない。
 * 引いた結果（slackMembers）は残す（同じ team_id で登録し直せばそのまま使える）
 */
export async function removeSlackWorkspace(
  ctx: AppContext,
  principal: Principal,
  id: string,
): Promise<void> {
  requireSystemAdmin(principal);
  const before = await ctx.slackWorkspaces.findById(id);
  if (!before) return;
  await ctx.slackWorkspaces.delete(id);
  await ctx.audit.record({
    entityType: "slack_workspace",
    entityId: id,
    operation: "remove_slack_workspace",
    actorId: principal.userId,
    before,
    at: ctx.clock.now(),
  });
}
