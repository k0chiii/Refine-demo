import { useSyncExternalStore } from "react";
import { M3eSnackbar } from "@m3e/web/snackbar";

/**
 * PWA（Service Worker の登録・更新・オフラインの知らせ・インストール）。
 * - Service Worker は本番ビルド（デモを含む）だけで登録する。開発サーバーでは登録しない（HMR と干渉するため）
 * - 新しい版が届いたら M3E snackbar で「更新」を出す。押したときだけ切り替えて再読み込みする（書きかけの画面を勝手に読み直さない）
 * - オフラインになったら snackbar で知らせる（データは端末に保存しないので、つながるまで最新の内容は出ない）
 * - 画面のチャンクを読めなかったら、新しい版へ切り替えるか読み直す（recoverFromLoadError。そのあいだは ui/RouteError のエラー画面）
 */

let registration: ServiceWorkerRegistration | null = null;
let reloading = false;
/** 次に入った新しい版へ、「更新」を待たずに切り替える（読めないチャンクから立て直すとき） */
let switchOnInstall = false;
/** この画面で、画面のコード（チャンク）を読めなかったことがある（エラー画面の文言を分ける） */
let loadFailed = false;
/** 読めないチャンクのために読み直した時刻（sessionStorage）。読み直しても直らない外枠で繰り返さない */
const RELOADED_AT = "mf100-missing-chunk-reload";

function promptUpdate() {
  M3eSnackbar.open("新しいバージョンがあります", "更新", true, {
    duration: 0,
    closeLabel: "閉じる",
    actionCallback: applyUpdate,
  });
}

/** 待機中の新しい版に切り替え、切り替わったら再読み込みする */
export function applyUpdate() {
  const waiting = registration?.waiting;
  if (!waiting) return;
  reloading = true;
  waiting.postMessage({ type: "SKIP_WAITING" });
}

function watch(reg: ServiceWorkerRegistration) {
  // 既に待機中の版がある（前回の訪問で届いていた）
  if (reg.waiting && navigator.serviceWorker.controller) promptUpdate();
  reg.addEventListener("updatefound", () => {
    const next = reg.installing;
    next?.addEventListener("statechange", () => {
      // 初回のインストール（controller が無い）では知らせない。2 回目以降の「新しい版」だけ
      if (next.state !== "installed" || !navigator.serviceWorker.controller) return;
      if (switchOnInstall) applyUpdate();
      else promptUpdate();
    });
  });
}

const reloadedRecently = () => {
  try {
    return Date.now() - Number(sessionStorage.getItem(RELOADED_AT)) < 60_000;
  } catch {
    return true;
  }
};

function reload() {
  try {
    sessionStorage.setItem(RELOADED_AT, String(Date.now()));
  } catch {
    // 印を残せないと reloadedRecently が true になり、自動の読み直しはここで止まる
  }
  reloading = true;
  window.location.reload();
}

export const failedToLoad = () => loadFailed;

/**
 * 画面のコードを読めなかったときに立て直す。デプロイで配信側から消えたチャンクは、古い外枠からは読めない（Service Worker が 404 にする）。
 * 待機中の新しい版があればすぐ切り替え、無ければ確かめに行き、入ったら切り替える。新しい版が無ければ（通信が途切れただけ）読み直す。
 * 自動の読み直しは 1 分に 1 回まで（読み直しても直らない外枠で繰り返さない）。force（エラー画面の「再読み込み」）はこの制限を見ない。
 * 登録（registration）は load のあとで済むので、開いた直後に読めなかったときは既存の登録を探して使う
 * （待機中の版を見落とすと、読み直しても同じ古い外枠が出る）
 */
export function recoverFromLoadError({ force = false } = {}) {
  if (reloading && !force) return Promise.resolve();
  if (recovering && !force) return recovering;
  recovering = recover(force).finally(() => (recovering = undefined));
  return recovering;
}

/** 立て直しの最中（チャンクが続けて読めなくても、確かめに行くのは一度） */
let recovering: Promise<void> | undefined;

