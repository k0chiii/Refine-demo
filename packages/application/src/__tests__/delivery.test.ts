import {
  composeNotificationMessage,
  type DeliveryChannel,
  DomainError,
  SLACK_RECHECK_MS,
  toEmail,
  toPushPayload,
  toSlackText,
} from "@mf100/domain";
import { describe, expect, it } from "vite-plus/test";
import { grantWorkPermission, revokeWorkPermission } from "../usecases/acl.ts";
import {
  type DeliveryEnv,
  type DeliveryTarget,
  planDelivery,
  recordDelivery,
  recordSlackLookup,
  slackLookupTarget,
} from "../usecases/delivery.ts";
import {
  getNotificationPrefs,
  getNotificationSettings,
  updateNotificationPrefs,
} from "../usecases/notificationPrefs.ts";
import { notify } from "../usecases/notifications.ts";
import { subscribePush } from "../usecases/push.ts";
import { addSlackWorkspace, removeSlackWorkspace } from "../usecases/slackWorkspaces.ts";
import { createInMemoryContext } from "../testing/inMemory.ts";
import { principals, seedWork } from "../testing/scenario.ts";

const ORIGIN = "https://mf100.example-org.jp";
const EMAIL = "stranger@example-org.jp";
const ACTOR = "本郷 校正";
const TITLE = "夏のポスター";
const TEAM = "T0MAY";
const me = principals.stranger;
/** 五月祭のワークスペースでの、受け取る人 */
const member = { teamId: TEAM, email: EMAIL };

const envOf = (...channels: DeliveryChannel[]): DeliveryEnv => ({
  available: new Set(channels),
  origin: ORIGIN,
});
const ALL = envOf("push", "email", "slack");

const device = {
  endpoint: "https://fcm.googleapis.com/fcm/send/device-1",
  p256dh: `B${"A".repeat(86)}`,
  auth: "A".repeat(22),
};

function renderedOf(t: DeliveryTarget): string {
  switch (t.channel) {
    case "push":
      return JSON.stringify(t.payload);
    case "email":
      return `${t.content.subject}\n${t.content.text}`;
    case "slack":
      return t.text;
  }
}

/**
 * 見られる制作物へのコメントの通知を 1 件受け取る人（メール・Slack をオンにし、端末も登録している）。
 * Slack のワークスペースは五月祭の 1 つだけ（オンにしたときに選ばれる）
 */
async function setup(opts: { email?: string | null; push?: boolean } = {}) {
  const ctx = createInMemoryContext();
  const workspace = await addSlackWorkspace(ctx, principals.sysadmin, {
    name: "五月祭",
    teamId: TEAM,
  });
  ctx.state.names.set(principals.reviewer.userId, ACTOR);
  const email = opts.email === undefined ? EMAIL : opts.email;
  if (email !== null) ctx.state.emails.set(me.userId, email);
  const work = await seedWork(ctx, { title: TITLE });
  await grantWorkPermission(ctx, principals.sysadmin, {
    workId: work.id,
    userIds: [me.userId],
    permission: "review",
  });
  await updateNotificationPrefs(ctx, me, { channels: ["email", "slack"] });
  const sub = opts.push === false ? null : await subscribePush(ctx, me, device);
  const post = async () => {
    await notify(ctx, [me.userId], principals.reviewer.userId, {
      kind: "comment_posted",
      title: "新しいコメント",
      body: `『${TITLE}』・${ACTOR}さん: 相談です`,
      preview: "相談です",
      workId: work.id,
      threadId: "thr-1",
    });
    return ctx.state.notifications.all().at(-1)!;
  };
  return { ctx, work, sub, post, workspace };
}

const slackRef = (memberId: string | null) =>
  ({ channel: "slack", key: "slack", teamId: TEAM, email: EMAIL, memberId }) as const;

