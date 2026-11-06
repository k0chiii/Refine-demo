import type { SendOutcome } from "@mf100/domain";
import { type Fetch, retryAfterHintMs } from "./http.ts";

/*
 * Web Push の送信（外部ライブラリを使わず WebCrypto で実装。Workers にそのまま載る）。
 * - VAPID（RFC 8292）: ES256 の JWT でプッシュサービスに送り手を名乗る
 * - 本文の暗号化（RFC 8291 / RFC 8188 aes128gcm）: 端末の公開鍵と認証用の秘密で、端末だけが読めるようにする
 * 鍵は Worker の env（VAPID_PUBLIC_KEY・VAPID_PRIVATE_KEY・VAPID_SUBJECT）。無ければ送らない。
 * Convex の lib/webpush.ts の写し（Workers でも動く書き方だったので、暗号の部分は変えていない）。
 */

const utf8 = new TextEncoder();

export function base64urlEncode(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function base64urlDecode(s: string): Uint8Array<ArrayBuffer> {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/").replace(/=+$/, "");
  const bin = atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function concat(...parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

async function hkdf(
  salt: Uint8Array,
  ikm: Uint8Array,
  info: Uint8Array,
  length: number,
): Promise<Uint8Array<ArrayBuffer>> {
  const key = await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "HKDF", hash: "SHA-256", salt, info },
    key,
    length * 8,
  );
  return new Uint8Array(bits);
}

export interface VapidKeys {
  /** 公開鍵（P-256 非圧縮 65 バイト）の base64url。ブラウザの applicationServerKey にも渡す */
  publicKey: string;
  /** 秘密鍵（32 バイトの d）の base64url */
  privateKey: string;
  /** 連絡先（mailto: か https:）。プッシュサービスが問題のある送り手に連絡するため */
  subject: string;
}

/** env の鍵。揃っていなければ null（Web Push を使わない） */
export function vapidKeysFromEnv(
  env: Partial<
    Record<"VAPID_PUBLIC_KEY" | "VAPID_PRIVATE_KEY" | "VAPID_SUBJECT", string | undefined>
  >,
): VapidKeys | null {
  const publicKey = env.VAPID_PUBLIC_KEY?.trim();
  const privateKey = env.VAPID_PRIVATE_KEY?.trim();
  const subject = env.VAPID_SUBJECT?.trim();
  if (!publicKey || !privateKey || !subject) return null;
  return { publicKey, privateKey, subject };
}

/** VAPID の JWT の有効期限（RFC 8292 の上限は 24 時間。余裕を見て 12 時間） */
const VAPID_TTL_SECONDS = 12 * 3600;

/** VAPID の Authorization ヘッダー */
export async function vapidAuthorization(
  endpoint: string,
  keys: VapidKeys,
  nowMs: number,
): Promise<string> {
  const header = base64urlEncode(utf8.encode(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const claims = base64urlEncode(
    utf8.encode(
      JSON.stringify({
        aud: new URL(endpoint).origin,
        exp: Math.floor(nowMs / 1000) + VAPID_TTL_SECONDS,
        sub: keys.subject,
      }),
    ),
  );
  const pub = base64urlDecode(keys.publicKey);
  const key = await crypto.subtle.importKey(
    "jwk",
    {
      kty: "EC",
      crv: "P-256",
      x: base64urlEncode(pub.slice(1, 33)),
      y: base64urlEncode(pub.slice(33, 65)),
      d: keys.privateKey,
      ext: true,
    },
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"],
  );
  // WebCrypto の ECDSA の署名は r||s（64 バイト）で、JWS の ES256 の形そのもの
  const signature = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    key,
    utf8.encode(`${header}.${claims}`),
  );
  return `vapid t=${header}.${claims}.${base64urlEncode(new Uint8Array(signature))}, k=${keys.publicKey}`;
}

/** 1 レコードの大きさ（RFC 8188 の rs）。本文は 1 レコードに収める */
const RECORD_SIZE = 4096;

/**
 * 本文を端末向けに暗号化する（RFC 8291。Content-Encoding: aes128gcm の本体を返す）。
 * salt と送り手の鍵はテストのときだけ渡す（ふだんは毎回作る）。
 */
export async function encryptPushPayload(
  plaintext: Uint8Array,
  subscription: { p256dh: string; auth: string },
  fixed?: { salt: Uint8Array<ArrayBuffer>; keyPair: CryptoKeyPair },
): Promise<Uint8Array<ArrayBuffer>> {
  if (plaintext.length > RECORD_SIZE - 17) throw new Error("push payload too large");
  const uaPublic = base64urlDecode(subscription.p256dh);
  const authSecret = base64urlDecode(subscription.auth);
  const keyPair =
    fixed?.keyPair ??
    ((await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, [
      "deriveBits",
    ])) as CryptoKeyPair);
  const asPublic = new Uint8Array(
    (await crypto.subtle.exportKey("raw", keyPair.publicKey)) as ArrayBuffer,
  );
  const uaKey = await crypto.subtle.importKey(
    "raw",
    uaPublic,
    { name: "ECDH", namedCurve: "P-256" },
    false,
    [],
  );
  // workerd の型は `public` を `$public` と綴るが、実行時の名前は `public`（仕様どおり）
  const ecdh = { name: "ECDH", public: uaKey } as unknown as SubtleCryptoDeriveKeyAlgorithm;
  const shared = new Uint8Array(await crypto.subtle.deriveBits(ecdh, keyPair.privateKey, 256));
  const ikm = await hkdf(
    authSecret,
    shared,
    concat(utf8.encode("WebPush: info\0"), uaPublic, asPublic),
    32,
  );
  const salt = fixed?.salt ?? crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, utf8.encode("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(salt, ikm, utf8.encode("Content-Encoding: nonce\0"), 12);
  const aes = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["encrypt"]);
  // 最後のレコード: 本文の後ろに区切り 0x02（詰め物なし）
  const sealed = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv: nonce },
      aes,
      concat(plaintext, new Uint8Array([2])),
    ),
  );
  const rs = new Uint8Array(4);
  new DataView(rs.buffer).setUint32(0, RECORD_SIZE);
  return concat(salt, rs, new Uint8Array([asPublic.length]), asPublic, sealed);
}

