import { M3eDialog } from "@/ui/LazyDialog";
import { M3eButton } from "@m3e/react/button";
import { PushSetting } from "./PushSetting";

/**
 * アカウントの「通知の設定」（利用者指示 2026-10-17「通知の設定もプロフィールの方にやりたい」）。
 * この端末への通知（Web Push）のスイッチと説明を置く小さなダイアログ。compact は全画面、それ以上は普通のダイアログ
 * （M3 Dialogs › Full-screen dialog。`dialog--full` に `dialog--narrow` を重ね、広い画面では幅 560 に抑える）。
 * 出すかどうかは呼び出し側（`usePushAvailable`）が決める。初めて開くまで読み込まない（`_app` の `lazy`）
 */
export function PushSettingDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <M3eDialog
      open={open}
      onClosed={onClose}
      closeLabel="閉じる"
      className="dialog--full dialog--narrow push-dialog"
    >
      <span slot="header">通知の設定</span>
      <div className="dialog-body">
        <p className="small muted">
          コメントやメンション、締切の知らせを、この端末に届けるかを選びます。端末ごとの設定です。
        </p>
        <PushSetting />
      </div>
      <div slot="actions" className="row">
        <M3eButton variant="text" onClick={onClose}>
          閉じる
        </M3eButton>
      </div>
    </M3eDialog>
  );
}