const within = (ms: number, p: Promise<unknown>) =>
  Promise.race([p, new Promise((done) => setTimeout(done, ms))]);

async function recover(force: boolean) {
  const reg =
    registration ?? (await navigator.serviceWorker?.getRegistration().catch(() => undefined));
  if (reg && !reg.waiting) {
    switchOnInstall = true;
    await within(
      3000,
      reg.update().catch(() => {}),
    );
    const next = reg.installing;
    // インストールが止まったままでも（Service Worker が外枠を取り切れない）読み直しへ進む
    if (next)
      await within(
        10_000,
        new Promise((done) =>
          next.addEventListener("statechange", () => next.state !== "installing" && done(null)),
        ),
      );
  }
  if (reg?.waiting) {
    registration ??= reg;
    applyUpdate();
  } else if (force || !reloadedRecently()) reload();
}

/** Vite の動的 import が失敗した（vite:preloadError）。ルーターの読み直し（同じ外枠のまま）に任せず、こちらで立て直す */
function recoverFromMissingChunk(e: Event) {
  e.preventDefault();
  loadFailed = true;
  void recoverFromLoadError();
}

/**
 * アプリアイコンの件数（Badging API）。ホーム画面に追加したアプリで、未読の通知の数をアイコンに出す。
 * 対応: iOS/iPadOS 16.4+（ホーム画面のアプリ・通知の許可が必要）、Chrome/Edge のインストール済みアプリ。
 * 非対応の環境では何もしない。アプリを開いている間の数で、閉じている間には増えない（それには Web Push が要る）。
 */
export function setAppBadge(count: number) {
  const nav = navigator as Navigator & {
    setAppBadge?: (n?: number) => Promise<void>;
    clearAppBadge?: () => Promise<void>;
  };
  if (!nav.setAppBadge || !nav.clearAppBadge) return;
  void (count > 0 ? nav.setAppBadge(count) : nav.clearAppBadge()).catch(() => {});
}

export function registerServiceWorker() {
  if (!import.meta.env.PROD || !("serviceWorker" in navigator)) return;
  window.addEventListener("vite:preloadError", recoverFromMissingChunk);
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (reloading) window.location.reload();
  });
  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("/sw.js", { scope: "/" })
      .then((reg) => {
        registration = reg;
        watch(reg);
        // 開きっぱなしでも新しい版に気づけるよう、1 時間ごとと画面に戻ったときに確かめる
        setInterval(() => void reg.update().catch(() => {}), 60 * 60 * 1000);
        document.addEventListener("visibilitychange", () => {
          if (document.visibilityState === "visible") void reg.update().catch(() => {});
        });
      })
      .catch((e: unknown) => console.warn("Service Worker を登録できませんでした", e));
  });
  window.addEventListener("offline", () =>
    M3eSnackbar.open(
      "オフラインです。つながるまで最新の内容は表示されず、保存も完了しません",
      true,
      {
        duration: 0,
        closeLabel: "閉じる",
      },
    ),
  );
  window.addEventListener("online", () =>
    M3eSnackbar.open("オンラインに戻りました", { duration: 3000 }),
  );
}

/* ---------- インストール（Chromium 系の beforeinstallprompt。Safari はブラウザの「ホーム画面に追加」） */

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

let deferred: BeforeInstallPromptEvent | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferred = e as BeforeInstallPromptEvent;
    emit();
  });
  window.addEventListener("appinstalled", () => {
    deferred = null;
    emit();
  });
}

/** インストールできるとき（ブラウザが提案できる状態）だけ install を返す */
export function useInstallPrompt(): (() => Promise<void>) | null {
  const canInstall = useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => deferred !== null,
    () => false,
  );
  if (!canInstall) return null;
  return async () => {
    const ev = deferred;
    if (!ev) return;
    await ev.prompt();
    await ev.userChoice;
    deferred = null;
    emit();
  };
}
