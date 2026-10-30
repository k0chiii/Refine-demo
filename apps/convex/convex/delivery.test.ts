import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { setupWork, submitFiles } from "../test/flows";
import { createCast, createHarness, type Harness } from "../test/harness";

const ORIGIN = "https://proof.example-org.jp";
const MEICHAN = "https://meichan.example.invalid/slackbot/may";
const TEAM = "T0MAY";
const MEMBER = "U0REVIEWER";
const TITLE = "極秘ポスター";
const pdf = [{ fileName: "a.pdf", mimeType: "application/pdf", type: "pdf" as const }];

/** 待つ時間を記録してすぐ返す（DM の枠の時刻までの待ちを、時計を進めずに確かめる） */
const sleep = vi.hoisted(() => vi.fn(async (_ms: number) => {}));
vi.mock("./lib/retryAfter.ts", async (original) => ({
  ...(await original<typeof import("./lib/retryAfter.ts")>()),
  sleepFor: sleep,
}));

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
  sleep.mockClear();
});

const RESEND_KEY = "re_test_key";

function emailEnv() {
  vi.stubEnv("RESEND_API_KEY", RESEND_KEY);
  vi.stubEnv("NOTIFY_EMAIL_FROM", "MF100 校正システム <notify@example-org.jp>");
}

function slackEnv() {
  vi.stubEnv("SLACK_BASE_URL", MEICHAN);
}

type Cast = Awaited<ReturnType<typeof createCast>>;

/** DM の速さ制限（1 秒に 1 件）の窓を決まったものにするため、時計も止める。nextSecond で次の窓へ進める */
function freezeClock() {
  vi.useFakeTimers({ toFake: ["setTimeout", "Date"] });
}

function nextSecond() {
  vi.setSystemTime(Date.now() + 1_001);
}