describe("外への通知の計画", () => {
  it("メールは登録メールアドレスに、アプリの画面へのリンクを付けて送る", async () => {
    const { ctx, work, post } = await setup();
    const n = await post();
    const plan = await planDelivery(ctx, n.id, envOf("email"));
    expect(plan?.notificationId).toBe(n.id);
    expect(plan?.targets).toHaveLength(1);
    const [target] = plan!.targets;
    if (target?.channel !== "email") throw new Error("email target expected");
    expect(target.to).toBe(EMAIL);
    expect(target.content.text.split("\n")).toContain(`${ORIGIN}/works/${work.id}`);
    expect(target.content.subject).not.toMatch(/[\r\n]/);
  });

  it("Slack は選んだワークスペースへ、まだ引いていなければメンバーなしで、引けていればそのメンバーに送る", async () => {
    const { ctx, work, post } = await setup();
    const n = await post();
    const before = await planDelivery(ctx, n.id, envOf("slack"));
    expect(before?.targets).toEqual([
      expect.objectContaining({
        channel: "slack",
        key: "slack",
        teamId: TEAM,
        email: EMAIL,
        memberId: null,
      }),
    ]);
    await recordSlackLookup(ctx, member, { kind: "found", memberId: "U1" });
    const after = await planDelivery(ctx, n.id, envOf("slack"));
    const [target] = after!.targets;
    if (target?.channel !== "slack") throw new Error("slack target expected");
    expect(target.memberId).toBe("U1");
    expect(target.text).toContain(`${ORIGIN}/works/${work.id}`);
  });

  it("Slack で見つからない・DM できない人には、確かめ直す間が過ぎるまで送らない", async () => {
    const { ctx, post } = await setup();
    const n = await post();
    await recordSlackLookup(ctx, member, { kind: "not_found" });
    expect(await planDelivery(ctx, n.id, envOf("slack"))).toBeNull();
    ctx.clock.advance(SLACK_RECHECK_MS);
    expect((await planDelivery(ctx, n.id, envOf("slack")))?.targets).toEqual([
      expect.objectContaining({ channel: "slack", memberId: null }),
    ]);

    await recordSlackLookup(ctx, member, { kind: "found", memberId: "U1" });
    const other = await post();
    await recordDelivery(ctx, {
      notificationId: other.id,
      target: slackRef("U1"),
      outcome: { kind: "rejected", reason: "cannot_dm" },
    });
    expect(await planDelivery(ctx, n.id, envOf("slack"))).toBeNull();
    ctx.clock.advance(SLACK_RECHECK_MS);
    expect((await planDelivery(ctx, n.id, envOf("slack")))?.targets).toEqual([
      expect.objectContaining({ channel: "slack", memberId: "U1" }),
    ]);
  });

  it("決着した届け先は計画に入らず、同じ決着を何度記録しても 1 行", async () => {
    const { ctx, sub, post } = await setup();
    const n = await post();
    const keys = async () => (await planDelivery(ctx, n.id, ALL))?.targets.map((t) => t.key);
    expect(await keys()).toEqual([`push:${sub!.id}`, "email", "slack"]);
    for (let i = 0; i < 2; i++)
      await recordDelivery(ctx, {
        notificationId: n.id,
        target: { channel: "email", key: "email" },
        outcome: { kind: "sent", httpStatus: 409 },
      });
    expect(ctx.state.deliveries.size).toBe(1);
    expect(await keys()).toEqual([`push:${sub!.id}`, "slack"]);
    await recordDelivery(ctx, {
      notificationId: n.id,
      target: { channel: "push", key: `push:${sub!.id}`, subscriptionId: sub!.id },
      outcome: { kind: "sent", httpStatus: 201 },
    });
    await recordDelivery(ctx, {
      notificationId: n.id,
      target: slackRef(null),
      outcome: { kind: "rejected", reason: "not_found" },
    });
    expect(await planDelivery(ctx, n.id, ALL)).toBeNull();
    // ほかの通知は別に決着する
    expect((await planDelivery(ctx, (await post()).id, ALL))?.targets).toHaveLength(3);
  });

  it("端末の宛先が無くなった（404）と記録すると、購読を消す", async () => {
    const { ctx, sub, post } = await setup();
    const n = await post();
    await recordDelivery(ctx, {
      notificationId: n.id,
      target: { channel: "push", key: `push:${sub!.id}`, subscriptionId: sub!.id },
      outcome: { kind: "rejected", reason: "gone", httpStatus: 404 },
    });
    expect(ctx.state.pushSubscriptions.get(sub!.id)).toBeNull();
    const next = await planDelivery(ctx, (await post()).id, ALL);
    expect(next?.targets.map((t) => t.channel)).toEqual(["email", "slack"]);
  });

  it("Slack で DM できなかったら状態を移し、同じ結果がもう一度来ても書き直さない", async () => {
    const { ctx, post } = await setup();
    const saves: string[] = [];
    const save = ctx.slackMembers.save.bind(ctx.slackMembers);
    ctx.slackMembers.save = async (teamId, email, link) => {
      saves.push(link.state);
      await save(teamId, email, link);
    };
    await recordSlackLookup(ctx, member, { kind: "found", memberId: "U1" });
    await recordSlackLookup(ctx, member, { kind: "found", memberId: "U1" });
    expect(saves).toEqual(["linked"]);
    for (let i = 0; i < 2; i++)
      await recordDelivery(ctx, {
        notificationId: (await post()).id,
        target: slackRef("U1"),
        outcome: { kind: "rejected", reason: "cannot_dm" },
      });
    expect(saves).toEqual(["linked", "cannot_dm"]);
    expect(await ctx.slackMembers.find(TEAM, EMAIL)).toMatchObject({
      state: "cannot_dm",
      memberId: "U1",
    });
    await recordDelivery(ctx, {
      notificationId: (await post()).id,
      target: slackRef("U1"),
      outcome: { kind: "sent" },
    });
    expect(saves).toEqual(["linked", "cannot_dm", "linked"]);
  });

  it("ACL を取り消しても外への通知に制作物名・送り主・抜粋を載せる（105A）", async () => {
    const { ctx, work, post } = await setup();
    const n = await post();
    await recordSlackLookup(ctx, member, { kind: "found", memberId: "U1" });
    const open = await planDelivery(ctx, n.id, ALL);
    expect(open?.targets).toHaveLength(3);
    for (const t of open!.targets) expect(renderedOf(t)).toMatch(/夏のポスター|本郷|相談です/);

    await revokeWorkPermission(ctx, principals.sysadmin, { workId: work.id, userId: me.userId });
    const after = await planDelivery(ctx, n.id, ALL);
    expect(after?.targets.map((t) => t.channel)).toEqual(["push", "email", "slack"]);
    for (const t of after!.targets) expect(renderedOf(t)).toMatch(/夏のポスター|本郷|相談です/);
  });

  it("既読になった・止めた分類の通知は計画しない（アプリ内の通知は残る）", async () => {
    const { ctx, post } = await setup();
    const muted = await post();
    await updateNotificationPrefs(ctx, me, { mutedCategories: ["reply"] });
    expect(await planDelivery(ctx, muted.id, ALL)).toBeNull();
    expect(ctx.state.notifications.get(muted.id)).not.toBeNull();
    await updateNotificationPrefs(ctx, me, { mutedCategories: [] });
    const read = await post();
    expect(await planDelivery(ctx, read.id, ALL)).not.toBeNull();
    ctx.state.notifications.put({ ...read, readAt: ctx.clock.now() });
    expect(await planDelivery(ctx, read.id, ALL)).toBeNull();
  });

  it("試験用のアドレス（*@example.invalid）・アドレスの無い人には、メールも Slack も送らない", async () => {
    for (const email of ["mock-1@example.invalid", null]) {
      const { ctx, post } = await setup({ email });
      const n = await post();
      expect((await planDelivery(ctx, n.id, ALL))?.targets.map((t) => t.channel)).toEqual(["push"]);
      const noDevice = await setup({ email, push: false });
      expect(await planDelivery(noDevice.ctx, (await noDevice.post()).id, ALL)).toBeNull();
    }
  });

  it("画面のオリジンが無ければ、メールと Slack は使えない", async () => {
    const { ctx, post } = await setup();
    const n = await post();
    const plan = await planDelivery(ctx, n.id, { ...ALL, origin: null });
    expect(plan?.targets.map((t) => t.channel)).toEqual(["push"]);
  });

  it("使える経路が無ければ設定を読まず、端末に送らないときは未読の数を数えない", async () => {
    const { ctx, post } = await setup();
    const n = await post();
    const reads = { prefs: 0, unread: 0 };
    const find = ctx.notificationPrefs.find.bind(ctx.notificationPrefs);
    const countUnread = ctx.notifications.countUnread.bind(ctx.notifications);
    ctx.notificationPrefs.find = async (userId) => {
      reads.prefs++;
      return find(userId);
    };
    ctx.notifications.countUnread = async (userId) => {
      reads.unread++;
      return countUnread(userId);
    };
    expect(await planDelivery(ctx, n.id, envOf())).toBeNull();
    expect(reads).toEqual({ prefs: 0, unread: 0 });
    expect(await planDelivery(ctx, n.id, envOf("email"))).not.toBeNull();
    expect(reads).toEqual({ prefs: 1, unread: 0 });
    expect(await planDelivery(ctx, n.id, envOf("push"))).not.toBeNull();
    expect(reads).toEqual({ prefs: 2, unread: 1 });
  });
});

