import { useConvexAuth } from "convex/react";
import { useEffect, useState } from "react";
import { describeError } from "@/lib/errors";
import { isStandalone } from "@/lib/push";
import { toast } from "@/lib/toast";
import { M3eDialog } from "@/ui/LazyDialog";
import { M3eButton } from "@m3e/react/button";
import { M3eIcon } from "@m3e/react/icon";
import { useDevicePush } from "./useDevicePush";

const LATER_KEY = "mf100.notifyPromptLater";
/** 「あとで」を押したら、しばらく聞かない（通知パネルのスイッチからはいつでもオンにできる） */
const LATER_MS = 14 * 24 * 60 * 60 * 1000;

const askedRecently = () => {
  try {
    const at = Number(localStorage.getItem(LATER_KEY) ?? 0);
    return Date.now() - at < LATER_MS;
  } catch {
    return false;
  }
};

/**
 * ホーム画面に追加したアプリ（PWA）を開いたとき、まだ通知を許可も拒否もしていなければ「通知をオンにしますか？」と聞く
 * （M3 の基本のダイアログ。操作は「あとで」と「オンにする」の 2 つ）。
 * iPhone は利用者の操作の中でしか許可のポップアップを出せないので、まずこのダイアログを出し、「オンにする」を押したときに
 * 端末の許可のポップアップを出す。許可されたらすぐ確認の通知を出す。シェルに 1 つだけ置く
 */
export function NotificationPrompt() {
  const { isAuthenticated } = useConvexAuth();
  const push = useDevicePush();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!isAuthenticated || !push.ready || !push.usable || push.on) return;
    if (push.support !== "available" || !isStandalone()) return;
    if (Notification.permission !== "default" || askedRecently()) return;
    // 画面が落ち着いてから（開いた瞬間にいきなり出さない）
    const t = setTimeout(() => setOpen(true), 1200);
    return () => clearTimeout(t);
  }, [isAuthenticated, push.ready, push.usable, push.on, push.support]);

  const later = () => {
    try {
      localStorage.setItem(LATER_KEY, String(Date.now()));
    } catch {
      /* 覚えられなくても閉じる */
    }
    setOpen(false);
  };
  const turnOn = async () => {
    setBusy(true);
    try {
      const ok = await push.enable();
      if (!ok)
        toast("通知は許可されませんでした。端末の設定 › 通知 から変えられます", {
          kind: "warning",
        });
      setOpen(false);
    } catch (e) {
      toast(describeError(e).message, { kind: "error" });
      setOpen(false);
    } finally {
      setBusy(false);
    }
  };

  return (
    <M3eDialog
      open={open}
      onClosed={() => {
        if (open) later();
      }}
      className="dialog--narrow notify-prompt"
    >
      {/* M3 Dialogs: 見出しの上にアイコンを置くときは、アイコンと見出しを中央に揃える */}
      <span slot="header" className="notify-prompt__head">
        <M3eIcon name="notifications_active" className="notify-prompt__icon" />
        通知をオンにしますか？
      </span>
      <div className="dialog-body">
        <p className="notify-prompt__lead">
          コメントやメンション、締切の知らせを、この端末のバナーで受け取れます。未読の数はアプリのアイコンにも出ます。
        </p>
        <p className="small muted">
          あとからでも、通知（ベル）のパネルの一番上でオン・オフできます
        </p>
      </div>
      <div slot="actions" className="row">
        <M3eButton variant="text" disabled={busy} onClick={later}>
          あとで
        </M3eButton>
        <M3eButton variant="filled" disabled={busy} onClick={() => void turnOn()}>
          オンにする
        </M3eButton>
      </div>
    </M3eDialog>
  );
}
