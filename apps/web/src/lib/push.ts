/**
 * 端末への通知（Web Push）のブラウザ側。利用者決定 2026-10-15。
 * - 受け取れるのは Service Worker と Push API がある環境。iPhone・iPad は iOS 16.4 以降で、ホーム画面に追加したアプリだけ
 * - 通知の許可は、利用者がスイッチを押したときにだけ求める（開いただけで聞かない）
 * - 購読（endpoint と鍵）を Convex に登録し、Convex がこの端末へ送る
 */

export type PushSupport =
  | "available"
  /** iPhone・iPad の Safari（ホーム画面に追加すると使える） */
  | "needs_install"
  /** ブラウザの設定で通知を拒否している */
  | "denied"
  | "unsupported";

const isIos = () =>
  typeof navigator !== "undefined" &&
  (/iPhone|iPad|iPod/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1));

/** ホーム画面に追加したアプリ（PWA）として開いている */
export const isStandalone = () =>
  typeof window !== "undefined" &&
  (window.matchMedia?.("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true);

export function pushSupport(): PushSupport {
  if (typeof window === "undefined") return "unsupported";
  const has = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
  if (!has) return isIos() && !isStandalone() ? "needs_install" : "unsupported";
  if (Notification.permission === "denied") return "denied";
  return "available";
}

async function registration(): Promise<ServiceWorkerRegistration | null> {
  if (!("serviceWorker" in navigator)) return null;
  return (await navigator.serviceWorker.getRegistration("/")) ?? null;
}

/** この端末の今の購読（無ければ null） */
export async function currentPushSubscription(): Promise<PushSubscription | null> {
  const reg = await registration();
  return (await reg?.pushManager.getSubscription()) ?? null;
}

function toKey(base64url: string): Uint8Array<ArrayBuffer> {
  const b64 = base64url.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export interface PushSubscriptionJson {
  endpoint: string;
  p256dh: string;
  auth: string;
  device: string;
}

/** 端末を短く説明する（設定で見分けるため。細かい UA は送らない） */
function deviceLabel(): string {
  const ua = navigator.userAgent;
  const os = /iPhone/.test(ua)
    ? "iPhone"
    : /iPad/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
      ? "iPad"
      : /Android/.test(ua)
        ? "Android"
        : /Mac/.test(ua)
          ? "Mac"
          : /Windows/.test(ua)
            ? "Windows"
            : "その他";
  const browser = /Edg\//.test(ua)
    ? "Edge"
    : /Firefox\//.test(ua)
      ? "Firefox"
      : /Chrome\//.test(ua)
        ? "Chrome"
        : /Safari\//.test(ua)
          ? "Safari"
          : "ブラウザ";
  return `${os}・${browser}`;
}

/**
 * 通知を許可してもらい、この端末を購読する（スイッチを押したときに呼ぶ）。
 * 許可されなければ null。
 */
export async function enablePush(publicKey: string): Promise<PushSubscriptionJson | null> {
  const reg = await registration();
  if (!reg) throw new Error("準備中です。少し待ってからやり直してください");
  const permission = await Notification.requestPermission();
  if (permission !== "granted") return null;
  const sub =
    (await reg.pushManager.getSubscription()) ??
    (await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: toKey(publicKey),
    }));
  const json = sub.toJSON();
  if (!json.endpoint || !json.keys?.p256dh || !json.keys.auth)
    throw new Error("この端末の通知を設定できませんでした");
  return {
    endpoint: json.endpoint,
    p256dh: json.keys.p256dh,
    auth: json.keys.auth,
    device: deviceLabel(),
  };
}

/** この端末の購読をやめる（ブラウザ側）。endpoint を返す（サーバー側の解除に使う） */
export async function disablePush(): Promise<string | null> {
  const sub = await currentPushSubscription();
  if (!sub) return null;
  const endpoint = sub.endpoint;
  await sub.unsubscribe().catch(() => false);
  return endpoint;
}

/**
 * この端末に通知（バナー）を出す。サーバーを通さず、Service Worker から直接出す（通知をオンにした確認と、
 * サーバーの無いデモでの通知に使う）。inApp: 押したとき、開いているアプリの中で画面を移す（ページを読み込み直さない）
 */
export async function showDeviceNotification(n: {
  title: string;
  body: string;
  url?: string;
  tag?: string;
  /** アプリの通知の ID（押したら既読にする） */
  notificationId?: string;
  /** 通知ができた時刻（ミリ秒）。通知に出す時刻 */
  createdAt?: number;
  inApp?: boolean;
}): Promise<void> {
  if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
  const reg = await registration();
  if (!reg) return;
  await reg.showNotification(n.title, {
    body: n.body,
    icon: "/icons/icon-192.png",
    // Android のステータスバーに出す単色の小さなアイコン（白と透明）
    badge: "/icons/badge-96.png",
    lang: "ja",
    ...(n.createdAt ? { timestamp: n.createdAt } : {}),
    // 同じ会話の通知は置き換え、置き換えでも知らせる（Web Push の通知と同じ）
    ...(n.tag ? { tag: n.tag, renotify: true } : {}),
    data: { url: n.url ?? "/", id: n.notificationId ?? null, inApp: n.inApp === true },
  });
}

const LOCAL_KEY = "mf100.localNotify";
/** サーバーの無いデモで、この端末の中だけで通知を出すか（Web Push の代わり。端末に覚えておく） */
export function localNotifyEnabled(): boolean {
  try {
    return localStorage.getItem(LOCAL_KEY) === "1";
  } catch {
    return false;
  }
}
export function setLocalNotify(on: boolean): void {
  try {
    if (on) localStorage.setItem(LOCAL_KEY, "1");
    else localStorage.removeItem(LOCAL_KEY);
  } catch {
    /* 保存できなくても、その場では動く */
  }
}
