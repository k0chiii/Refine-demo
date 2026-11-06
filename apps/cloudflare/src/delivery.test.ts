import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import {
  addSlackWorkspace,
  createWork,
  grantWorkPermission,
  notify,
  subscribePush,
  updateNotificationPrefs,
} from "@mf100/application";
import { principals } from "@mf100/application/testing";
import { PUSH_MAX_FAILURES } from "@mf100/domain";
import { availableChannels, deliveryConfigFromEnv, deliveryEnvOf } from "./delivery/channels.ts";
import {
  DELIVERY_RETRY,
  deliverNotification,
  type DeliveryIo,
  nextRetryDelayMs,
  resolveSlackForUser,
} from "./delivery/deliver.ts";
import { sendEmail } from "./delivery/email.ts";
import { resolveSlackMember, sendSlackDm } from "./delivery/slack.ts";
import {
  base64urlDecode,
  base64urlEncode,
  encryptPushPayload,
  sendWebPush,
  vapidAuthorization,
  type VapidKeys,
  webPushOutcome,
} from "./delivery/webpush.ts";
import { createInMemoryContext } from "./testing/context.ts";

const utf8 = new TextEncoder();

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Web Push の暗号化と VAPID
// ---------------------------------------------------------------------------

const ECDH = { name: "ECDH", namedCurve: "P-256" } as const;

/** 端末（受け手）。鍵と auth を自分で持つので、暗号文を開けられる */
async function receiver() {
  const pair = (await crypto.subtle.generateKey(ECDH, true, ["deriveBits"])) as CryptoKeyPair;
  const raw = new Uint8Array((await crypto.subtle.exportKey("raw", pair.publicKey)) as ArrayBuffer);
  const auth = crypto.getRandomValues(new Uint8Array(16));
  return {
    privateKey: pair.privateKey,
    publicRaw: raw,
    authRaw: auth,
    p256dh: base64urlEncode(raw),
    auth: base64urlEncode(auth),
  };
}

async function hkdf(salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, bytes: number) {
  const key = await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]);
  return new Uint8Array(
    await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt, info }, key, bytes * 8),
  );
}

const cat = (...parts: Uint8Array[]) => Uint8Array.from(parts.flatMap((p) => [...p]));

/**
 * RFC 8291 §3.4 の受け手の側を、送り側とは別に書いたもの（送り側の取り違えを同じ間違いで通さないため）。
 * 暗号文の頭（salt・rs・keyid）を読み、ECDH → HKDF → AES-GCM で開けて、末尾の区切り 0x02 を除く
 */
async function decryptPush(body: Uint8Array, r: Awaited<ReturnType<typeof receiver>>) {
  const salt = body.slice(0, 16);
  const idLen = body[20]!;
  const asPublic = body.slice(21, 21 + idLen);
  const sealed = body.slice(21 + idLen);
  const asKey = await crypto.subtle.importKey("raw", asPublic, ECDH, false, []);
  const shared = new Uint8Array(
    await crypto.subtle.deriveBits(
      { name: "ECDH", public: asKey } as unknown as SubtleCryptoDeriveKeyAlgorithm,
      r.privateKey,
      256,
    ),
  );
  const ikm = await hkdf(
    r.authRaw,
    shared,
    cat(utf8.encode("WebPush: info\0"), r.publicRaw, asPublic),
    32,
  );
  const cek = await hkdf(salt, ikm, utf8.encode("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(salt, ikm, utf8.encode("Content-Encoding: nonce\0"), 12);
  const aes = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["decrypt"]);
  const plain = new Uint8Array(
    await crypto.subtle.decrypt({ name: "AES-GCM", iv: nonce }, aes, sealed),
  );
  expect(plain.at(-1)).toBe(2);
  return {
    text: new TextDecoder().decode(plain.slice(0, -1)),
    rs: new DataView(body.buffer, body.byteOffset + 16, 4).getUint32(0),
  };
}

async function vapidKeys(): Promise<VapidKeys & { verifyKey: CryptoKey }> {
  const pair = (await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, [
    "sign",
    "verify",
  ])) as CryptoKeyPair;
  const raw = new Uint8Array((await crypto.subtle.exportKey("raw", pair.publicKey)) as ArrayBuffer);
  const jwk = (await crypto.subtle.exportKey("jwk", pair.privateKey)) as JsonWebKey;
  return {
    publicKey: base64urlEncode(raw),
    privateKey: jwk.d!,
    subject: "mailto:ops@example.invalid",
    verifyKey: pair.publicKey,
  };
}

