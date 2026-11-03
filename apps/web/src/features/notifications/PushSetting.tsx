import { describeError } from "@/lib/errors";
import { toast } from "@/lib/toast";
import { M3eIcon } from "@m3e/react/icon";
import { M3eSwitch } from "@m3e/react/switch";
import { useDevicePush } from "./useDevicePush";

/**
 * 「この端末にも通知を送る」スイッチ（Web Push）。アカウントメニューの「通知の設定」ダイアログに置く
 * （利用者指示 2026-10-17「通知の設定もプロフィールの方にやりたい。この位置は通知が醜すぎる」。以前は通知パネルの一番上）。
 * 端末への通知が使えない環境（鍵の無い本番）では出さない。デモはサーバーが無いので「この端末の中だけ」で通知する。
 * iPhone の Safari ではスイッチの代わりに「ホーム画面に追加すると受け取れる」と案内する。
 */
export function PushSetting() {
  const push = useDevicePush();
  if (!push.usable || push.support === "unsupported") return null;

  const toggle = async (next: boolean) => {
    try {
      if (next) {
        if (!(await push.enable())) toast("通知が許可されませんでした", { kind: "warning" });
      } else await push.disable();
    } catch (e) {
      toast(describeError(e).message, { kind: "error" });
    }
  };

  const hint =
    push.support === "needs_install"
      ? "iPhone・iPad は「ホーム画面に追加」したアプリで受け取れます"
      : push.support === "denied"
        ? "端末の設定で通知がオフになっています"
        : push.local
          ? "デモ: この端末の中で起きた通知をバナーとアイコンの数字で知らせます"
          : "アプリを閉じていても届きます";

  return (
    <div className="notif-push">
      <M3eIcon
        name={push.on ? "notifications_active" : "notifications_off"}
        className="notif-push__icon"
      />
      <div className="notif-push__text">
        <span className="notif-push__label" id="notif-push-label">
          この端末にも通知を送る
        </span>
        <span className="notif-push__hint">{hint}</span>
      </div>
      {push.support === "available" ? (
        <M3eSwitch
          aria-labelledby="notif-push-label"
          checked={push.on}
          icons="selected"
          {...(push.pending ? { disabled: true } : {})}
          onChange={(e) => void toggle((e.target as unknown as { checked: boolean }).checked)}
        />
      ) : null}
    </div>
  );
}
