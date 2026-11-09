// Web Push のテストが共有する道具（端末の側・VAPID の鍵）。Convex と Cloudflare の両方のテストが使う
import { expect } from "vite-plus/test";
import { base64urlEncode, type VapidKeys } from "./webpush.ts";

const utf8 = new TextEncoder();
// workerd の型は encode が返す配列の下敷きを ArrayBuffer と言い切らないので、WebCrypto に渡すものはここで複製する
const bytes = (text: string) => new Uint8Array(utf8.encode(text));
const ECDH = { name: "ECDH", namedCurve: "P-256" } as const;

/** 端末（受け手）。鍵と auth を自分で持つので、暗号文を開けられる */
export async function receiver() {
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

async function hkdf(
  salt: Uint8Array<ArrayBuffer>,
  ikm: Uint8Array<ArrayBuffer>,
  info: Uint8Array<ArrayBuffer>,
  bytes: number,
) {
  const key = await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]);
  return new Uint8Array(
    await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt, info }, key, bytes * 8),
  );
}

const cat = (...parts: Uint8Array[]): Uint8Array<ArrayBuffer> =>
  Uint8Array.from(parts.flatMap((p) => [...p]));

/**
 * RFC 8291 §3.4 の受け手の側を、送り側とは別に書いたもの（送り側の取り違えを同じ間違いで通さないため）。
 * 暗号文の頭（salt・rs・keyid）を読み、ECDH → HKDF → AES-GCM で開けて、末尾の区切り 0x02 を除く
 */
export async function decryptPush(body: Uint8Array, r: Awaited<ReturnType<typeof receiver>>) {
  const salt = body.slice(0, 16);
  const idLen = body[20]!;
  const asPublic = body.slice(21, 21 + idLen);
  const sealed = body.slice(21 + idLen);
  const asKey = await crypto.subtle.importKey("raw", asPublic, ECDH, false, []);
  const shared = new Uint8Array(
    await crypto.subtle.deriveBits(
      { name: "ECDH", public: asKey } as unknown as Parameters<SubtleCrypto["deriveBits"]>[0],
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
  const cek = await hkdf(salt, ikm, bytes("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(salt, ikm, bytes("Content-Encoding: nonce\0"), 12);
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

export async function vapidKeys(): Promise<VapidKeys & { verifyKey: CryptoKey }> {
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