describe("Web Push の暗号化と VAPID", () => {
  it("端末の鍵で暗号化した本文を、別に書いた受け手で開ける（aes128gcm）", async () => {
    const r = await receiver();
    const text = JSON.stringify({ title: "新しいコメント", body: "『夏のポスター』" });
    const sealed = await encryptPushPayload(utf8.encode(text), r);
    const opened = await decryptPush(sealed, r);
    expect(opened.text).toBe(text);
    expect(opened.rs).toBe(4096);
    // 毎回 salt と送り手の鍵が変わる
    const again = await encryptPushPayload(utf8.encode(text), r);
    expect(base64urlEncode(again)).not.toBe(base64urlEncode(sealed));
  });

  it("RFC 8291 §5 の例（固定の鍵と salt）と同じバイト列になる", async () => {
    const asPublic =
      "BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8";
    const raw = base64urlDecode(asPublic);
    const jwk = {
      kty: "EC",
      crv: "P-256",
      x: base64urlEncode(raw.slice(1, 33)),
      y: base64urlEncode(raw.slice(33)),
    };
    const keyPair = {
      publicKey: await crypto.subtle.importKey("jwk", jwk, ECDH, true, []),
      privateKey: await crypto.subtle.importKey(
        "jwk",
        { ...jwk, d: "yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw" },
        ECDH,
        true,
        ["deriveBits"],
      ),
    } as CryptoKeyPair;
    const sealed = await encryptPushPayload(
      utf8.encode("When I grow up, I want to be a watermelon"),
      {
        p256dh:
          "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4",
        auth: "BTBZMqHH6r4Tts7J_aSIgg",
      },
      { salt: base64urlDecode("DGv6ra1nlYgDCS1FRnbzlw"), keyPair },
    );
    expect(base64urlEncode(sealed)).toBe(
      "DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN",
    );
  });

  it("本文が 1 レコードに収まらなければ投げる", async () => {
    const r = await receiver();
    await expect(encryptPushPayload(new Uint8Array(4096), r)).rejects.toThrow("too large");
  });

  it("VAPID の JWT は公開鍵で検証でき、宛先のオリジン・12 時間の期限・連絡先を持つ", async () => {
    const keys = await vapidKeys();
    const now = Date.UTC(2026, 9, 15, 12);
    const h = await vapidAuthorization("https://fcm.googleapis.com/fcm/send/x", keys, now);
    const m = /^vapid t=([^.]+)\.([^.]+)\.([^,]+), k=(.+)$/.exec(h)!;
    expect(m[4]).toBe(keys.publicKey);
    expect(JSON.parse(new TextDecoder().decode(base64urlDecode(m[1]!)))).toEqual({
      typ: "JWT",
      alg: "ES256",
    });
    const ok = await crypto.subtle.verify(
      { name: "ECDSA", hash: "SHA-256" },
      keys.verifyKey,
      base64urlDecode(m[3]!),
      utf8.encode(`${m[1]}.${m[2]}`),
    );
    expect(ok).toBe(true);
    expect(JSON.parse(new TextDecoder().decode(base64urlDecode(m[2]!)))).toEqual({
      aud: "https://fcm.googleapis.com",
      exp: now / 1000 + 12 * 3600,
      sub: "mailto:ops@example.invalid",
    });
  });

  it("送るときのヘッダー・つながらないとき・Retry-After の扱い", async () => {
    const keys = await vapidKeys();
    const r = await receiver();
    const subscription = {
      endpoint: "https://web.push.apple.com/abc",
      p256dh: r.p256dh,
      auth: r.auth,
    };
    const fetch = vi.fn<typeof globalThis.fetch>(async () => new Response(null, { status: 201 }));
    expect(await sendWebPush({ subscription, payload: { a: 1 }, vapid: keys }, fetch)).toEqual({
      status: 201,
    });
    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toBe(subscription.endpoint);
    expect(init?.headers).toMatchObject({
      "Content-Encoding": "aes128gcm",
      TTL: "86400",
      Urgency: "normal",
    });
    const body = init?.body as Uint8Array;
    expect((await decryptPush(body, r)).text).toBe('{"a":1}');

    const offline = vi.fn<typeof globalThis.fetch>(async () => {
      throw new Error("offline");
    });
    expect(await sendWebPush({ subscription, payload: {}, vapid: keys }, offline)).toEqual({
      status: 0,
    });

    const limited = vi.fn<typeof globalThis.fetch>(
      async () => new Response(null, { status: 429, headers: { "Retry-After": "120" } }),
    );
    expect(await sendWebPush({ subscription, payload: {}, vapid: keys }, limited)).toEqual({
      status: 429,
      retryAfterMs: 120_000,
    });
  });

  it.each([
    [200, { kind: "sent", httpStatus: 200 }],
    [201, { kind: "sent", httpStatus: 201 }],
    [404, { kind: "rejected", reason: "gone", httpStatus: 404 }],
    [410, { kind: "rejected", reason: "gone", httpStatus: 410 }],
    [429, { kind: "retry" }],
    [500, { kind: "retry" }],
    [503, { kind: "retry" }],
    [0, { kind: "retry" }],
    [400, { kind: "rejected", reason: "invalid_content", httpStatus: 400 }],
    [413, { kind: "rejected", reason: "invalid_content", httpStatus: 413 }],
  ])("プッシュサービスの HTTP の状態 %i → 結果", (status, expected) => {
    expect(webPushOutcome(status)).toEqual(expected);
  });
});