describe("Slack で引く宛先", () => {
  it("Slack のメールアドレスを書いていればそれで、消せば Nogiku のアドレスで引く", async () => {
    const { ctx } = await setup();
    await updateNotificationPrefs(ctx, me, { slackEmail: " Stranger@Slack-Profile.JP " });
    expect(await slackLookupTarget(ctx, me.userId)).toEqual({
      teamId: TEAM,
      email: "stranger@slack-profile.jp",
    });
    await updateNotificationPrefs(ctx, me, { slackEmail: null });
    expect(await slackLookupTarget(ctx, me.userId)).toEqual(member);
    // Nogiku のアドレスが送れない形でも、書いた Slack のメールアドレスで引ける
    const reserved = await setup({ email: "mock-1@example.invalid" });
    await updateNotificationPrefs(reserved.ctx, me, { slackEmail: "mock-1@slack-profile.jp" });
    expect(await slackLookupTarget(reserved.ctx, me.userId)).toEqual({
      teamId: TEAM,
      email: "mock-1@slack-profile.jp",
    });
  });

  it("Slack をオンにしていて、ワークスペースを選び、送れるアドレスがあるときだけ", async () => {
    const { ctx, workspace } = await setup();
    expect(await slackLookupTarget(ctx, me.userId)).toEqual(member);
    await updateNotificationPrefs(ctx, me, { channels: ["email"] });
    expect(await slackLookupTarget(ctx, me.userId)).toBeNull();
    const reserved = await setup({ email: "mock-1@example.invalid" });
    expect(await slackLookupTarget(reserved.ctx, me.userId)).toBeNull();
    await updateNotificationPrefs(ctx, me, { channels: ["email", "slack"] });
    await removeSlackWorkspace(ctx, principals.sysadmin, workspace.id);
    expect(await slackLookupTarget(ctx, me.userId)).toBeNull();
  });
});

