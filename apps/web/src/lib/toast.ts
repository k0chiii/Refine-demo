import { M3eSnackbar } from "@/ui/m3e";

/**
 * 警告・注意・失敗の知らせはカードや地の文に置かず、M3 のスナックバー（M3E snackbar）で出す（利用者指示 2026-10-15）。
 * 警告は閉じるボタン付きで少し長めに出す。同じ文言を短い間に繰り返し出さない。
 */
let last: { message: string; at: number } | null = null;

export function toast(
  message: string,
  {
    kind = "info",
    action,
  }: { kind?: "info" | "warning" | "error"; action?: { label: string; run: () => void } } = {},
) {
  const now = Date.now();
  if (last && last.message === message && now - last.at < 4000) return;
  last = { message, at: now };
  const duration = kind === "info" ? 4000 : 8000;
  if (action)
    M3eSnackbar.open(message, action.label, true, { duration, actionCallback: action.run });
  else M3eSnackbar.open(message, kind !== "info", { duration });
}

/** 画面の下に固定された部品（下部ナビ・浮遊ツールバー・FAB）。スナックバーはこの上に出す */
const BOTTOM_OBSTACLES = ".shell__bar, .ws__toolbar, .preview-fab";

/**
 * スナックバーの位置を、開く直前に画面の下の部品の上（16px 空ける）に合わせる（M3 Snackbar: FAB・下部の部品と重ねない）。
 * M3E の snackbar は body に足される popover なので、文書で toggle を捕まえる（toggle は泡立たないが捕捉段階では届く）。
 * M3eSnackbar.open を直接呼ぶ箇所（useAction など）にも効く
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