// ---------------------------------------------------------------------------
// メール（Resend）
// ---------------------------------------------------------------------------

const reply = (body: unknown, status = 200, headers?: Record<string, string>) =>
  new Response(typeof body === "string" ? body : JSON.stringify(body), {
    status,
    headers: headers ?? {},
  });

/** 順に応答を返す fetch。Error は「つながらない」 */
function sequence(...responses: Array<Response | Error>) {
  const fetch = vi.fn<typeof globalThis.fetch>(async () => {
    const next = responses.shift();
    if (!next) throw new Error("no response left");
    if (next instanceof Error) throw next;
    return next;
  });
  const sleep = vi.fn(async (_ms: number) => {});
  return { fetch, sleep };
}

describe("メール（Resend）", () => {
  const cfg = { apiKey: "re_test", from: "MF100 <notify@example-org.jp>" };
  const mail = { to: "someone@example-org.jp", content: { subject: "題名", text: "本文" } };
  const send = (s: ReturnType<typeof sequence>) =>
    sendEmail(cfg, mail, { idempotencyKey: "n1/email", fetch: s.fetch, sleep: s.sleep });

  it("Bearer と Idempotency-Key を付け、宛先・題名・本文を JSON で送る", async () => {
    const s = sequence(reply({ id: "e1" }));
    expect(await send(s)).toEqual({ kind: "sent", httpStatus: 200 });
    const [url, init] = s.fetch.mock.calls[0]!;
    expect(url).toBe("https://api.resend.com/emails");
    expect(init?.headers).toMatchObject({
      Authorization: "Bearer re_test",
      "Idempotency-Key": "n1/email",
    });
    expect(JSON.parse(init?.body as string)).toEqual({
      from: cfg.from,
      to: [mail.to],
      subject: "題名",
      text: "本文",
    });
  });

  it.each([
    [
      "409 invalid_idempotent_request は送れていた",
      reply({ name: "invalid_idempotent_request" }, 409),
      { kind: "sent", httpStatus: 409 },
    ],
    [
      "409 concurrent は retry",
      reply({ name: "concurrent_idempotent_requests" }, 409),
      { kind: "retry" },
    ],
    [
      "400 宛先の誤り",
      reply({ name: "invalid_to_address" }, 400),
      { kind: "rejected", reason: "invalid_address", httpStatus: 400 },
    ],
    [
      "422 validation_error（to）",
      reply({ name: "validation_error", message: "Invalid `to` field" }, 422),
      { kind: "rejected", reason: "invalid_address", httpStatus: 422 },
    ],
    [
      "400 ほかの誤り",
      reply({ name: "validation_error", message: "subject" }, 400),
      { kind: "rejected", reason: "invalid_content", httpStatus: 400 },
    ],
    [
      "403 鍵の誤りは運用側の問題",
      reply({ name: "invalid_api_key" }, 403),
      { kind: "unavailable", reason: "invalid_api_key" },
    ],
    [
      "429 送信枠切れ",
      reply({ name: "daily_quota_exceeded" }, 429),
      { kind: "unavailable", reason: "daily_quota_exceeded" },
    ],
    ["500", reply("oops", 500), { kind: "retry" }],
    ["つながらない", new Error("offline"), { kind: "retry" }],
  ] as Array<[string, Response | Error, unknown]>)("%s", async (_name, response, expected) => {
    expect(await send(sequence(response))).toEqual(expected);
  });

  it("速さ制限の 429 は Retry-After（5 秒まで）を一度だけ待って送り直し、二度目も 429 なら retry", async () => {
    const once = sequence(reply({}, 429, { "Retry-After": "30" }), reply({ id: "e1" }));
    expect(await send(once)).toEqual({ kind: "sent", httpStatus: 200 });
    expect(once.sleep.mock.calls).toEqual([[5000]]);
    const twice = sequence(reply({}, 429, { "Retry-After": "1" }), reply({}, 429));
    expect(await send(twice)).toEqual({ kind: "retry" });
    expect(twice.fetch).toHaveBeenCalledTimes(2);
  });
});

