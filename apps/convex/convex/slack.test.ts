// @vitest-environment node
import { describe, expect, it, vi } from "vite-plus/test";
import { lookupSlackMember, postSlackDm } from "./lib/slack.ts";

const token = "xoxb-1-2-abc";
const email = "someone@mail.example.org";

/** Slack は失敗も HTTP 200 の {ok:false,error} で返す。速さ制限だけ HTTP 429 */
function reply(body: unknown, status = 200, headers?: Record<string, string>): Response {
  return new Response(JSON.stringify(body), { status, headers: headers ?? {} });
}

function slack(...responses: Array<Response | Error>) {
  const fetch = vi.fn(async () => {
    const next = responses.shift();
    if (!next) throw new Error("no response left");
    if (next instanceof Error) throw next;
    return next;
  });
  const sleep = vi.fn(async (_ms: number) => {});
  return {
    fetch,
    sleep,
    lookup: () => lookupSlackMember(token, email, { fetch, sleep }),
    post: () => postSlackDm(token, "U123", "*件名*\n本文", { fetch, sleep }),
    request: () => fetch.mock.calls[0] as unknown as [string, RequestInit],
  };
}

const TOKEN_ERRORS = [
  "invalid_auth",
  "not_authed",
  "account_inactive",
  "token_revoked",
  "missing_scope",
];

describe("Slack のメンバーを登録メールアドレスで引く", () => {
  it("users.lookupByEmail に Bearer で問い合わせ、見つかったメンバーの id を返す", async () => {
    const s = slack(reply({ ok: true, user: { id: "U123", deleted: false, is_bot: false } }));
    expect(await s.lookup()).toEqual({ kind: "found", memberId: "U123" });
    const [url, init] = s.request();
    const u = new URL(url);
    expect(`${u.origin}${u.pathname}`).toBe("https://slack.com/api/users.lookupByEmail");
    expect(u.searchParams.get("email")).toBe(email);
    expect(init.method ?? "GET").toBe("GET");
    expect(init.headers).toMatchObject({ Authorization: `Bearer ${token}` });
  });

  it.each([
    ["見つからない", reply({ ok: false, error: "users_not_found" }), { kind: "not_found" }],
    [
      "削除済み",
      reply({ ok: true, user: { id: "U9", deleted: true, is_bot: false } }),
      { kind: "not_found" },
    ],
    [
      "ボット",
      reply({ ok: true, user: { id: "U9", deleted: false, is_bot: true } }),
      { kind: "not_found" },
    ],
    ...TOKEN_ERRORS.map((error) => [
      `トークンの誤り ${error}`,
      reply({ ok: false, error }),
      { kind: "unavailable", reason: error },
    ]),
    [
      "ほかの ok:false",
      reply({ ok: false, error: "fatal_error" }),
      { kind: "unavailable", reason: "fatal_error" },
    ],
    ["HTTP 500", reply({ ok: false, error: "internal_error" }, 500), { kind: "retry" }],
    ["HTTP 503 本文が JSON でない", new Response("busy", { status: 503 }), { kind: "retry" }],
    ["HTTP 429 で本文なし", new Response(null, { status: 429 }), { kind: "retry" }],
    ["つながらない", new Error("offline"), { kind: "retry" }],
  ] as Array<[string, Response | Error, unknown]>)("%s", async (_name, response, expected) => {
    const s = slack(response);
    expect(await s.lookup()).toEqual(expected);
  });

  it("ratelimited は Retry-After だけ待って一度だけ引き直す", async () => {
    const s = slack(
      reply({ ok: false, error: "ratelimited" }, 429, { "Retry-After": "3" }),
      reply({ ok: true, user: { id: "U123", deleted: false, is_bot: false } }),
    );
    expect(await s.lookup()).toEqual({ kind: "found", memberId: "U123" });
    expect(s.sleep.mock.calls).toEqual([[3000]]);
    expect(s.fetch).toHaveBeenCalledTimes(2);
  });

  it("二度目の ratelimited は待たずに retry", async () => {
    const s = slack(
      reply({ ok: false, error: "ratelimited" }, 429, { "Retry-After": "1" }),
      reply({ ok: false, error: "ratelimited" }, 429, { "Retry-After": "1" }),
    );
    expect(await s.lookup()).toEqual({ kind: "retry" });
    expect(s.sleep).toHaveBeenCalledTimes(1);
    expect(s.fetch).toHaveBeenCalledTimes(2);
  });
});

describe("Slack の DM", () => {
  it("chat.postMessage に Bearer と JSON で送り、リンクの展開を切る", async () => {
    const s = slack(reply({ ok: true, ts: "1.2" }));
    expect(await s.post()).toEqual({ kind: "sent", httpStatus: 200 });
    const [url, init] = s.request();
    expect(url).toBe("https://slack.com/api/chat.postMessage");
    expect(init.method).toBe("POST");
    expect(init.headers).toMatchObject({ Authorization: `Bearer ${token}` });
    expect((init.headers as Record<string, string>)["Content-Type"]).toMatch(/^application\/json/);
    expect(JSON.parse(init.body as string)).toEqual({
      channel: "U123",
      text: "*件名*\n本文",
      unfurl_links: false,
      unfurl_media: false,
    });
  });

  it.each([
    ...[
      "channel_not_found",
      "not_in_channel",
      "cannot_dm_bot",
      "user_disabled",
      "is_archived",
      "messages_tab_disabled",
    ].map((error) => [
      `DM できない ${error}`,
      reply({ ok: false, error }),
      { kind: "rejected", reason: "cannot_dm", httpStatus: 200 },
    ]),
    ...TOKEN_ERRORS.map((error) => [
      `トークンの誤り ${error}`,
      reply({ ok: false, error }),
      { kind: "unavailable", reason: error },
    ]),
    [
      "ほかの ok:false",
      reply({ ok: false, error: "msg_too_long" }),
      { kind: "rejected", reason: "invalid_content", httpStatus: 200 },
    ],
    ["HTTP 500", reply({ ok: false, error: "internal_error" }, 500), { kind: "retry" }],
    [
      "HTTP 502 本文が JSON でない",
      new Response("bad gateway", { status: 502 }),
      { kind: "retry" },
    ],
    ["HTTP 429 で本文なし", new Response(null, { status: 429 }), { kind: "retry" }],
    ["つながらない", new Error("offline"), { kind: "retry" }],
  ] as Array<[string, Response | Error, unknown]>)("%s", async (_name, response, expected) => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const s = slack(response);
    expect(await s.post()).toEqual(expected);
    vi.restoreAllMocks();
  });

  it("ratelimited は Retry-After だけ（5 秒まで）待って一度だけ送り直す", async () => {
    const s = slack(
      reply({ ok: false, error: "ratelimited" }, 429, { "Retry-After": "30" }),
      reply({ ok: true, ts: "1.2" }),
    );
    expect(await s.post()).toEqual({ kind: "sent", httpStatus: 200 });
    expect(s.sleep.mock.calls).toEqual([[5000]]);
    expect(s.fetch).toHaveBeenCalledTimes(2);
  });

  it("ほかの ok:false はログに error を出し、本文は出さない", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await slack(reply({ ok: false, error: "msg_too_long" })).post();
    const lines = warn.mock.calls.map((c) => c.map(String).join(" "));
    expect(lines.some((l) => l.includes("msg_too_long"))).toBe(true);
    expect(lines.every((l) => !l.includes("本文"))).toBe(true);
    vi.restoreAllMocks();
  });
});
