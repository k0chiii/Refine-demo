// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { lookupSlackMember, postSlackDm } from "./lib/slack.ts";

const BASE = "https://meichan.example.invalid/slackbot/may";
const cfg = { baseUrl: BASE };
const TEAM = "T0123ABCD";
const email = "someone@mail.example.org";
const text = "*件名*\n本文";

function reply(body: unknown, status = 200, headers?: Record<string, string>): Response {
  return new Response(typeof body === "string" ? body : JSON.stringify(body), {
    status,
    headers: headers ?? {},
  });
}

function meichan(...responses: Array<Response | Error>) {
  const fetch = vi.fn<typeof globalThis.fetch>(async () => {
    const next = responses.shift();
    if (!next) throw new Error("no response left");
    if (next instanceof Error) throw next;
    return next;
  });
  const sleep = vi.fn(async (_ms: number) => {});
  return {
    fetch,
    sleep,
    lookup: () => lookupSlackMember(cfg, { teamId: TEAM, email }, { fetch, sleep }),
    post: () => postSlackDm(cfg, { teamId: TEAM, userId: "U123", text }, { fetch, sleep }),
    request: () => {
      const [url, init] = fetch.mock.calls[0]!;
      return {
        url: url as string,
        init: init ?? {},
        json: JSON.parse(init?.body as string) as unknown,
      };
    },
  };
}

/** JSON だけを送り、認証ヘッダは付けない（めいちゃんの仕様） */
function expectJsonWithoutAuth(init: RequestInit) {
  expect(init.method).toBe("POST");
  const headers = new Headers(init.headers);
  expect(headers.get("Content-Type")).toBe("application/json");
  expect(headers.has("Authorization")).toBe(false);
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("めいちゃんで Slack のメンバーを登録メールアドレスから引く（/userid）", () => {
  it("{base}/userid に email と team_id を JSON で送り、userId を返す", async () => {
    const s = meichan(reply({ userId: "U123" }));
    expect(await s.lookup()).toEqual({ kind: "found", memberId: "U123" });
    const { url, init, json } = s.request();
    expect(url).toBe(`${BASE}/userid`);
    expectJsonWithoutAuth(init);
    expect(json).toEqual({ email, team_id: TEAM });
  });

  it.each([
    ["404 はそのワークスペースにいない", reply({}, 404), { kind: "not_found" }],
    ["200 で userId が無い", reply({}), { kind: "unavailable", reason: "userid_missing" }],
    [
      "200 で userId が空",
      reply({ userId: "" }),
      { kind: "unavailable", reason: "userid_missing" },
    ],
    ["200 で本文が JSON でない", reply("ok"), { kind: "unavailable", reason: "userid_missing" }],
    ["400", reply({}, 400), { kind: "unavailable", reason: "http_400" }],
    ["403", reply({}, 403), { kind: "unavailable", reason: "http_403" }],
    ["500", reply({}, 500), { kind: "retry" }],
    ["503 で本文が JSON でない", reply("busy", 503), { kind: "retry" }],
    ["つながらない", new Error("offline"), { kind: "retry" }],
  ] as Array<[string, Response | Error, unknown]>)("%s", async (_name, response, expected) => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(await meichan(response).lookup()).toEqual(expected);
  });

  it("見つからないときは team_id をログに出し、メールアドレスは出さない", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await meichan(reply({}, 404)).lookup();
    const lines = warn.mock.calls.map((c) => c.map(String).join(" "));
    expect(lines.some((l) => l.includes(TEAM))).toBe(true);
    expect(lines.every((l) => !l.includes(email))).toBe(true);
  });

  it("429 は Retry-After だけ待って一度だけ引き直し、二度目の 429 は retry", async () => {
    const once = meichan(reply({}, 429, { "Retry-After": "3" }), reply({ userId: "U123" }));
    expect(await once.lookup()).toEqual({ kind: "found", memberId: "U123" });
    expect(once.sleep.mock.calls).toEqual([[3000]]);
    expect(once.fetch).toHaveBeenCalledTimes(2);

    const twice = meichan(reply({}, 429, { "Retry-After": "1" }), reply({}, 429));
    expect(await twice.lookup()).toEqual({ kind: "retry" });
    expect(twice.sleep).toHaveBeenCalledTimes(1);
    expect(twice.fetch).toHaveBeenCalledTimes(2);
  });
});

describe("めいちゃんで DM を送る（/dm）", () => {
  it("{base}/dm に team_id・user_id・text を JSON で送り、200 だけを送れたとする", async () => {
    const s = meichan(reply({ ok: true }));
    expect(await s.post()).toEqual({ kind: "sent", httpStatus: 200 });
    const { url, init, json } = s.request();
    expect(url).toBe(`${BASE}/dm`);
    expectJsonWithoutAuth(init);
    expect(json).toEqual({ team_id: TEAM, user_id: "U123", text });
  });

  it.each([
    [
      "404 は DM できない",
      reply({}, 404),
      { kind: "rejected", reason: "cannot_dm", httpStatus: 404 },
    ],
    ["400", reply({ error: "invalid" }, 400), { kind: "unavailable", reason: "http_400" }],
    ["403", reply({}, 403), { kind: "unavailable", reason: "http_403" }],
    ["500", reply({}, 500), { kind: "retry" }],
    ["502 で本文が JSON でない", reply("bad gateway", 502), { kind: "retry" }],
    ["つながらない", new Error("offline"), { kind: "retry" }],
  ] as Array<[string, Response | Error, unknown]>)("%s", async (_name, response, expected) => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(await meichan(response).post()).toEqual(expected);
  });

  it("429 は Retry-After だけ（5 秒まで）待って一度だけ送り直し、二度目の 429 は retry", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const once = meichan(reply({}, 429, { "Retry-After": "30" }), reply({ ok: true }));
    expect(await once.post()).toEqual({ kind: "sent", httpStatus: 200 });
    expect(once.sleep.mock.calls).toEqual([[5000]]);
    expect(once.fetch).toHaveBeenCalledTimes(2);

    const twice = meichan(reply({}, 429), reply({}, 429));
    expect(await twice.post()).toEqual({ kind: "retry" });
    expect(twice.fetch).toHaveBeenCalledTimes(2);
  });

  it("200 以外は状態と応答の本文（先頭 300 文字）をログに出し、送った本文は出さない", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await meichan(reply(`bad ${"x".repeat(400)}`, 400)).post();
    const logged = warn.mock.calls.map((c) => JSON.parse(String(c[0])) as Record<string, unknown>);
    expect(logged).toEqual([
      { event: "slack_dm_failed", teamId: TEAM, status: 400, body: `bad ${"x".repeat(296)}` },
    ]);
    expect(JSON.stringify(logged)).not.toContain("本文");
  });
});