// ---------------------------------------------------------------------------
// Slack（めいちゃん）
// ---------------------------------------------------------------------------

const BASE = "https://meichan.example.invalid/slackbot/may";
const TEAM = "T0MAY";

describe("Slack（めいちゃん）", () => {
  const target = { teamId: TEAM, email: "someone@example-org.jp" };
  const lookup = (s: ReturnType<typeof sequence>) =>
    resolveSlackMember({ baseUrl: BASE }, target, { fetch: s.fetch, sleep: s.sleep });
  const dm = (s: ReturnType<typeof sequence>) =>
    sendSlackDm(
      { baseUrl: BASE },
      { teamId: TEAM, userId: "U1", text: "本文" },
      { fetch: s.fetch, sleep: s.sleep },
    );

  it("/userid に email と team_id を JSON で送り、認証ヘッダは付けない", async () => {
    const s = sequence(reply({ userId: "U123" }));
    expect(await lookup(s)).toEqual({ kind: "found", memberId: "U123" });
    const [url, init] = s.fetch.mock.calls[0]!;
    expect(url).toBe(`${BASE}/userid`);
    expect(new Headers(init?.headers).has("Authorization")).toBe(false);
    expect(JSON.parse(init?.body as string)).toEqual({ email: target.email, team_id: TEAM });
  });

  it.each([
    ["404", reply({}, 404), { kind: "not_found" }],
    [
      "500 の「Failed to get user id」は見つからない",
      reply("Failed to get user id", 500),
      { kind: "not_found" },
    ],
    ["200 で userId が無い", reply({}), { kind: "unavailable", reason: "userid_missing" }],
    ["403", reply({}, 403), { kind: "unavailable", reason: "http_403" }],
    ["500", reply({}, 500), { kind: "retry" }],
    ["つながらない", new Error("offline"), { kind: "retry" }],
  ] as Array<[string, Response | Error, unknown]>)(
    "引き当て: %s",
    async (_name, response, expected) => {
      vi.spyOn(console, "warn").mockImplementation(() => {});
      expect(await lookup(sequence(response))).toEqual(expected);
    },
  );

  it("/dm に team_id・user_id・text を送り、200 だけを送れたとする", async () => {
    const s = sequence(reply({ ok: true }));
    expect(await dm(s)).toEqual({ kind: "sent", httpStatus: 200 });
    const [url, init] = s.fetch.mock.calls[0]!;
    expect(url).toBe(`${BASE}/dm`);
    expect(JSON.parse(init?.body as string)).toEqual({
      team_id: TEAM,
      user_id: "U1",
      text: "本文",
    });
  });

  it.each([
    [
      "404 は DM できない",
      reply({}, 404),
      { kind: "rejected", reason: "cannot_dm", httpStatus: 404 },
    ],
    ["400", reply({}, 400), { kind: "unavailable", reason: "http_400" }],
    ["502", reply("bad gateway", 502), { kind: "retry" }],
    ["つながらない", new Error("offline"), { kind: "retry" }],
  ] as Array<[string, Response | Error, unknown]>)("DM: %s", async (_name, response, expected) => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(await dm(sequence(response))).toEqual(expected);
  });

  it("429 は Retry-After を一度だけ待って送り直し、二度目の 429 は retry", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const once = sequence(reply({}, 429, { "Retry-After": "3" }), reply({ ok: true }));
    expect(await dm(once)).toEqual({ kind: "sent", httpStatus: 200 });
    expect(once.sleep.mock.calls).toEqual([[3000]]);
    const twice = sequence(reply({}, 429), reply({}, 429));
    expect(await dm(twice)).toEqual({ kind: "retry" });
  });
});

// ---------------------------------------------------------------------------
// 経路ごとの env
// ---------------------------------------------------------------------------