export interface WebPushRequest {
  subscription: { endpoint: string; p256dh: string; auth: string };
  payload: unknown;
  vapid: VapidKeys;
  /** VAPID の期限の起点（ms）。省略は今 */
  now?: number;
  /** プッシュサービスが端末の不在中に抱える秒数。省略は 24 時間 */
  ttlSeconds?: number;
}

export interface WebPushResult {
  /** プッシュサービスの HTTP の状態（つながらなければ 0） */
  status: number;
  /** 429・503 の Retry-After（ms。上限なし）。次の予定を決める手がかり */
  retryAfterMs?: number;
}

/**
 * 1 端末に送る。暗号化の失敗（購読の鍵が壊れている）は投げる。ネットワークの失敗は status 0 で返す
 * （投げるか返すかの分担は Convex 版と同じ。deliver.ts が両方を retry に回す）
 */
export async function sendWebPush(req: WebPushRequest, doFetch: Fetch): Promise<WebPushResult> {
  const { subscription, vapid } = req;
  const now = req.now ?? Date.now();
  const body = await encryptPushPayload(utf8.encode(JSON.stringify(req.payload)), subscription);
  try {
    const res = await doFetch(subscription.endpoint, {
      method: "POST",
      headers: {
        Authorization: await vapidAuthorization(subscription.endpoint, vapid, now),
        "Content-Encoding": "aes128gcm",
        "Content-Type": "application/octet-stream",
        TTL: String(req.ttlSeconds ?? 24 * 3600),
        Urgency: "normal",
      },
      body,
    });
    const retryAfter = retryAfterHintMs(res.headers.get("Retry-After"), now);
    return retryAfter === undefined
      ? { status: res.status }
      : { status: res.status, retryAfterMs: retryAfter };
  } catch {
    return { status: 0 };
  }
}

/**
 * プッシュサービスの HTTP の状態 → 結果。2xx → sent、404・410 → rejected(gone)、429・5xx・0（つながらない）→ retry、
 * ほか → rejected(invalid_content)。購読の失敗回数は httpStatus から recordPushResult が数える
 */
export function webPushOutcome(status: number): SendOutcome {
  if (status >= 200 && status < 300) return { kind: "sent", httpStatus: status };
  if (status === 404 || status === 410)
    return { kind: "rejected", reason: "gone", httpStatus: status };
  if (status === 0 || status === 429 || status >= 500) return { kind: "retry" };
  return { kind: "rejected", reason: "invalid_content", httpStatus: status };
}