/** 管理者が Slack のワークスペースを登録する（1 つだけなら、Slack をオンにした人はそれを選ぶ） */
function addWorkspace(cast: Cast, teamId = TEAM) {
  return cast.admin.as.mutation(api.slackWorkspaces.add, { name: `WS ${teamId}`, teamId });
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

const SERVICE_URLS: Record<string, Service> = {
  "https://api.resend.com/emails": "email",
  [`${MEICHAN}/userid`]: "lookup",
  [`${MEICHAN}/dm`]: "post",
};

function serviceOf(url: string): Service | null {
  return SERVICE_URLS[url] ?? null;
}

const SUCCESS: Record<Service, Reply> = {
  email: { body: { id: "email-1" } },
  lookup: { body: { userId: MEMBER } },
  post: { body: { ok: true } },
};

/** Resend・めいちゃんの代わり。replies はサービスごとに n 回目（0 から）の応答。無ければ成功 */
function fakeServices(
  replies: Partial<Record<Service, (n: number) => Reply | Promise<Reply>>> = {},
) {
  const counts: Record<Service, number> = { email: 0, lookup: 0, post: 0 };
  const fetch = vi.fn(async (url: string, _init?: RequestInit) => {
    const service = serviceOf(url);
    if (!service) throw new Error(`unexpected fetch: ${url}`);
    const reply = (await replies[service]?.(counts[service]++)) ?? SUCCESS[service];
    const body = typeof reply.body === "string" ? reply.body : JSON.stringify(reply.body ?? {});
    return new Response(body, { status: reply.status ?? 200 });
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
  it("めいちゃんがあり、ワークスペースを選んだ送れるアドレスの人が Slack をオンにした・ワークスペースを替えたときだけ、引きに行く予約をする", async () => {
    const t = createHarness();
    const cast = await createCast(t);
    await setDeliverableEmail(t, cast.reviewer.id);
    const resolving = async () =>
      (await scheduled(t, "deliveryNode:resolveSlack")).map(
        (f) => (f.args[0] as { userId: string }).userId,
      );
    const setSlack = (on: boolean) =>
      cast.reviewer.as.mutation(api.notificationPrefs.update, { channels: on ? ["slack"] : [] });

    await addWorkspace(cast);
    await setSlack(true);
    expect(await resolving()).toEqual([]);
    await setSlack(false);

    slackEnv();
    await setSlack(true);
    expect(await resolving()).toEqual([cast.reviewer.id]);
    // オンのままほかの項目を変えても引き直さない
    await cast.reviewer.as.mutation(api.notificationPrefs.update, { showPreview: false });
    expect(await resolving()).toEqual([cast.reviewer.id]);
    // ワークスペースを替えると、替えた先で引き直す
    const komaba = await addWorkspace(cast, "T0KOMABA");
    await cast.reviewer.as.mutation(api.notificationPrefs.update, { slackWorkspaceId: komaba.id });
    expect(await resolving()).toEqual([cast.reviewer.id, cast.reviewer.id]);
    // 送らないアドレス（試験用のドメイン）の人は引かない
    await cast.stranger.as.mutation(api.notificationPrefs.update, {
      channels: ["slack"],
      slackWorkspaceId: komaba.id,
    });
    expect(await resolving()).toEqual([cast.reviewer.id, cast.reviewer.id]);
  });

  it("Slack のメールアドレスを書く・替える・消すと引き直し、書いてあればそれで引く。設定には書いたものと引くアドレスが出る", async () => {
    slackEnv();
    const t = createHarness();
    const cast = await createCast(t);
    await addWorkspace(cast);
    const nogiku = await setDeliverableEmail(t, cast.reviewer.id);
    const update = (args: { slackEmail?: string | null; channels?: string[] }) =>
      cast.reviewer.as.mutation(api.notificationPrefs.update, args);
    const resolving = async () => (await scheduled(t, "deliveryNode:resolveSlack")).length;
    const slackRow = async () =>
      (await cast.reviewer.as.query(api.notificationPrefs.get, {})).destinations;

    // オフのうちに書いても引かない（オンにしたときに引く）
    await update({ slackEmail: " Reviewer@Slack-Profile.JP " });
    expect(await resolving()).toBe(0);
    await update({ channels: ["slack"] });
    expect(await resolving()).toBe(1);
    expect(await slackRow()).toMatchObject({
      email: { address: nogiku },
      slack: { address: "reviewer@slack-profile.jp", customEmail: "reviewer@slack-profile.jp" },
    });
    const services = fakeServices();
    await t.action(internal.deliveryNode.resolveSlack, { userId: cast.reviewer.id });
    expect(JSON.parse(services.calls("lookup")[0]!.body)).toEqual({
      email: "reviewer@slack-profile.jp",
      team_id: TEAM,
    });
    expect((await slackRow()).slack.status).toBe("ready");

    // 同じものを送っても引き直さない。替える・消すと引き直す
    await update({ slackEmail: "reviewer@slack-profile.jp" });
    expect(await resolving()).toBe(1);
    await update({ slackEmail: "reviewer2@slack-profile.jp" });
    expect(await resolving()).toBe(2);
    expect((await slackRow()).slack.status).toBe("unresolved");
    await update({ slackEmail: null });
    expect(await resolving()).toBe(3);
    expect((await slackRow()).slack).toMatchObject({ address: nogiku, customEmail: null });

    await expect(update({ slackEmail: "reviewer" })).rejects.toThrow(
      expect.objectContaining({
        data: expect.objectContaining({
          code: "notification_prefs_invalid",
          details: { field: "slackEmail" },
        }),
      }),
    );
  });

  it("Nogiku のアドレスが送れない形（試験用のドメイン）の人も、Slack のメールアドレスを書けば引きに行く", async () => {
    slackEnv();
    const t = createHarness();
    const cast = await createCast(t);
    await addWorkspace(cast);
    await cast.stranger.as.mutation(api.notificationPrefs.update, { channels: ["slack"] });
    expect(await scheduled(t, "deliveryNode:resolveSlack")).toEqual([]);
    await cast.stranger.as.mutation(api.notificationPrefs.update, {
      slackEmail: "stranger@slack-profile.jp",
    });
    expect(await scheduled(t, "deliveryNode:resolveSlack")).toHaveLength(1);
  });

  it("ワークスペースが無ければ、Slack をオンにしても引きに行かない", async () => {
    slackEnv();
    const t = createHarness();
    const cast = await createCast(t);
    await setDeliverableEmail(t, cast.reviewer.id);
    await cast.reviewer.as.mutation(api.notificationPrefs.update, { channels: ["slack"] });
    expect(await scheduled(t, "deliveryNode:resolveSlack")).toEqual([]);
    const services = fakeServices();
    await t.action(internal.deliveryNode.resolveSlack, { userId: cast.reviewer.id });
    expect(services.fetch).not.toHaveBeenCalled();
  });

  it("選んだワークスペースで登録メールアドレスを引き、見つかれば設定の Slack が ready になる。一時的な失敗では投げない", async () => {
    slackEnv();
    const t = createHarness();
    const cast = await createCast(t);
    await addWorkspace(cast);
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
    expect(JSON.parse(lookups[1]!.body)).toEqual({ email, team_id: TEAM });
    expect(services.calls("post")).toHaveLength(0);
  });
});

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
    freezeClock();
    emailEnv();
    slackEnv();
    const t = createHarness();
    const cast = await createCast(t);
    await addWorkspace(cast);
    await setDeliverableEmail(t, cast.reviewer.id);
    await cast.reviewer.as.mutation(api.notificationPrefs.update, { channels: ["email", "slack"] });
    const { notificationId } = await assignReviewer(t, cast);
    const services = fakeServices({ post: (n) => (n === 0 ? { status: 503 } : SUCCESS.post) });

    await expect(deliver(t, notificationId)).rejects.toThrow("delivery_transient_failure");
    expect(services.calls("email")).toHaveLength(1);
    expect(services.calls("post")).toHaveLength(1);

    // 失敗した DM も 1 秒の枠を使った
    nextSecond();
    expect(await deliver(t, notificationId)).toBe(1);
    expect(services.calls("email")).toHaveLength(1);
    expect(services.calls("post")).toHaveLength(2);
    // 一度引いたメンバーには、引き直さずに送る
    expect(services.calls("lookup")).toHaveLength(1);
    expect(JSON.parse(services.calls("post")[1]!.body)).toMatchObject({
      team_id: TEAM,
      user_id: MEMBER,
    });
  });

  it("Slack に見つからない人には DM を送らず、設定の Slack が not_found になる", async () => {
    slackEnv();
    const t = createHarness();
    const cast = await createCast(t);
    await addWorkspace(cast);
    await setDeliverableEmail(t, cast.reviewer.id);
    await cast.reviewer.as.mutation(api.notificationPrefs.update, { channels: ["slack"] });
    const { notificationId } = await assignReviewer(t, cast);
    const services = fakeServices({ lookup: () => ({ status: 404 }) });

    expect(await deliver(t, notificationId)).toBe(0);
    expect(services.calls("lookup")).toHaveLength(1);
    expect(services.calls("post")).toHaveLength(0);
    const settings = await cast.reviewer.as.query(api.notificationPrefs.get, {});
    expect(settings.destinations.slack.status).toBe("not_found");
  });

  it("めいちゃんが 500「Failed to get user id」を返す人は見つからないとし、やり直さず、届け先ごとの結果を宛先なしでログに出す", async () => {
    emailEnv();
    slackEnv();
    const t = createHarness();
    const cast = await createCast(t);
    await addWorkspace(cast);
    const address = await setDeliverableEmail(t, cast.reviewer.id);
    await cast.reviewer.as.mutation(api.notificationPrefs.update, { channels: ["email", "slack"] });
    const { notificationId } = await assignReviewer(t, cast);
    const services = fakeServices({
      lookup: () => ({ status: 500, body: "Failed to get user id" }),
    });
    const reports: unknown[] = [];
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation((line: unknown) => {
      const parsed = JSON.parse(String(line)) as { event?: string };
      if (parsed.event === "delivery_report") reports.push(parsed);
    });

    expect(await deliver(t, notificationId)).toBe(1);
    expect(services.calls("post")).toHaveLength(0);
    const settings = await cast.reviewer.as.query(api.notificationPrefs.get, {});
    expect(settings.destinations.slack.status).toBe("not_found");
    expect(reports).toEqual([
      {
        event: "delivery_report",
        notificationId,
        sent: 1,
        rejected: 1,
        retry: 0,
        unavailable: 0,
        targets: [
          { channel: "email", kind: "sent", httpStatus: 200 },
          { channel: "slack", kind: "rejected", reason: "not_found" },
        ],
      },
    ]);
    expect(JSON.stringify(reports)).not.toContain(address);
  });

  it("DM を開けない相手（/dm が 404）は、設定の Slack が cannot_dm になる", async () => {
    slackEnv();
    const t = createHarness();
    const cast = await createCast(t);
    await addWorkspace(cast);
    await setDeliverableEmail(t, cast.reviewer.id);
    await cast.reviewer.as.mutation(api.notificationPrefs.update, { channels: ["slack"] });
    const { notificationId } = await assignReviewer(t, cast);
    const services = fakeServices({ post: () => ({ status: 404 }) });

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
    await addWorkspace(cast);
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
    await addWorkspace(cast);
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

  it("DM は 1 秒に 1 件。続けて送る分は次の枠まで待って送り、落とさない", async () => {
    freezeClock();
    slackEnv();
    const t = createHarness();
    const cast = await createCast(t);
    await addWorkspace(cast);
    await setDeliverableEmail(t, cast.reviewer.id);
    await cast.reviewer.as.mutation(api.notificationPrefs.update, { channels: ["slack"] });
    const first = await assignReviewer(t, cast);
    const second = await assignReviewer(t, cast);
    expect(second.notificationId).not.toBe(first.notificationId);
    const services = fakeServices();

    expect(await deliver(t, first.notificationId)).toBe(1);
    expect(sleep).not.toHaveBeenCalled();
    expect(await deliver(t, second.notificationId)).toBe(1);
    expect(services.calls("post")).toHaveLength(2);
    expect(sleep).toHaveBeenCalledTimes(1);
    const waited = sleep.mock.calls[0]![0];
    expect(waited).toBeGreaterThan(0);
    expect(waited).toBeLessThanOrEqual(1_000);
    const lastPost = services.fetch.mock.invocationCallOrder.at(-1)!;
    expect(sleep.mock.invocationCallOrder[0]!).toBeLessThan(lastPost);
  });

  it("DM の枠が遠い先まで埋まっていれば、待たずに投げて workpool にやり直させる", async () => {
    freezeClock();
    slackEnv();
    const t = createHarness();
    const cast = await createCast(t);
    await addWorkspace(cast);
    await setDeliverableEmail(t, cast.reviewer.id);
    await cast.reviewer.as.mutation(api.notificationPrefs.update, { channels: ["slack"] });
    const { notificationId } = await assignReviewer(t, cast);
    for (let n = 0; n < 30; n++) {
      const { retryAfter } = await t.mutation(internal.delivery.reserveSlackDm, {});
      if (retryAfter > 10_000) break;
    }
    const services = fakeServices();

    await expect(deliver(t, notificationId)).rejects.toThrow("delivery_transient_failure");
    expect(services.calls("post")).toHaveLength(0);
    expect(sleep).not.toHaveBeenCalled();
  });

  it("登録が消えたワークスペースには、選んでいた人にも送らない", async () => {
    slackEnv();
    const t = createHarness();
    const cast = await createCast(t);
    const workspace = await addWorkspace(cast);
    await setDeliverableEmail(t, cast.reviewer.id);
    await cast.reviewer.as.mutation(api.notificationPrefs.update, { channels: ["slack"] });
    const { notificationId } = await assignReviewer(t, cast);
    await cast.admin.as.mutation(api.slackWorkspaces.remove, { id: workspace.id });
    const services = fakeServices();

    expect(await deliver(t, notificationId)).toBe(0);
    expect(services.fetch).not.toHaveBeenCalled();
    const settings = await cast.reviewer.as.query(api.notificationPrefs.get, {});
    expect(settings.destinations.slack).toMatchObject({
      workspaceId: null,
      status: "no_workspace",
    });
  });

  it("送る前に既読にした通知は、どこにも送らない", async () => {
    emailEnv();
    slackEnv();
    const t = createHarness();
    const cast = await createCast(t);
    await addWorkspace(cast);
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
