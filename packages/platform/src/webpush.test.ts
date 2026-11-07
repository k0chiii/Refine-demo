import { describe, expect, it, vi } from "vite-plus/test";
import { decryptPush, receiver, vapidKeys } from "./testing.ts";
import {
  base64urlDecode,
  base64urlEncode,
  encryptPushPayload,
  sendWebPush,
  vapidAuthorization,
  webPushOutcome,
} from "./webpush.ts";

const utf8 = new TextEncoder();
const ECDH = { name: "ECDH", namedCurve: "P-256" } as const;

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
