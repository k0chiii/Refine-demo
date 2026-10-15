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
