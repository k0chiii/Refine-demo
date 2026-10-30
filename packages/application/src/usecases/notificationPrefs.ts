import {
  type AccountChannel,
  type ChannelAvailability,
  type ChannelStatus,
  channelStatusOf,
  deliverableEmail,
  DomainError,
  normalizeNotificationPrefs,
  type NotificationPrefs,
  type NotificationPrefsPatch,
  type Principal,
  slackAddressOf,
  type SlackMembership,
  validateNotificationPrefsPatch,
} from "@mf100/domain";
import type { AppContext } from "../ports.ts";

/*
 * 通知の受け取り方（利用者ごと。外への通知に効く）。利用者指示 2026-10-18・2026-10-28。
 * 自分の設定だけを読み書きする。行が無ければ既定（内容を表示・止めている分類なし・メールと Slack はオフ）。
 */

/** 設定画面の届け先 1 つ */
export interface ChannelSetting {
  /** env が揃っている（web はデモで true に読み替える） */
  available: boolean;
  on: boolean;
  /** email: users.email（ここでは変えない）。slack: 引くアドレス（slackAddressOf）。無ければ null */
  address: string | null;
  status: ChannelStatus;
}

/** Slack（DM）の行。送り先のワークスペースを選ぶ */
export interface SlackChannelSetting extends ChannelSetting {
  /** 各自が書いた Slack のメールアドレス（§110）。書いていなければ null（Nogiku のアドレスで引く） */
  customEmail: string | null;
  /** 選んだワークスペース。選んでいない・登録が消えたなら null */
  workspaceId: string | null;
  /** 選べるワークスペース（名前の順） */
  workspaces: Array<{ id: string; name: string }>;
}

export interface NotificationSettings extends Omit<
  NotificationPrefs,
  "slackWorkspaceId" | "slackEmail"
> {
  /** 設定画面の届け先。ACCOUNT_CHANNELS から導く（Record なので経路を足すと画面の型が落ちる） */
  destinations: Record<AccountChannel, ChannelSetting> & { slack: SlackChannelSetting };
}

export async function getNotificationPrefs(
  ctx: AppContext,
  principal: Principal,
): Promise<NotificationPrefs> {
  return normalizeNotificationPrefs(await ctx.notificationPrefs.find(principal.userId));
}

/** 自分の設定と、届け先ごとの状態（設定画面が読む） */
export async function getNotificationSettings(
  ctx: AppContext,
  principal: Principal,
  available: ChannelAvailability,
): Promise<NotificationSettings> {
  const stored = await getNotificationPrefs(ctx, principal);
  const { slackWorkspaceId, slackEmail, ...prefs } = stored;
  const address = (await ctx.people.profiles([principal.userId]))[0]?.email || null;
  const email = deliverableEmail(address);
  const slackAddress = slackAddressOf(stored, email);
  const workspaces = await ctx.slackWorkspaces.list();
  const workspace = workspaces.find((w) => w.id === slackWorkspaceId) ?? null;
  const slack: SlackMembership | null =
    workspace && slackAddress
      ? {
          teamId: workspace.teamId,
          email: slackAddress,
          link: await ctx.slackMembers.find(workspace.teamId, slackAddress),
        }
      : null;
  /** shown は画面に出すアドレス、to は送ってよいアドレス（状態を決める） */
  const setting = (
    channel: AccountChannel,
    shown: string | null,
    to: string | null,
  ): ChannelSetting => ({
    available: available.has(channel),
    on: prefs.channels.includes(channel),
    address: shown,
    status: channelStatusOf(channel, to, slack),
  });
  return {
    ...prefs,
    destinations: {
      email: setting("email", address, email),
      slack: {
        ...setting("slack", slackAddress, slackAddress),
        customEmail: slackEmail ?? null,
        workspaceId: workspace?.id ?? null,
        workspaces: workspaces.map(({ id, name }) => ({ id, name })),
      },
    },
  };
}

/**
 * 渡した項目だけを変える（showPreview・mutedCategories・channels・slackWorkspaceId・slackEmail）。
 * 使えない経路もオンにできる（意思として保存し、送るかは env が決める）。登録に無いワークスペースは選べない。
 * Slack がオンで、選んだワークスペースが無く（選んでいない・登録が消えた）、登録が 1 つだけなら、それを選ぶ
 */
export async function updateNotificationPrefs(
  ctx: AppContext,
  principal: Principal,
  patch: NotificationPrefsPatch,
): Promise<NotificationPrefs> {
  const valid = validateNotificationPrefsPatch(patch);
  if (
    typeof valid.slackWorkspaceId === "string" &&
    !(await ctx.slackWorkspaces.findById(valid.slackWorkspaceId))
  )
    throw new DomainError("notification_prefs_invalid", { field: "slackWorkspaceId" });
  const merged = normalizeNotificationPrefs({
    ...(await getNotificationPrefs(ctx, principal)),
    ...valid,
  });
  const next = merged.channels.includes("slack") ? await selectOnlyWorkspace(ctx, merged) : merged;
  await ctx.notificationPrefs.save({
    userId: principal.userId,
    ...next,
    updatedAt: ctx.clock.now(),
  });
  return next;
}

async function selectOnlyWorkspace(
  ctx: AppContext,
  prefs: NotificationPrefs,
): Promise<NotificationPrefs> {
  const workspaces = await ctx.slackWorkspaces.list();
  const only = workspaces.length === 1 ? workspaces[0] : undefined;
  return only ? { ...prefs, slackWorkspaceId: only.id } : prefs;
}
