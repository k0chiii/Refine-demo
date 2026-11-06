// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { sendEmail } from "./lib/email.ts";

const cfg = { apiKey: "re_key", from: "MF100 <notify@mail.example.org>" };
const mail = {
  to: "someone@mail.example.org",
  content: { subject: "『夏のポスター』に新しい版", text: "第 3 版が提出されました" },
};

function reply(status: number, body?: unknown, headers?: Record<string, string>): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: headers ?? {},
  });
}

/** 応答を順に返す fetch と、待ち時間を記録するだけの sleep */
function resend(...responses: Array<Response | Error>) {
  const fetch = vi.fn(async () => {
    const next = responses.shift();
    if (!next) throw new Error("no response left");
    if (next instanceof Error) throw next;
    return next;
  });
  const sleep = vi.fn(async (_ms: number) => {});
  const run = () => sendEmail(cfg, mail, { idempotencyKey: "n1/email", fetch, sleep });
  return { fetch, sleep, run };
}

afterEach(() => vi.restoreAllMocks());

describe("Resend への送信", () => {
  it("1 通を Bearer と Idempotency-Key を付けて JSON で送る（to は配列）", async () => {
    const r = resend(reply(200, { id: "e1" }));
    expect(await r.run()).toEqual({ kind: "sent", httpStatus: 200 });
    const [url, init] = r.fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.resend.com/emails");
    expect(init.method).toBe("POST");
    expect(init.headers).toMatchObject({
      Authorization: "Bearer re_key",
      "Content-Type": "application/json",
      "Idempotency-Key": "n1/email",
    });
    expect(JSON.parse(init.body as string)).toEqual({
      from: cfg.from,
      to: [mail.to],
      subject: mail.content.subject,
      text: mail.content.text,
    });
  });

  it.each([
    ["2xx", reply(201, { id: "e1" }), { kind: "sent", httpStatus: 201 }],
    [
      "409 同じキーで受理済み",
      reply(409, { name: "invalid_idempotent_request", message: "payload differs" }),
      { kind: "sent", httpStatus: 409 },
    ],
    [
      "409 同じキーが処理中",
      reply(409, { name: "concurrent_idempotent_requests", message: "in flight" }),
      { kind: "retry" },
    ],
    [
      "422 宛先が不正",
      reply(422, { name: "invalid_to_address", message: "bad" }),
      { kind: "rejected", reason: "invalid_address", httpStatus: 422 },
    ],
    [
      "422 validation_error が to を指す",
      reply(422, { name: "validation_error", message: "The `to` field must be a string" }),
      { kind: "rejected", reason: "invalid_address", httpStatus: 422 },
    ],
    [
      "400 validation_error が内容を指す",
      reply(400, { name: "validation_error", message: "Missing `subject` field" }),
      { kind: "rejected", reason: "invalid_content", httpStatus: 400 },
    ],
    [
      "422 ほかの名前",
      reply(422, { name: "invalid_attachment", message: "x" }),
      { kind: "rejected", reason: "invalid_content", httpStatus: 422 },
    ],
    [
      "401 鍵が無い",
      reply(401, { name: "missing_api_key", message: "x" }),
      { kind: "unavailable", reason: "missing_api_key" },
    ],
    [
      "403 送信元のドメインが未確認",
      reply(403, { name: "validation_error", message: "domain is not verified" }),
      { kind: "unavailable", reason: "validation_error" },
    ],
    [
      "429 1 日の枠切れ",
      reply(429, { name: "daily_quota_exceeded", message: "x" }),
      { kind: "unavailable", reason: "daily_quota_exceeded" },
    ],
    [
      "429 1 月の枠切れ",
      reply(429, { name: "monthly_quota_exceeded", message: "x" }),
      { kind: "unavailable", reason: "monthly_quota_exceeded" },
    ],
    ["500", reply(500, { name: "internal_server_error", message: "x" }), { kind: "retry" }],
    ["503 本文なし", reply(503), { kind: "retry" }],
    [
      "502 本文が JSON でない",
      new Response("<html>bad gateway</html>", { status: 502 }),
      { kind: "retry" },
    ],
    ["つながらない", new Error("offline"), { kind: "retry" }],
  ])("%s", async (_name, response, expected) => {
    const r = resend(response);
    expect(await r.run()).toEqual(expected);
    expect(r.sleep).not.toHaveBeenCalled();
  });

  it("速さ制限の 429 は Retry-After だけ待って一度だけ送り直す", async () => {
    const r = resend(
      reply(429, { name: "rate_limit_exceeded", message: "x" }, { "Retry-After": "2" }),
      reply(200, { id: "e1" }),
    );
    expect(await r.run()).toEqual({ kind: "sent", httpStatus: 200 });
    expect(r.sleep.mock.calls).toEqual([[2000]]);
    expect(r.fetch).toHaveBeenCalledTimes(2);
  });

  it("Retry-After の待ちは 5 秒まで、二度目の 429 は待たずに retry", async () => {
    const r = resend(
      reply(429, { name: "rate_limit_exceeded", message: "x" }, { "Retry-After": "30" }),
      reply(429, { name: "rate_limit_exceeded", message: "x" }, { "Retry-After": "30" }),
    );
    expect(await r.run()).toEqual({ kind: "retry" });
    expect(r.sleep.mock.calls).toEqual([[5000]]);
    expect(r.fetch).toHaveBeenCalledTimes(2);
  });

  it("Retry-After が無い 429 は待たずに一度だけ送り直す", async () => {
    const r = resend(
      reply(429, { name: "rate_limit_exceeded", message: "x" }),
      reply(200, { id: "e1" }),
    );
    expect(await r.run()).toEqual({ kind: "sent", httpStatus: 200 });
    expect(r.sleep).not.toHaveBeenCalled();
    expect(r.fetch).toHaveBeenCalledTimes(2);
  });

  it("送り直しの先で決着しても、送り直しのあとの失敗でも、ログに宛先と本文は出ない", async () => {
    const logs: string[] = [];
    for (const level of ["log", "warn", "error"] as const)
      vi.spyOn(console, level).mockImplementation((...args: unknown[]) => {
        logs.push(args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" "));
      });
    for (const response of [
      reply(422, { name: "invalid_to_address", message: `${mail.to} is invalid` }),
      reply(401, { name: "missing_api_key", message: "x" }),
      reply(500, { name: "internal_server_error", message: "x" }),
    ])
      await resend(response).run();
    for (const line of logs) {
      expect(line).not.toContain(mail.to);
      expect(line).not.toContain(mail.content.text);
      expect(line).not.toContain(mail.content.subject);
    }
  });
});