describe("経路ごとの秘密（env）", () => {
  const full = {
    FRONTEND_URL: " https://mf100.example-org.jp/ ",
    VAPID_PUBLIC_KEY: "pub",
    VAPID_PRIVATE_KEY: "priv",
    VAPID_SUBJECT: "mailto:ops@example-org.jp",
    RESEND_API_KEY: "re_x",
    NOTIFY_EMAIL_FROM: "MF100 <notify@example-org.jp>",
    SLACK_BASE_URL: `${BASE}/`,
  };

  it("揃った経路だけが使え、URL は末尾の / を除く", () => {
    const c = deliveryConfigFromEnv(full);
    expect(c.origin).toBe("https://mf100.example-org.jp");
    expect(c.slack).toEqual({ baseUrl: BASE });
    expect([...availableChannels(c)].sort()).toEqual(["email", "push", "slack"]);
    expect(deliveryEnvOf(c).origin).toBe("https://mf100.example-org.jp");
  });

  it("FRONTEND_URL が無ければ、メールと Slack は使えない（端末だけ）", () => {
    const { FRONTEND_URL: _, ...rest } = full;
    expect([...availableChannels(deliveryConfigFromEnv(rest))]).toEqual(["push"]);
  });

  it("送信元にアドレスが無ければメールは使えず、鍵が欠ければ端末は使えない", () => {
    const c = deliveryConfigFromEnv({ ...full, NOTIFY_EMAIL_FROM: "nobody", VAPID_SUBJECT: "" });
    expect([...availableChannels(c)]).toEqual(["slack"]);
    expect(availableChannels(deliveryConfigFromEnv({}))).toEqual(new Set());
  });
});

// ---------------------------------------------------------------------------
// deliverNotification: 計画どおりに送って記録する
// ---------------------------------------------------------------------------

const ORIGIN = "https://mf100.example-org.jp";
const EMAIL = "stranger@example-org.jp";
const me = principals.stranger;
const PUSH_ENDPOINT = "https://fcm.googleapis.com/fcm/send/device-1";
const RESEND = "https://api.resend.com/emails";

type Service = "push" | "email" | "lookup" | "post";
interface Reply {
  status?: number;
  body?: unknown;
  headers?: Record<string, string>;
}
type Replies = Partial<Record<Service, (n: number) => Reply | Error>>;

const SUCCESS: Record<Service, Reply> = {
  push: { status: 201 },
  email: { body: { id: "e1" } },
  lookup: { body: { userId: "U0REVIEWER" } },
  post: { body: { ok: true } },
};

/** fetch の第 1 引数は文字列・URL・Request のどれでもよい */
const urlOf = (input: string | URL | Request): string =>
  typeof input === "string" ? input : input instanceof URL ? input.href : input.url;

function serviceOf(url: string): Service {
  if (url === PUSH_ENDPOINT) return "push";
  if (url === RESEND) return "email";
  if (url === `${BASE}/userid`) return "lookup";
  if (url === `${BASE}/dm`) return "post";
  throw new Error(`unexpected fetch: ${url}`);
}

/** プッシュサービス・Resend・めいちゃんの代わり。replies はサービスごとに n 回目（0 から）の応答。無ければ成功 */
function fakeServices(replies: Replies = {}) {
  const counts: Record<Service, number> = { push: 0, email: 0, lookup: 0, post: 0 };
  const fetch = vi.fn<typeof globalThis.fetch>(async (input) => {
    const service = serviceOf(urlOf(input));
    const r = replies[service]?.(counts[service]++) ?? SUCCESS[service];
    if (r instanceof Error) throw r;
    const body = typeof r.body === "string" ? r.body : JSON.stringify(r.body ?? {});
    return new Response(r.status === 201 || r.status === 204 ? null : body, {
      status: r.status ?? 200,
      headers: r.headers ?? {},
    });
  });
  return {
    fetch,
    calls: (service: Service) =>
      fetch.mock.calls
        .filter(([url]) => serviceOf(urlOf(url)) === service)
        .map(([url, init]) => ({ url: urlOf(url), init: init ?? {} })),
  };
}

async function envWithVapid() {
  const keys = await vapidKeys();
  return {
    FRONTEND_URL: ORIGIN,
    VAPID_PUBLIC_KEY: keys.publicKey,
    VAPID_PRIVATE_KEY: keys.privateKey,
    VAPID_SUBJECT: keys.subject,
    RESEND_API_KEY: "re_test",
    NOTIFY_EMAIL_FROM: "MF100 <notify@example-org.jp>",
    SLACK_BASE_URL: BASE,
  };
}

