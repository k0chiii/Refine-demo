import { M3eDialog } from "@/ui/LazyDialog";
import { M3eButton } from "@m3e/react/button";
import { NotificationChannelsSetting } from "./NotificationChannelsSetting";
import { NotificationPrefsSetting } from "./NotificationPrefsSetting";
import { PushSetting } from "./PushSetting";
import { useNotificationSettings } from "./useNotificationSettings";

/**
 * アカウントの「通知の設定」（利用者指示 2026-10-17「通知の設定もプロフィールの方にやりたい」・2026-10-28。§61・§103）。
 * 上から、この端末への通知（Web Push）のスイッチ、外への届け先（登録メールアドレス・Slack（DM））、
 * 通知の受け取り方（内容の表示・種類ごとのオン・オフ。利用者指示 2026-10-18）。compact は全画面、それ以上は普通のダイアログ
 * （M3 Dialogs › Full-screen dialog。`dialog--full` に `dialog--narrow` を重ね、広い画面では幅 560 に抑える）。
 * 設定は 1 本の問い合わせで読み、下の部品へ渡す。出すかどうかは呼び出し側（`useNotificationSettingsAvailable`）が決める。
 * 初めて開くまで読み込まない（`_app` の `lazy`）
 */
export function NotificationSettingsDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const settings = useNotificationSettings(true);
  return (
    <M3eDialog
      open={open}
      onClosed={onClose}
      closeLabel="閉じる"
      className="dialog--full dialog--narrow push-dialog"
    >
      <span slot="header">通知の設定</span>
      <div className="dialog-body">
        <PushSetting />
        {settings ? <NotificationChannelsSetting settings={settings} /> : null}
        {settings ? <NotificationPrefsSetting prefs={settings} /> : null}
      </div>
      <div slot="actions" className="row">
        <M3eButton variant="text" onClick={onClose}>
          閉じる
        </M3eButton>
      </div>
    </M3eDialog>
  );
}
