import { describeError } from "@/lib/errors";
import { toast } from "@/lib/toast";
import { M3eIcon, M3eMenuItemCheckbox, M3eSwitch } from "@/ui/m3e";
import { useDevicePush } from "./useDevicePush";

/**
 * 通知パネルの一番上:「この端末にも通知を送る」スイッチ（Web Push）。
 * 端末への通知が使えない環境（鍵の無い本番）では出さない。デモはサーバーが無いので「この端末の中だけ」で通知する。
 * iPhone の Safari ではスイッチの代わりに「ホーム画面に追加すると受け取れる」と案内する。
 * 通知パネル（M3E menu）の中ではスイッチを置かず、チェックの付くメニュー項目にする（M3 Menus: メニューの項目に
 * スイッチやボタンを入れない。選ぶ項目はチェック）。スマホのボトムシートでは行末のスイッチ
 */
export function PushSetting({ inMenu = false }: { inMenu?: boolean }) {
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
        ? "端末の設定で通知が拒否されています（設定 › 通知 から変えられます）"
        : push.local
          ? "デモ: この端末の中で起きた通知をバナーとアイコンの数字で知らせます"
          : "アプリを閉じていても、題名と制作物名を知らせます";

  if (inMenu)
    return (
      <M3eMenuItemCheckbox
        className="notif-push-item"
        checked={push.on}
        disabled={push.support !== "available" || push.pending}
        onClick={() => void toggle(!push.on)}
      >
        <span className="notif-push-item__text">
          この端末にも通知を送る
          <span className="notif-push-item__hint">{hint}</span>
        </span>
      </M3eMenuItemCheckbox>
    );

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
