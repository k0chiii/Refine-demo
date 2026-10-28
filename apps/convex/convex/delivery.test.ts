import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { createCast, createHarness, type Harness } from "../test/harness";

const ORIGIN = "https://proof.example-org.jp";
const MEMBER = "U0REVIEWER";

beforeEach(() => {
  // 予約した送信・引き当てが裏で走らないよう時計を止め、ここで 1 回ずつ呼ぶ
  vi.useFakeTimers({ toFake: ["setTimeout"] });
  vi.stubEnv("FRONTEND_URL", ORIGIN);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

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
function fakeServices(replies: Partial<Record<Service, (n: number) => Reply>> = {}) {
  const counts: Record<Service, number> = { email: 0, lookup: 0, post: 0 };
  const fetch = vi.fn(async (url: string, _init?: RequestInit) => {
    const service = serviceOf(url);
    if (!service) throw new Error(`unexpected fetch: ${url}`);
    const reply = replies[service]?.(counts[service]++) ?? SUCCESS[service];
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