describe("Slack のワークスペースを選ぶ", () => {
  it("登録が 1 つだけなら、Slack をオンにしたときにそれを選ぶ。2 つ以上なら選ばず no_workspace", async () => {
    const ctx = createInMemoryContext();
    ctx.state.emails.set(me.userId, EMAIL);
    const may = await addSlackWorkspace(ctx, principals.sysadmin, { name: "五月祭", teamId: TEAM });
    await updateNotificationPrefs(ctx, me, { channels: ["email"] });
    expect(await getNotificationPrefs(ctx, me)).not.toHaveProperty("slackWorkspaceId");
    expect(await updateNotificationPrefs(ctx, me, { channels: ["email", "slack"] })).toMatchObject({
      slackWorkspaceId: may.id,
    });

    const other = createInMemoryContext();
    other.state.emails.set(me.userId, EMAIL);
    await addSlackWorkspace(other, principals.sysadmin, { name: "五月祭", teamId: TEAM });
    const komaba = await addSlackWorkspace(other, principals.sysadmin, {
      name: "駒場祭",
      teamId: "T0KOMABA",
    });
    await updateNotificationPrefs(other, me, { channels: ["slack"] });
    const none = await getNotificationSettings(other, me, new Set<DeliveryChannel>(["slack"]));
    expect(none.destinations.slack).toMatchObject({ workspaceId: null, status: "no_workspace" });
    await updateNotificationPrefs(other, me, { slackWorkspaceId: komaba.id });
    const chosen = await getNotificationSettings(other, me, new Set<DeliveryChannel>(["slack"]));
    expect(chosen.destinations.slack).toMatchObject({
      workspaceId: komaba.id,
      status: "unresolved",
    });
  });

  it("登録に無いワークスペースは選べない", async () => {
    const { ctx, workspace } = await setup();
    await expect(
      updateNotificationPrefs(ctx, me, { slackWorkspaceId: `${workspace.id}-gone` }),
    ).rejects.toEqual(expect.objectContaining({ code: "notification_prefs_invalid" }));
    expect((await getNotificationPrefs(ctx, me)).slackWorkspaceId).toBe(workspace.id);
  });

  it("登録が消えたワークスペースには送らず、設定は no_workspace。残った 1 つはオンのまま次に変えたときに選ぶ", async () => {
    const { ctx, workspace, post } = await setup({ push: false });
    const n = await post();
    await recordSlackLookup(ctx, member, { kind: "found", memberId: "U1" });
    await removeSlackWorkspace(ctx, principals.sysadmin, workspace.id);
    expect(await planDelivery(ctx, n.id, envOf("slack"))).toBeNull();
    const gone = await getNotificationSettings(ctx, me, new Set<DeliveryChannel>(["slack"]));
    expect(gone.destinations.slack).toMatchObject({
      workspaceId: null,
      workspaces: [],
      status: "no_workspace",
    });

    const again = await addSlackWorkspace(ctx, principals.sysadmin, {
      name: "五月祭",
      teamId: TEAM,
    });
    await updateNotificationPrefs(ctx, me, { showPreview: false });
    expect((await getNotificationPrefs(ctx, me)).slackWorkspaceId).toBe(again.id);
    // 同じ team_id で登録し直したので、引いた結果はそのまま使える
    expect((await planDelivery(ctx, n.id, envOf("slack")))?.targets).toEqual([
      expect.objectContaining({ channel: "slack", teamId: TEAM, memberId: "U1" }),
    ]);
  });

  it("引いた結果はワークスペースごと。替えると、替えた先のワークスペースで引く", async () => {
    const { ctx, workspace, post } = await setup({ push: false });
    const komaba = await addSlackWorkspace(ctx, principals.sysadmin, {
      name: "駒場祭",
      teamId: "T0KOMABA",
    });
    const n = await post();
    await recordSlackLookup(ctx, member, { kind: "found", memberId: "U1" });
    await updateNotificationPrefs(ctx, me, { slackWorkspaceId: komaba.id });
    expect((await planDelivery(ctx, n.id, envOf("slack")))?.targets).toEqual([
      expect.objectContaining({ channel: "slack", teamId: "T0KOMABA", memberId: null }),
    ]);
    await recordSlackLookup(ctx, { teamId: "T0KOMABA", email: EMAIL }, { kind: "not_found" });
    const settings = async () =>
      (await getNotificationSettings(ctx, me, new Set<DeliveryChannel>(["slack"]))).destinations
        .slack.status;
    expect(await settings()).toBe("not_found");
    await updateNotificationPrefs(ctx, me, { slackWorkspaceId: workspace.id });
    expect(await settings()).toBe("ready");
  });
});