/** 通知 1 件を受け取る人（端末・メール・Slack をオン。Slack のワークスペースは 1 つだけで、オンにしたときに選ばれる） */
async function setup(opts: { channels?: Array<"email" | "slack"> } = {}) {
  const ctx = createInMemoryContext();
  await addSlackWorkspace(ctx, principals.sysadmin, { name: "五月祭", teamId: TEAM });
  ctx.state.names.set(principals.reviewer.userId, "本郷 校正");
  ctx.state.emails.set(me.userId, EMAIL);
  const work = await createWork(ctx, principals.manager, {
    title: "夏のポスター",
    purpose: "来場者向け案内",
    category: "印刷物",
    mediaType: "pdf",
    year: 100,
    creatorIds: [principals.creator.userId],
    approverId: principals.approver.userId,
  });
  await grantWorkPermission(ctx, principals.sysadmin, {
    workId: work.id,
    userIds: [me.userId],
    permission: "review",
  });
  await updateNotificationPrefs(ctx, me, { channels: opts.channels ?? ["email", "slack"] });
  const device = await receiver();
  const sub = await subscribePush(ctx, me, {
    endpoint: PUSH_ENDPOINT,
    p256dh: device.p256dh,
    auth: device.auth,
  });
  await notify(ctx, [me.userId], principals.reviewer.userId, {
    kind: "comment_posted",
    title: "新しいコメント",
    body: "『夏のポスター』・本郷 校正さん: 相談です",
    preview: "相談です",
    workId: work.id,
    threadId: "thr-1",
  });
  const notification = ctx.state.notifications.all().at(-1)!;
  const io = (
    services: ReturnType<typeof fakeServices>,
    extra: Partial<DeliveryIo> = {},
  ): DeliveryIo => ({
    fetch: services.fetch,
    now: () => ctx.clock.now(),
    sleep: async () => {},
    ...extra,
  });
  return { ctx, work, sub, device, notification, io, env: await envWithVapid() };
}

const settled = (ctx: Awaited<ReturnType<typeof setup>>["ctx"], id: string) =>
  ctx.deliveries.listSettled(id);

