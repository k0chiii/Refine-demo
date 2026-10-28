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
  slackLookupEmail,
} from "../usecases/delivery.ts";
import {
  getNotificationPrefs,
  getNotificationSettings,
  updateNotificationPrefs,
} from "../usecases/notificationPrefs.ts";
import { notify } from "../usecases/notifications.ts";
import { subscribePush } from "../usecases/push.ts";
import { createInMemoryContext } from "../testing/inMemory.ts";
import { principals, seedWork } from "../testing/scenario.ts";

const ORIGIN = "https://mf100.example-org.jp";
const EMAIL = "stranger@example-org.jp";
const ACTOR = "本郷 校正";
const TITLE = "夏のポスター";
const me = principals.stranger;

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

/** 見られる制作物へのコメントの通知を 1 件受け取る人（メール・Slack をオンにし、端末も登録している） */
async function setup(opts: { email?: string | null; push?: boolean } = {}) {
  const ctx = createInMemoryContext();
  ctx.state.names.set(principals.reviewer.userId, ACTOR);
  const email = opts.email === undefined ? EMAIL : opts.email;
  if (email !== null) ctx.state.emails.set(me.userId, email);
  const work = await seedWork(ctx, { title: TITLE });
  await grantWorkPermission(ctx, principals.sysadmin, {
    workId: work.id,
    userIds: [me.userId],
    permission: "view",
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
  return { ctx, work, sub, post };
}

const slackRef = (memberId: string | null) =>
  ({ channel: "slack", key: "slack", email: EMAIL, memberId }) as const;

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

  it("Slack は、まだ引いていなければメンバーなしで、引けていればそのメンバーに送る", async () => {
    const { ctx, work, post } = await setup();
    const n = await post();
    const before = await planDelivery(ctx, n.id, envOf("slack"));
    expect(before?.targets).toEqual([
      expect.objectContaining({ channel: "slack", key: "slack", email: EMAIL, memberId: null }),
    ]);
    await recordSlackLookup(ctx, EMAIL, { kind: "found", memberId: "U1" });
    const after = await planDelivery(ctx, n.id, envOf("slack"));
    const [target] = after!.targets;
    if (target?.channel !== "slack") throw new Error("slack target expected");
    expect(target.memberId).toBe("U1");
    expect(target.text).toContain(`${ORIGIN}/works/${work.id}`);
  });

  it("Slack で見つからない・DM できない人には、確かめ直す間が過ぎるまで送らない", async () => {
    const { ctx, post } = await setup();
    const n = await post();
    await recordSlackLookup(ctx, EMAIL, { kind: "not_found" });
    expect(await planDelivery(ctx, n.id, envOf("slack"))).toBeNull();
    ctx.clock.advance(SLACK_RECHECK_MS);
    expect((await planDelivery(ctx, n.id, envOf("slack")))?.targets).toEqual([
      expect.objectContaining({ channel: "slack", memberId: null }),
    ]);

    await recordSlackLookup(ctx, EMAIL, { kind: "found", memberId: "U1" });
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
    ctx.slackMembers.save = async (email, link) => {
      saves.push(link.state);
      await save(email, link);
    };
    await recordSlackLookup(ctx, EMAIL, { kind: "found", memberId: "U1" });
    await recordSlackLookup(ctx, EMAIL, { kind: "found", memberId: "U1" });
    expect(saves).toEqual(["linked"]);
    for (let i = 0; i < 2; i++)
      await recordDelivery(ctx, {
        notificationId: (await post()).id,
        target: slackRef("U1"),
        outcome: { kind: "rejected", reason: "cannot_dm" },
      });
    expect(saves).toEqual(["linked", "cannot_dm"]);
    expect(await ctx.slackMembers.find(EMAIL)).toMatchObject({
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

  it("非公開になった・閲覧権限が外れた制作物の通知は、どの経路にも制作物名・送り主・抜粋を出さない", async () => {
    const { ctx, work, post } = await setup();
    const n = await post();
    await recordSlackLookup(ctx, EMAIL, { kind: "found", memberId: "U1" });
    await ctx.works.update({
      ...(await ctx.works.findById(work.id))!,
      confidentiality: "restricted",
    });
    const restricted = await planDelivery(ctx, n.id, ALL);
    expect(restricted?.targets).toHaveLength(3);
    for (const t of restricted!.targets)
      expect(renderedOf(t)).not.toMatch(/夏のポスター|本郷|相談です/);

    await revokeWorkPermission(ctx, principals.sysadmin, { workId: work.id, userId: me.userId });
    const hidden = await planDelivery(ctx, n.id, ALL);
    expect(hidden?.targets.map((t) => t.channel)).toEqual(["push", "email", "slack"]);
    for (const t of hidden!.targets)
      expect(renderedOf(t)).not.toMatch(new RegExp(`夏のポスター|本郷|相談です|thr-1|${work.id}`));
    // 伏せた通知の決まった内容（非公開の制作物があることも出さない。行き先はトップ）
    const fixed = composeNotificationMessage({ notification: n, work: null, hidden: true });
    const [push, email, slack] = hidden!.targets;
    if (push?.channel !== "push" || email?.channel !== "email" || slack?.channel !== "slack")
      throw new Error("push, email and slack targets expected");
    expect(push.payload).toEqual(toPushPayload(fixed, 1));
    expect(email.content).toEqual(toEmail(fixed, ORIGIN));
    expect(slack.text).toBe(toSlackText(fixed, ORIGIN));
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

describe("Slack で引くメールアドレス", () => {
  it("Slack をオンにしていて、送れるアドレスがあるときだけ", async () => {
    const { ctx } = await setup();
    expect(await slackLookupEmail(ctx, me.userId)).toBe(EMAIL);
    await updateNotificationPrefs(ctx, me, { channels: ["email"] });
    expect(await slackLookupEmail(ctx, me.userId)).toBeNull();
    const reserved = await setup({ email: "mock-1@example.invalid" });
    expect(await slackLookupEmail(reserved.ctx, me.userId)).toBeNull();
  });
});

describe("通知の設定の届け先", () => {
  const statuses = async (ctx: ReturnType<typeof createInMemoryContext>) => {
    const s = await getNotificationSettings(ctx, me, new Set<DeliveryChannel>(["email"]));
    return { email: s.destinations.email.status, slack: s.destinations.slack.status };
  };

  it("経路ごとに、使えるか・オンか・アドレス・状態を返す", async () => {
    const { ctx } = await setup({ push: false });
    await updateNotificationPrefs(ctx, me, { channels: ["slack"] });
    const s = await getNotificationSettings(ctx, me, new Set<DeliveryChannel>(["push", "email"]));
    expect(s).toMatchObject({ showPreview: true, mutedCategories: [], channels: ["slack"] });
    expect(s.destinations).toEqual({
      email: { available: true, on: false, address: EMAIL, status: "ready" },
      slack: { available: false, on: true, address: EMAIL, status: "unresolved" },
    });
  });

  it("Slack の状態は引いた・送った結果に従う", async () => {
    const { ctx, post } = await setup({ push: false });
    expect(await statuses(ctx)).toEqual({ email: "ready", slack: "unresolved" });
    await recordSlackLookup(ctx, EMAIL, { kind: "not_found" });
    expect(await statuses(ctx)).toEqual({ email: "ready", slack: "not_found" });
    await recordSlackLookup(ctx, EMAIL, { kind: "found", memberId: "U1" });
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