describe("Slack のメールアドレス", () => {
  const SLACK_EMAIL = "stranger@slack-profile.jp";

  it("形の違うものは field slackEmail で断り、それまでの設定を変えない", async () => {
    const { ctx } = await setup({ push: false });
    await updateNotificationPrefs(ctx, me, { slackEmail: SLACK_EMAIL });
    await expect(updateNotificationPrefs(ctx, me, { slackEmail: "stranger" })).rejects.toEqual(
      new DomainError("notification_prefs_invalid", { field: "slackEmail" }),
    );
    expect((await getNotificationPrefs(ctx, me)).slackEmail).toBe(SLACK_EMAIL);
  });

  it("設定の Slack の行は、書いたものと引くアドレスを返し、メールの行は Nogiku のアドレスのまま。null で消す", async () => {
    const { ctx } = await setup({ push: false });
    const destinations = async () =>
      (await getNotificationSettings(ctx, me, new Set<DeliveryChannel>(["email", "slack"])))
        .destinations;
    expect((await destinations()).slack).toMatchObject({ address: EMAIL, customEmail: null });
    await recordSlackLookup(ctx, member, { kind: "found", memberId: "U1" });
    expect((await destinations()).slack.status).toBe("ready");

    await updateNotificationPrefs(ctx, me, { slackEmail: SLACK_EMAIL });
    const custom = await destinations();
    expect(custom.slack).toMatchObject({
      address: SLACK_EMAIL,
      customEmail: SLACK_EMAIL,
      // 引いた結果はアドレスごとなので、替えれば引き直すまで未確認
      status: "unresolved",
    });
    expect(custom.email.address).toBe(EMAIL);

    await updateNotificationPrefs(ctx, me, { slackEmail: null });
    expect((await destinations()).slack).toMatchObject({
      address: EMAIL,
      customEmail: null,
      status: "ready",
    });
    expect(await getNotificationPrefs(ctx, me)).not.toHaveProperty("slackEmail");
  });

  it("Slack の DM は書いたアドレスで引いて送り、メールは Nogiku のアドレスに送る", async () => {
    const { ctx, post } = await setup({ push: false });
    await updateNotificationPrefs(ctx, me, { slackEmail: SLACK_EMAIL });
    const n = await post();
    const plan = await planDelivery(ctx, n.id, envOf("email", "slack"));
    expect(plan?.targets).toEqual([
      expect.objectContaining({ channel: "email", to: EMAIL }),
      expect.objectContaining({
        channel: "slack",
        teamId: TEAM,
        email: SLACK_EMAIL,
        memberId: null,
      }),
    ]);
  });

  it("Nogiku のアドレスが送れない形でも、書けば Slack は引ける状態になる", async () => {
    const { ctx } = await setup({ email: "mock-1@example.invalid", push: false });
    await updateNotificationPrefs(ctx, me, { slackEmail: SLACK_EMAIL });
    const s = await getNotificationSettings(ctx, me, new Set<DeliveryChannel>(["email", "slack"]));
    expect(s.destinations.email.status).toBe("no_address");
    expect(s.destinations.slack).toMatchObject({ address: SLACK_EMAIL, status: "unresolved" });
  });
});