describe("deliverNotification: 計画どおりに送って記録する", () => {
  it("端末・メール・Slack に 1 回ずつ送って決着を記録し、次の呼び出しでは送らない", async () => {
    const { ctx, sub, notification, device, io, env } = await setup();
    const services = fakeServices();

    const result = await deliverNotification(ctx, notification.id, env, io(services));
    expect(result).toEqual({
      sent: [`push:${sub.id}`, "email", "slack"],
      rejected: [],
      unavailable: [],
      retry: false,
    });
    expect([...(await settled(ctx, notification.id))].sort()).toEqual(
      ["email", "slack", `push:${sub.id}`].sort(),
    );

    // 端末へは VAPID 付きで暗号化した本文、メールは通知 × 届け先の Idempotency-Key
    const [push] = services.calls("push");
    expect(new Headers(push!.init.headers).get("Authorization")).toMatch(/^vapid t=/);
    const payload = JSON.parse((await decryptPush(push!.init.body as Uint8Array, device)).text);
    expect(payload).toMatchObject({ id: notification.id });
    expect(services.calls("email")[0]!.init.headers).toMatchObject({
      "Idempotency-Key": `${notification.id}/email`,
    });
    // Slack は一度引いて、見つけたメンバーに送り、引いた結果を保存する
    expect(JSON.parse(services.calls("post")[0]!.init.body as string)).toMatchObject({
      team_id: TEAM,
      user_id: "U0REVIEWER",
    });
    expect(await ctx.slackMembers.find(TEAM, EMAIL)).toMatchObject({ memberId: "U0REVIEWER" });

    const before = services.fetch.mock.calls.length;
    expect(await deliverNotification(ctx, notification.id, env, io(services))).toEqual({
      sent: [],
      rejected: [],
      unavailable: [],
      retry: false,
    });
    expect(services.fetch.mock.calls.length).toBe(before);
  });

  it("端末が 429 なら retry で返し、ほかの届け先は送って記録する。次の呼び出しでは端末だけ送る", async () => {
    const { ctx, sub, notification, io, env } = await setup();
    const services = fakeServices({
      push: (n) => (n === 0 ? { status: 429, headers: { "Retry-After": "90" } } : SUCCESS.push),
    });

    const first = await deliverNotification(ctx, notification.id, env, io(services));
    expect(first.retry).toBe(true);
    expect(first.retryAfterMs).toBe(90_000);
    expect(first.sent).toEqual(["email", "slack"]);
    expect(await settled(ctx, notification.id)).not.toContain(`push:${sub.id}`);
    // 一時的な失敗は購読の失敗回数に数えない
    expect(ctx.state.pushSubscriptions.get(sub.id)?.failureCount).toBe(0);

    const second = await deliverNotification(ctx, notification.id, env, io(services));
    expect(second).toEqual({
      sent: [`push:${sub.id}`],
      rejected: [],
      unavailable: [],
      retry: false,
    });
    expect(services.calls("email")).toHaveLength(1);
    expect(services.calls("post")).toHaveLength(1);
    expect(services.calls("push")).toHaveLength(2);
  });

  it.each([
    ["5xx", { status: 503 } as Reply],
    ["つながらない", new Error("offline") as Reply | Error],
  ])("メールが %s なら retry で返し、投げない（記録もしない）", async (_name, failure) => {
    const { ctx, notification, io, env } = await setup({ channels: ["email"] });
    const services = fakeServices({ email: () => failure });
    vi.spyOn(console, "log").mockImplementation(() => {});

    const result = await deliverNotification(ctx, notification.id, env, io(services));
    expect(result.retry).toBe(true);
    expect(result.sent).toHaveLength(1); // 端末の分だけ
    expect(await settled(ctx, notification.id)).not.toContain("email");
  });

  it("端末が 410 Gone なら rejected で記録し、購読を消す（recordPushResult と同じ扱い）", async () => {
    const { ctx, sub, notification, io, env } = await setup({ channels: [] });
    const services = fakeServices({ push: () => ({ status: 410 }) });

    const result = await deliverNotification(ctx, notification.id, env, io(services));
    expect(result).toEqual({
      sent: [],
      rejected: [{ key: `push:${sub.id}`, reason: "gone" }],
      unavailable: [],
      retry: false,
    });
    expect(await settled(ctx, notification.id)).toContain(`push:${sub.id}`);
    expect(ctx.state.pushSubscriptions.get(sub.id)).toBeNull();
  });

  it("端末が 400 なら rejected で記録し、失敗回数を数える（続けて失敗すれば購読を消す）", async () => {
    const { ctx, sub, notification, io, env } = await setup({ channels: [] });
    const services = fakeServices({ push: () => ({ status: 400 }) });

    const result = await deliverNotification(ctx, notification.id, env, io(services));
    expect(result.rejected).toEqual([{ key: `push:${sub.id}`, reason: "invalid_content" }]);
    expect(ctx.state.pushSubscriptions.get(sub.id)?.failureCount).toBe(1);
    expect(PUSH_MAX_FAILURES).toBeGreaterThan(1);
  });

  it("Slack で見つからない人には DM を送らず rejected(not_found) で記録する", async () => {
    const { ctx, notification, io, env } = await setup({ channels: ["slack"] });
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const services = fakeServices({
      lookup: () => ({ status: 404 }),
      push: () => ({ status: 201 }),
    });

    const result = await deliverNotification(ctx, notification.id, env, io(services));
    expect(result.rejected).toEqual([{ key: "slack", reason: "not_found" }]);
    expect(services.calls("post")).toHaveLength(0);
    expect(await ctx.slackMembers.find(TEAM, EMAIL)).toMatchObject({ state: "not_found" });
  });

  it("DM を開けない相手（/dm が 404）は rejected(cannot_dm)。次は送らない", async () => {
    const { ctx, notification, io, env } = await setup({ channels: ["slack"] });
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const services = fakeServices({ post: () => ({ status: 404 }) });

    const result = await deliverNotification(ctx, notification.id, env, io(services));
    expect(result.rejected).toEqual([{ key: "slack", reason: "cannot_dm" }]);
    expect(await ctx.slackMembers.find(TEAM, EMAIL)).toMatchObject({ state: "cannot_dm" });
  });

  it("引き当てが 5xx なら retry。メンバーは保存されず、DM は送らない", async () => {
    const { ctx, notification, io, env } = await setup({ channels: ["slack"] });
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const services = fakeServices({ lookup: () => ({ status: 502 }) });

    const result = await deliverNotification(ctx, notification.id, env, io(services));
    expect(result.retry).toBe(true);
    expect(services.calls("post")).toHaveLength(0);
    expect(await settled(ctx, notification.id)).not.toContain("slack");
  });

  it("運用側の問題（Resend の鍵の誤り）は記録も retry もせず、宛先をログに出さない", async () => {
    const { ctx, notification, io, env } = await setup({ channels: ["email"] });
    const services = fakeServices({
      email: () => ({
        status: 403,
        body: { name: "invalid_api_key", message: "API key is invalid" },
      }),
    });
    const logs: unknown[][] = [];
    for (const level of ["log", "warn", "error"] as const)
      vi.spyOn(console, level).mockImplementation((...args) => void logs.push(args));

    const result = await deliverNotification(ctx, notification.id, env, io(services));
    expect(result.retry).toBe(false);
    expect(result.unavailable).toEqual([{ key: "email", reason: "invalid_api_key" }]);
    expect(await settled(ctx, notification.id)).not.toContain("email");
    expect(JSON.stringify(logs)).toContain("delivery_unavailable");
    expect(JSON.stringify(logs)).not.toContain(EMAIL);
  });

  it("送っている途中で既読になれば、残りの届け先には送らない", async () => {
    const { ctx, notification, io, env } = await setup();
    const services = fakeServices({
      push: () => {
        const n = ctx.state.notifications.get(notification.id)!;
        ctx.state.notifications.put({ ...n, readAt: ctx.clock.now() });
        return SUCCESS.push;
      },
    });

    const result = await deliverNotification(ctx, notification.id, env, io(services));
    expect(result.sent).toHaveLength(1);
    expect(services.calls("email")).toHaveLength(0);
    expect(services.calls("post")).toHaveLength(0);
  });

  it("既読の通知や env の揃っていない経路には送らない", async () => {
    const { ctx, notification, io, env } = await setup();
    const services = fakeServices();
    const none = await deliverNotification(
      ctx,
      notification.id,
      { FRONTEND_URL: ORIGIN },
      io(services),
    );
    expect(none).toEqual({ sent: [], rejected: [], unavailable: [], retry: false });
    expect(services.fetch).not.toHaveBeenCalled();
    void env;
  });

  it("DM は枠の時刻まで待って送り、遠い先まで埋まっていれば待たずに retry にする", async () => {
    const waits: number[] = [];
    {
      const { ctx, notification, io, env } = await setup({ channels: ["slack"] });
      const services = fakeServices();
      const result = await deliverNotification(
        ctx,
        notification.id,
        env,
        io(services, {
          sleep: async (ms) => void waits.push(ms),
          reserveSlackDm: async () => ({ ok: true, retryAfter: 700 }),
        }),
      );
      expect(waits).toEqual([700]);
      expect(result.sent).toContain("slack");
      expect(services.calls("post")).toHaveLength(1);
    }
    {
      const { ctx, notification, io, env } = await setup({ channels: ["slack"] });
      const services = fakeServices();
      const result = await deliverNotification(
        ctx,
        notification.id,
        env,
        io(services, { reserveSlackDm: async () => ({ ok: true, retryAfter: 10_001 }) }),
      );
      expect(result.retry).toBe(true);
      expect(services.calls("post")).toHaveLength(0);
    }
  });
});

