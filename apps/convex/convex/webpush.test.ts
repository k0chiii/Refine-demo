// @vitest-environment node
// 暗号化の相互運用（RFC 8291）を、標準の実装（http_ece。web-push ライブラリが使うもの）で復号して確かめる
import { createECDH, randomBytes } from "node:crypto";
import ece from "http_ece";
import { describe, expect, it, vi } from "vite-plus/test";
import {
  base64urlDecode,
  base64urlEncode,
  encryptPushPayload,
  sendWebPush,
  vapidAuthorization,
  type VapidKeys,
} from "./lib/webpush.ts";

function receiver() {
  const ecdh = createECDH("prime256v1");
  ecdh.generateKeys();
  return {
    ecdh,
    p256dh: base64urlEncode(new Uint8Array(ecdh.getPublicKey())),
    auth: base64urlEncode(new Uint8Array(randomBytes(16))),
  };
}

async function vapidKeys(): Promise<VapidKeys & { verifyKey: CryptoKey }> {
  const pair = (await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, [
    "sign",
    "verify",
  ])) as CryptoKeyPair;
  const raw = new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey));
  const jwk = await crypto.subtle.exportKey("jwk", pair.privateKey);
  return {
    publicKey: base64urlEncode(raw),
    privateKey: jwk.d!,
    subject: "mailto:ops@example.invalid",
    verifyKey: pair.publicKey,
  };
}

describe("Web Push の暗号化と VAPID", () => {
  it("端末の鍵で暗号化した本文を、標準の実装で復号できる（aes128gcm）", async () => {
    const r = receiver();
    const text = JSON.stringify({ title: "新しいコメント", body: "『夏のポスター』" });
    const sealed = await encryptPushPayload(new TextEncoder().encode(text), r);
    const opened = ece.decrypt(Buffer.from(sealed), {
      version: "aes128gcm",
      privateKey: r.ecdh,
      authSecret: r.auth,
    });
    expect(opened.toString("utf8")).toBe(text);
  });

  it("VAPID の JWT は公開鍵で検証でき、宛先のオリジン・期限・連絡先を持つ", async () => {
    const keys = await vapidKeys();
    const now = Date.UTC(2026, 9, 15, 12);
    const h = await vapidAuthorization("https://fcm.googleapis.com/fcm/send/x", keys, now);
    const m = /^vapid t=([^.]+)\.([^.]+)\.([^,]+), k=(.+)$/.exec(h)!;
    expect(m[4]).toBe(keys.publicKey);
    const ok = await crypto.subtle.verify(
      { name: "ECDSA", hash: "SHA-256" },
      keys.verifyKey,
      base64urlDecode(m[3]!),
      new TextEncoder().encode(`${m[1]}.${m[2]}`),
    );
    expect(ok).toBe(true);
    const claims = JSON.parse(new TextDecoder().decode(base64urlDecode(m[2]!)));
    expect(claims).toEqual({
      aud: "https://fcm.googleapis.com",
      exp: now / 1000 + 12 * 3600,
      sub: "mailto:ops@example.invalid",
    });
  });

  it("送るときのヘッダーと、つながらないときの扱い", async () => {
    const keys = await vapidKeys();
    const r = receiver();
    const target = { endpoint: "https://web.push.apple.com/abc", ...r };
    const fetch = vi.fn(async () => new Response(null, { status: 201 }));
    expect(await sendWebPush(target, { a: 1 }, keys, { now: Date.now(), fetch })).toBe(201);
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(target.endpoint);
    expect(init.headers).toMatchObject({
      "Content-Encoding": "aes128gcm",
      TTL: "86400",
      Urgency: "normal",
    });
    const failing = vi.fn(async () => {
      throw new Error("offline");
    });
    expect(await sendWebPush(target, {}, keys, { now: Date.now(), fetch: failing })).toBe(0);
  });
});