describe("通知の設定の届け先", () => {
  const statuses = async (ctx: ReturnType<typeof createInMemoryContext>) => {
    const s = await getNotificationSettings(ctx, me, new Set<DeliveryChannel>(["email"]));
    return { email: s.destinations.email.status, slack: s.destinations.slack.status };
  };

  it("経路ごとに、使えるか・オンか・アドレス・状態を返し、Slack は選べるワークスペースと選んだものも返す", async () => {
    const { ctx, workspace } = await setup({ push: false });
    await updateNotificationPrefs(ctx, me, { channels: ["slack"] });
    const s = await getNotificationSettings(ctx, me, new Set<DeliveryChannel>(["push", "email"]));
    expect(s).toMatchObject({ showPreview: true, mutedCategories: [], channels: ["slack"] });
    expect(s.destinations).toEqual({
      email: { available: true, on: false, address: EMAIL, status: "ready" },
      slack: {
        available: false,
        on: true,
        address: EMAIL,
        status: "unresolved",
        customEmail: null,
        workspaceId: workspace.id,
        workspaces: [{ id: workspace.id, name: "五月祭" }],
      },
    });
  });

  it("Slack の状態は引いた・送った結果に従う", async () => {
    const { ctx, post } = await setup({ push: false });
    expect(await statuses(ctx)).toEqual({ email: "ready", slack: "unresolved" });
    await recordSlackLookup(ctx, member, { kind: "not_found" });
    expect(await statuses(ctx)).toEqual({ email: "ready", slack: "not_found" });
    await recordSlackLookup(ctx, member, { kind: "found", memberId: "U1" });
    expect(await statuses(ctx)).toEqual({ email: "ready", slack: "ready" });
    await recordDelivery(ctx, {
      notificationId: (await post()).id,
      target: slackRef("U1"),
      outcome: { kind: "rejected", reason: "cannot_dm" },
    });
    expect(await statuses(ctx)).toEqual({ email: "ready", slack: "cannot_dm" });
  });

  it("送れないアドレスは見せるが no_address。アドレスが無ければ null", async () => {
    const reserved = await setup({ email: "mock-1@example.invalid", push: false });
    const s = await getNotificationSettings(reserved.ctx, me, new Set());
    expect(s.destinations.email).toMatchObject({
      available: false,
      address: "mock-1@example.invalid",
      status: "no_address",
    });
    expect(await statuses(reserved.ctx)).toEqual({ email: "no_address", slack: "no_address" });
    const none = await setup({ email: null, push: false });
    expect((await getNotificationSettings(none.ctx, me, new Set())).destinations.slack).toEqual({
      available: false,
      on: true,
      address: null,
      status: "no_address",
      customEmail: null,
      workspaceId: none.workspace.id,
      workspaces: [{ id: none.workspace.id, name: "五月祭" }],
    });
  });

  it("経路のオン・オフは確かめてから保存し、渡さなければ変えない", async () => {
    const ctx = createInMemoryContext();
    expect(await updateNotificationPrefs(ctx, me, { channels: ["slack", "email"] })).toMatchObject({
      channels: ["email", "slack"],
    });
    await updateNotificationPrefs(ctx, me, { showPreview: false });
    expect(await getNotificationPrefs(ctx, me)).toEqual({
      showPreview: false,
      mutedCategories: [],
      channels: ["email", "slack"],
    });
    await expect(
      updateNotificationPrefs(ctx, me, { channels: ["email", "line"] }),
    ).rejects.toBeInstanceOf(DomainError);
    expect((await getNotificationPrefs(ctx, me)).channels).toEqual(["email", "slack"]);
  });
});