describe("resolveSlackForUser", () => {
  it("選んだワークスペースで引き、見つかれば保存する", async () => {
    const { ctx, io, env } = await setup();
    const services = fakeServices();
    const result = await resolveSlackForUser(ctx, me.userId, env, io(services));
    expect(result).toEqual({ kind: "found", memberId: "U0REVIEWER" });
    expect(await ctx.slackMembers.find(TEAM, EMAIL)).toMatchObject({ memberId: "U0REVIEWER" });
  });

  it("引けなければ保存せず、結果だけ返す。めいちゃんが無ければ引かない", async () => {
    const { ctx, io, env } = await setup();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const failing = fakeServices({ lookup: () => ({ status: 503 }) });
    expect(await resolveSlackForUser(ctx, me.userId, env, io(failing))).toEqual({ kind: "retry" });
    expect(await ctx.slackMembers.find(TEAM, EMAIL)).not.toMatchObject({
      memberId: expect.any(String),
    });

    const idle = fakeServices();
    const { SLACK_BASE_URL: _, ...noSlack } = env;
    expect(await resolveSlackForUser(ctx, me.userId, noSlack, io(idle))).toEqual({
      kind: "skipped",
    });
    expect(idle.fetch).not.toHaveBeenCalled();
  });
});

describe("やり直しの方針", () => {
  it("4 回まで試し、失敗のあとの待ちは 1 秒・2 秒・4 秒", () => {
    expect(DELIVERY_RETRY).toEqual({ attempts: 4, backoffMs: [1000, 2000, 4000] });
    expect([1, 2, 3, 4, 5].map(nextRetryDelayMs)).toEqual([1000, 2000, 4000, null, null]);
  });
});
