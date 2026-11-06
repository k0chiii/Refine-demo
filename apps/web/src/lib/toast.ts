/**
 * 警告・注意・失敗の知らせはカードや地の文に置かず、M3 のスナックバー（M3E snackbar）で出す（利用者指示 2026-10-15）。
 * - info は 4 秒で消える。warning は閉じるボタン付きで 8 秒。error は閉じるまで出し続ける（§35 A-17。利用者決定 2026-10-15）
 * - モーダルのダイアログを開いているときは、ダイアログの中に出す。外（body）に出すとダイアログの外は inert になり、
 *   押せず読み上げもされない（§35 A-01）
 * - 読み上げは常設のライブリージョンに書く（中身と一緒に現れるライブリージョンは読まれないことが多い。§35 A-03）。
 *   error は role="alert"、それ以外は role="status"
 * - 同じ文言を短い間に繰り返し出さない
 * アプリの知らせはすべてここを通す（M3eSnackbar.open を直接呼ばない）
 */
let last: { message: string; at: number } | null = null;

export type ToastKind = "info" | "warning" | "error";

/** いちばん手前に開いているモーダルのダイアログ（無ければ body） */
function host(): HTMLElement {
  const open = [...document.querySelectorAll<HTMLElement>("m3e-dialog[open]")];
  return open.at(-1) ?? document.body;
}

/** 読み上げ用のライブリージョン（見えない）。置き場所ごとに 1 つ */
function announce(where: HTMLElement, message: string, kind: ToastKind) {
  const role = kind === "error" ? "alert" : "status";
  let region = where.querySelector<HTMLElement>(`:scope > .mf-live[role="${role}"]`);
  if (!region) {
    region = document.createElement("div");
    region.className = "mf-live sr-only";
    region.setAttribute("role", role);
    where.append(region);
  }
  // 同じ文言でも読み直されるよう、いったん空にしてから書く
  region.textContent = "";
  const el = region;
  window.setTimeout(() => {
    el.textContent = message;
  }, 50);
}

export function toast(
  message: string,
  { kind = "info", action }: { kind?: ToastKind; action?: { label: string; run: () => void } } = {},
) {
  const now = Date.now();
  if (last && last.message === message && now - last.at < 4000) return;
  last = { message, at: now };
  const where = host();
  const snackbar = document.createElement("m3e-snackbar") as HTMLElement & {
    action: string;
    dismissible: boolean;
    duration: number;
    closeLabel: string;
    open: boolean;
    isActionTaken: boolean;
  };
  snackbar.append(document.createTextNode(message));
  if (action) snackbar.action = action.label;
  snackbar.dismissible = kind !== "info" || !!action;
  snackbar.closeLabel = "閉じる";
  snackbar.duration = kind === "error" ? 0 : kind === "warning" ? 8000 : action ? 8000 : 4000;
  snackbar.addEventListener("toggle", (e) => {
    if ((e as ToggleEvent).newState !== "closed") return;
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) snackbar.remove();
    else snackbar.addEventListener("transitionend", () => snackbar.remove(), { once: true });
    if (snackbar.isActionTaken) action?.run();
  });
  where.append(snackbar);
  // 読み上げは常設のライブリージョンに任せる（二重に読まれないように）
  snackbar.setAttribute("aria-live", "off");
  snackbar.open = true;
  announce(where, message, kind);
}

/** 画面の下に固定された部品（下部ナビ・浮遊ツールバー・FAB）。スナックバーはこの上に出す */
const BOTTOM_OBSTACLES = ".shell__bar, .ws__toolbar, .preview-fab, .submit-fab";

/**
 * スナックバーの位置を、開く直前に画面の下の部品の上（16px 空ける）に合わせる（M3 Snackbar: FAB・下部の部品と重ねない）。
 * M3E の snackbar は body に足される popover なので、文書で toggle を捕まえる（toggle は泡立たないが捕捉段階では届く）。
 * PWA の知らせ（lib/pwa.ts が M3eSnackbar.open で出す）にも効く
 */
export function installSnackbarPlacement() {
  const root = document.documentElement;
  document.addEventListener(
    "beforetoggle",
    (e) => {
      const t = e.target as HTMLElement;
      if (t.tagName !== "M3E-SNACKBAR" || (e as ToggleEvent).newState !== "open") return;
      let top = window.innerHeight;
      for (const el of document.querySelectorAll<HTMLElement>(BOTTOM_OBSTACLES)) {
        const r = el.getBoundingClientRect();
        // 見えていて、画面の下半分にあるものだけ
        if (r.width && r.height && r.top > window.innerHeight / 2) top = Math.min(top, r.top);
      }
      if (top < window.innerHeight)
        root.style.setProperty("--mf-snackbar-bottom", `${window.innerHeight - top + 16}px`);
      else root.style.removeProperty("--mf-snackbar-bottom");
    },
    true,
  );
}
