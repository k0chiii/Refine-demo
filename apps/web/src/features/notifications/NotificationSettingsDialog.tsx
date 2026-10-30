import { api } from "@mf100/convex/api";
import { TEST_NOTIFICATION_INTERVAL_MS } from "@mf100/domain";
import { useMutation } from "convex/react";
import { useEffect, useState } from "react";
import { toast } from "@/lib/toast";
import { useAction } from "@/lib/useAction";
import { M3eDialog } from "@/ui/LazyDialog";
import { M3eButton } from "@m3e/react/button";
import { M3eIcon } from "@m3e/react/icon";
import { NotificationChannelsSetting } from "./NotificationChannelsSetting";
import { NotificationPrefsSetting } from "./NotificationPrefsSetting";
import { PushSetting } from "./PushSetting";
import { useNotificationSettings } from "./useNotificationSettings";

/**
 * 「テスト通知を送る」（§112）。自分宛に 1 件作り、ベルとオンにした経路に届く。
 * 送っている間と送ってから 1 分は押せない（決まりはサーバーの test_notification_too_soon。開き直すと押せるが断られる）
 */
function TestNotificationButton() {
  const sendTest = useMutation(api.notifications.sendTest);
  const send = useAction(async () => {
    await sendTest({});
    return true;
  });
  const [cooling, setCooling] = useState(false);
  useEffect(() => {
    if (!cooling) return;
    const id = setTimeout(() => setCooling(false), TEST_NOTIFICATION_INTERVAL_MS);
    return () => clearTimeout(id);
  }, [cooling]);
  return (
    <div className="notif-test">
      <M3eButton
        variant="outlined"
        data-action="send-test"
        disabled={send.pending || cooling}
        onClick={async () => {
          if (!(await send.run())) return;
          setCooling(true);
          toast(
            "テスト通知を送りました。オンにした経路に届きます（Slack・メールは少し遅れることがあります）",
          );
        }}
      >
        <M3eIcon slot="icon" name="send" />
        テスト通知を送る
      </M3eButton>
    </div>
  );
}

/**
 * アカウントの「通知の設定」（利用者指示 2026-10-17「通知の設定もプロフィールの方にやりたい」・2026-10-28。§61・§103）。
 * 上から、この端末への通知（Web Push）のスイッチ、外への届け先（Nogiku のメールアドレス・Slack（DM））、「テスト通知を送る」、
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
        {settings ? <TestNotificationButton /> : null}
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
