import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { setupWork, submitFiles } from "../test/flows";
import { createCast, createHarness, type Harness } from "../test/harness";

const ORIGIN = "https://proof.example-org.jp";
const MEMBER = "U0REVIEWER";
const TITLE = "極秘ポスター";
const pdf = [{ fileName: "a.pdf", mimeType: "application/pdf", type: "pdf" as const }];

beforeEach(() => {
  // 予約した送信・引き当てが裏で走らないよう時計を止め、ここで 1 回ずつ呼ぶ
  vi.useFakeTimers({ toFake: ["setTimeout"] });
  vi.stubEnv("FRONTEND_URL", ORIGIN);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const RESEND_KEY = "re_test_key";

function emailEnv() {
  vi.stubEnv("RESEND_API_KEY", RESEND_KEY);
  vi.stubEnv("NOTIFY_EMAIL_FROM", "MF100 校正システム <notify@example-org.jp>");
}

function slackEnv() {
  vi.stubEnv("SLACK_BOT_TOKEN", "xoxb-test-token");
}

/** 試験の利用者は *@example.invalid（送らないアドレス）なので、送れるアドレスに替える */
async function setDeliverableEmail(t: Harness, userId: Id<"users">): Promise<string> {
  const email = `${userId}@example-org.jp`;
  await t.run((ctx) => ctx.db.patch(userId, { email }));
  return email;
}

type Service = "email" | "lookup" | "post";
interface Reply {
  status?: number;
  body?: unknown;
}

function serviceOf(url: string): Service | null {
  if (url === "https://api.resend.com/emails") return "email";
  const { origin, pathname } = new URL(url);
  if (origin !== "https://slack.com") return null;
  if (pathname === "/api/users.lookupByEmail") return "lookup";
  if (pathname === "/api/chat.postMessage") return "post";
  return null;
}

const SUCCESS: Record<Service, Reply> = {
  email: { body: { id: "email-1" } },
  lookup: { body: { ok: true, user: { id: MEMBER, deleted: false, is_bot: false } } },
  post: { body: { ok: true } },
};

/** Resend・Slack の代わり。replies はサービスごとに n 回目（0 から）の応答。無ければ成功 */
function fakeServices(
  replies: Partial<Record<Service, (n: number) => Reply | Promise<Reply>>> = {},
) {
  const counts: Record<Service, number> = { email: 0, lookup: 0, post: 0 };
  const fetch = vi.fn(async (url: string, _init?: RequestInit) => {
    const service = serviceOf(url);
    if (!service) throw new Error(`unexpected fetch: ${url}`);
    const reply = (await replies[service]?.(counts[service]++)) ?? SUCCESS[service];
    return new Response(JSON.stringify(reply.body ?? {}), { status: reply.status ?? 200 });
  });
  vi.stubGlobal("fetch", fetch);
  return {
    fetch,
    calls: (service: Service) =>
      fetch.mock.calls
        .filter(([url]) => serviceOf(url) === service)
        .map(([url, init]) => ({
          url,
          init: init ?? {},
          body: typeof init?.body === "string" ? init.body : "",
        })),
  };
}

async function scheduled(t: Harness, name: string) {
  return t.run(async (ctx) =>
    (await ctx.db.system.query("_scheduled_functions").collect()).filter(
      (f) => f.name.startsWith(name) && f.state.kind !== "canceled",
    ),
  );
}

describe("Convex 統合: Slack のメンバーを登録メールアドレスで引く", () => {
  it("トークンがあり送れるアドレスの人が Slack をオンにしたときだけ、引きに行く予約をする", async () => {
    const t = createHarness();
    const cast = await createCast(t);
    await setDeliverableEmail(t, cast.reviewer.id);
    const resolving = async () =>
      (await scheduled(t, "deliveryNode:resolveSlack")).map(
        (f) => (f.args[0] as { userId: string }).userId,
      );
    const setSlack = (on: boolean) =>
      cast.reviewer.as.mutation(api.notificationPrefs.update, { channels: on ? ["slack"] : [] });

    await setSlack(true);
    expect(await resolving()).toEqual([]);
    await setSlack(false);

    slackEnv();
    await setSlack(true);
    expect(await resolving()).toEqual([cast.reviewer.id]);
    // オンのままほかの項目を変えても引き直さない
    await cast.reviewer.as.mutation(api.notificationPrefs.update, { showPreview: false });
    expect(await resolving()).toEqual([cast.reviewer.id]);
    // 送らないアドレス（試験用のドメイン）の人は引かない
    await cast.stranger.as.mutation(api.notificationPrefs.update, { channels: ["slack"] });
    expect(await resolving()).toEqual([cast.reviewer.id]);
  });

  it("登録メールアドレスで引き、見つかれば設定の Slack が ready になる。一時的な失敗では投げない", async () => {
    slackEnv();
    const t = createHarness();
    const cast = await createCast(t);
    const email = await setDeliverableEmail(t, cast.reviewer.id);
    await cast.reviewer.as.mutation(api.notificationPrefs.update, { channels: ["slack"] });
    const slackStatus = async () =>
      (await cast.reviewer.as.query(api.notificationPrefs.get, {})).destinations.slack.status;
    expect(await slackStatus()).toBe("unresolved");

    const services = fakeServices({
      lookup: (n) => (n === 0 ? { status: 503 } : SUCCESS.lookup),
    });
    await t.action(internal.deliveryNode.resolveSlack, { userId: cast.reviewer.id });
    expect(await slackStatus()).toBe("unresolved");

    await t.action(internal.deliveryNode.resolveSlack, { userId: cast.reviewer.id });
    expect(await slackStatus()).toBe("ready");
    const lookups = services.calls("lookup");
    expect(lookups).toHaveLength(2);
    expect(new URL(lookups[1]!.url).searchParams.get("email")).toBe(email);
    expect(services.calls("post")).toHaveLength(0);
  });
});

type Cast = Awaited<ReturnType<typeof createCast>>;

/** 制作物を登録して校正者に割り当てる。校正者への割り当ての通知を返す */
async function assignReviewer(
  t: Harness,
  cast: Cast,
  over: { confidentiality?: "restricted" } = {},
) {
  const workId = await setupWork(t, cast, { title: TITLE, ...over });
  await submitFiles(cast, workId, pdf);
  await cast.manager.as.mutation(api.reviews.setReviewers, {
    workId,
    reviewerIds: [cast.reviewer.id],
  });
  const list = await cast.reviewer.as.query(api.notifications.list, {});
  const assigned = list.find((n) => n.kind === "review_assigned");
  if (!assigned) throw new Error("no review_assigned notification");
  return { workId, notificationId: assigned.id as string };
}

const deliver = (t: Harness, notificationId: string) =>
  t.action(internal.deliveryNode.deliver, { notificationId });

describe("Convex 統合: 外への通知（登録メールアドレス・Slack の DM）", () => {
  it("メールの秘密が無ければ、メールをオンにしていても送信を予約しない", async () => {
    const t = createHarness();
    const cast = await createCast(t);
    await setDeliverableEmail(t, cast.reviewer.id);
    await cast.reviewer.as.mutation(api.notificationPrefs.update, { channels: ["email"] });
    await assignReviewer(t, cast);
    expect(await scheduled(t, "delivery:enqueue")).toHaveLength(0);
  });

  it("メールをオンにした人への通知は、1 回の操作で何人に出しても予約 1 本にまとめる", async () => {
    emailEnv();
    const t = createHarness();
    const cast = await createCast(t);
    for (const user of [cast.reviewer, cast.approver]) {
      await setDeliverableEmail(t, user.id);
      await user.as.mutation(api.notificationPrefs.update, { channels: ["email"] });
    }
    const workId = await setupWork(t, cast);
    await cast.admin.as.mutation(api.acl.grant, {
      workId,
      userIds: [cast.approver.id],
      permission: "review",
    });
    await submitFiles(cast, workId, pdf);
    const before = new Set((await scheduled(t, "delivery:enqueue")).map((f) => f._id));
    await cast.manager.as.mutation(api.reviews.setReviewers, {
      workId,
      reviewerIds: [cast.reviewer.id, cast.approver.id],
    });
    const added = (await scheduled(t, "delivery:enqueue")).filter((f) => !before.has(f._id));
    expect(added).toHaveLength(1);
    const ids = (added[0]!.args[0] as { notificationIds: string[] }).notificationIds;
    const recipients = await t.run((ctx) =>
      Promise.all(
        ids.map(async (id) => (await ctx.db.get(id as Id<"notifications">))?.recipientId),
      ),
    );
    expect(new Set(recipients)).toEqual(new Set([cast.reviewer.id, cast.approver.id]));
  });

  it("メールをオフにしている人への通知は、秘密があっても予約しない", async () => {
    emailEnv();
    const t = createHarness();
    const cast = await createCast(t);
    await setDeliverableEmail(t, cast.reviewer.id);
    await assignReviewer(t, cast);
    expect(await scheduled(t, "delivery:enqueue")).toHaveLength(0);
  });

  it("登録メールアドレスに 1 通送り、決着したら次の実行では送らない", async () => {
    emailEnv();
    const t = createHarness();
    const cast = await createCast(t);
    const address = await setDeliverableEmail(t, cast.reviewer.id);
    await cast.reviewer.as.mutation(api.notificationPrefs.update, { channels: ["email"] });
    const { notificationId } = await assignReviewer(t, cast);
    const services = fakeServices();

    expect(await deliver(t, notificationId)).toBe(1);
    const [mail, ...more] = services.calls("email");
    expect(more).toHaveLength(0);
    expect(mail!.init.method).toBe("POST");
    expect(mail!.init.headers).toMatchObject({
      Authorization: `Bearer ${RESEND_KEY}`,
      "Idempotency-Key": `${notificationId}/email`,
    });
    const body = JSON.parse(mail!.body) as { to: string[]; text: string };
    expect(body.to).toEqual([address]);
    const links = (body.text.match(/https?:\/\/\S+/g) ?? []).map((l) => new URL(l));
    expect(links).toHaveLength(1);
    expect(links[0]!.origin).toBe(ORIGIN);
    expect(links[0]!.pathname).not.toBe("/");

    expect(await deliver(t, notificationId)).toBe(0);
    expect(services.calls("email")).toHaveLength(1);
  });

  it("メールを送った後で Slack が一時的に失敗したら投げ、次の実行では Slack だけ送る", async () => {
    emailEnv();
    slackEnv();
    const t = createHarness();
    const cast = await createCast(t);
    await setDeliverableEmail(t, cast.reviewer.id);
    await cast.reviewer.as.mutation(api.notificationPrefs.update, { channels: ["email", "slack"] });
    const { notificationId } = await assignReviewer(t, cast);
    const services = fakeServices({ post: (n) => (n === 0 ? { status: 503 } : SUCCESS.post) });

    await expect(deliver(t, notificationId)).rejects.toThrow("delivery_transient_failure");
    expect(services.calls("email")).toHaveLength(1);
    expect(services.calls("post")).toHaveLength(1);

    expect(await deliver(t, notificationId)).toBe(1);
    expect(services.calls("email")).toHaveLength(1);
    expect(services.calls("post")).toHaveLength(2);
    // 一度引いたメンバーには、引き直さずに送る
    expect(services.calls("lookup")).toHaveLength(1);
    const post = JSON.parse(services.calls("post")[1]!.body) as { channel: string };
    expect(post.channel).toBe(MEMBER);
  });

  it("Slack に見つからない人には DM を送らず、設定の Slack が not_found になる", async () => {
    slackEnv();
    const t = createHarness();
    const cast = await createCast(t);
    await setDeliverableEmail(t, cast.reviewer.id);
    await cast.reviewer.as.mutation(api.notificationPrefs.update, { channels: ["slack"] });
    const { notificationId } = await assignReviewer(t, cast);
    const services = fakeServices({
      lookup: () => ({ body: { ok: false, error: "users_not_found" } }),
    });

    expect(await deliver(t, notificationId)).toBe(0);
    expect(services.calls("lookup")).toHaveLength(1);
    expect(services.calls("post")).toHaveLength(0);
    const settings = await cast.reviewer.as.query(api.notificationPrefs.get, {});
    expect(settings.destinations.slack.status).toBe("not_found");
  });

  it("DM を開けない相手（channel_not_found）は、設定の Slack が cannot_dm になる", async () => {
    slackEnv();
    const t = createHarness();
    const cast = await createCast(t);
    await setDeliverableEmail(t, cast.reviewer.id);
    await cast.reviewer.as.mutation(api.notificationPrefs.update, { channels: ["slack"] });
    const { notificationId } = await assignReviewer(t, cast);
    const services = fakeServices({
      post: () => ({ body: { ok: false, error: "channel_not_found" } }),
    });

    expect(await deliver(t, notificationId)).toBe(0);
    expect(services.calls("post")).toHaveLength(1);
    const settings = await cast.reviewer.as.query(api.notificationPrefs.get, {});
    expect(settings.destinations.slack.status).toBe("cannot_dm");
  });

  it("閲覧権限を外された人へのメール・Slack には、非公開の制作物の名前を載せない", async () => {
    emailEnv();
    slackEnv();
    const t = createHarness();
    const cast = await createCast(t);
    await setDeliverableEmail(t, cast.reviewer.id);
    await cast.reviewer.as.mutation(api.notificationPrefs.update, { channels: ["email", "slack"] });
    const { workId, notificationId } = await assignReviewer(t, cast, {
      confidentiality: "restricted",
    });
    const stored = await t.run((ctx) => ctx.db.get(notificationId as Id<"notifications">));
    expect(stored?.body).toContain(TITLE);
    await cast.admin.as.mutation(api.acl.revoke, { workId, userId: cast.reviewer.id });
    const services = fakeServices();

    expect(await deliver(t, notificationId)).toBe(2);
    expect(services.calls("email")).toHaveLength(1);
    expect(services.calls("post")).toHaveLength(1);
    expect(JSON.stringify(services.fetch.mock.calls)).not.toContain(TITLE);
  });

  it("運用側の問題（Resend の鍵の誤り）は記録も再試行もせず、宛先をログに出さない", async () => {
    emailEnv();
    const t = createHarness();
    const cast = await createCast(t);
    const address = await setDeliverableEmail(t, cast.reviewer.id);
    await cast.reviewer.as.mutation(api.notificationPrefs.update, { channels: ["email"] });
    const { notificationId } = await assignReviewer(t, cast);
    const services = fakeServices({
      email: () => ({
        status: 403,
        body: { name: "invalid_api_key", message: "API key is invalid" },
      }),
    });
    const logs: unknown[][] = [];
    for (const level of ["log", "warn", "error"] as const)
      vi.spyOn(console, level).mockImplementation((...args) => void logs.push(args));

    expect(await deliver(t, notificationId)).toBe(0);
    // 決着していないので、鍵を直せば次の実行で送る
    expect(await deliver(t, notificationId)).toBe(0);
    expect(services.calls("email")).toHaveLength(2);
    expect(JSON.stringify(logs)).toContain("delivery_unavailable");
    expect(JSON.stringify(logs)).not.toContain(address);
  });

  it("送っている途中で既読になれば、残りの届け先には送らない", async () => {
    emailEnv();
    slackEnv();
    const t = createHarness();
    const cast = await createCast(t);
    await setDeliverableEmail(t, cast.reviewer.id);
    await cast.reviewer.as.mutation(api.notificationPrefs.update, { channels: ["email", "slack"] });
    const { notificationId } = await assignReviewer(t, cast);
    const services = fakeServices({
      email: async () => {
        await cast.reviewer.as.mutation(api.notifications.markRead, {
          notificationId: notificationId as Id<"notifications">,
        });
        return SUCCESS.email;
      },
    });

    expect(await deliver(t, notificationId)).toBe(1);
    expect(services.calls("email")).toHaveLength(1);
    expect(services.calls("lookup")).toHaveLength(0);
    expect(services.calls("post")).toHaveLength(0);
  });

  it("送る前に既読にした通知は、どこにも送らない", async () => {
    emailEnv();
    slackEnv();
    const t = createHarness();
    const cast = await createCast(t);
    await setDeliverableEmail(t, cast.reviewer.id);
    await cast.reviewer.as.mutation(api.notificationPrefs.update, { channels: ["email", "slack"] });
    const { notificationId } = await assignReviewer(t, cast);
    await cast.reviewer.as.mutation(api.notifications.markRead, {
      notificationId: notificationId as Id<"notifications">,
    });
    const services = fakeServices();

    expect(await deliver(t, notificationId)).toBe(0);
    expect(services.fetch).not.toHaveBeenCalled();
  });

  it("旧の pushNode.deliver は新しい配信に渡す", async () => {
    emailEnv();
    const t = createHarness();
    const cast = await createCast(t);
    await setDeliverableEmail(t, cast.reviewer.id);
    await cast.reviewer.as.mutation(api.notificationPrefs.update, { channels: ["email"] });
    const { notificationId } = await assignReviewer(t, cast);
    const services = fakeServices();

    expect(await t.action(internal.pushNode.deliver, { notificationId })).toBe(1);
    expect(services.calls("email")).toHaveLength(1);
  });

  it("旧の push.enqueue に通知 1 件の形で積まれた分も、workpool が送る", async () => {
    emailEnv();
    const t = createHarness();
    const cast = await createCast(t);
    await setDeliverableEmail(t, cast.reviewer.id);
    // 通知ができた後にオンにする（通知を作ったときの予約では送らせない）
    const { notificationId } = await assignReviewer(t, cast);
    await cast.reviewer.as.mutation(api.notificationPrefs.update, { channels: ["email"] });
    const services = fakeServices();

    await t.mutation(internal.push.enqueue, { notificationId });
    // workpool は空になっても自分を予約し続けるので、送るまでの数歩だけ進める
    for (let step = 0; step < 10 && services.calls("email").length === 0; step++) {
      vi.runOnlyPendingTimers();
      await t.finishInProgressScheduledFunctions();
    }
    expect(services.calls("email")).toHaveLength(1);
  });
});
