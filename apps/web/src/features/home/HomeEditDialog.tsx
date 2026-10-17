import { api } from "@mf100/convex/api";
import {
  dashboardWidgetColumn,
  moveDashboardWidgetAmong,
  updateDashboardWidget,
  type DashboardWidgetPref,
} from "@mf100/domain";
import { useMutation } from "convex/react";
import { useEffect, useState } from "react";
import { toast } from "@/lib/toast";
import { useAction } from "@/lib/useAction";
import {
  M3eButton,
  M3eDialog,
  M3eHeading,
  M3eIcon,
  M3eIconButton,
  M3eList,
  M3eListItem,
  M3eSwitch,
} from "@/ui/m3e";
import { widgetInfo } from "./widgets";

const COLUMNS = [
  { key: "todo", title: "やること" },
  { key: "side", title: "予定と記録" },
] as const;

/**
 * 「ホームを編集」（§36 W-26 段階 2）。全画面のダイアログで、節ごとに表示のスイッチと上下のボタン。
 * ドラッグは使わない（WCAG 2.5.7。M3E に並べ替えの部品が無い）。保存はアカウントごと（PC とスマホで共通）。
 * 並びは「やること」「予定と記録」の中で動かす（広い画面の 2 列の左右に当たる。スマホでは上から順に出る）。
 */
export function HomeEditDialog({
  open,
  onClose,
  layout,
  customized,
  counts,
}: {
  open: boolean;
  onClose: () => void;
  layout: DashboardWidgetPref[];
  customized: boolean;
  /** 節ごとのいまの件数（空の節は出ないことを添える） */
  counts: Record<string, number>;
}) {
  const save = useMutation(api.home.saveLayout);
  const reset = useMutation(api.home.resetLayout);
  const [draft, setDraft] = useState(layout);
  useEffect(() => {
    if (open) setDraft(layout);
  }, [open]);
  const doSave = useAction(async () => {
    await save({ widgets: draft.map(({ id, visible, limit }) => ({ id, visible, limit })) });
    toast("ホームの表示を保存しました");
    onClose();
  });
  const doReset = useAction(async () => {
    await reset({});
    toast("ホームの表示を既定（役割で自動）に戻しました");
    onClose();
  });

  return (
    <M3eDialog
      open={open}
      onClosed={onClose}
      closeLabel="閉じる"
      className="dialog--full home-edit"
    >
      <span slot="header">ホームを編集</span>
      <div className="dialog-body">
        <p className="small muted">
          節ごとに表示するかを切り替え、上下のボタンで並べ替えます。中身が無い節は、表示にしていても出ません。
        </p>
        {COLUMNS.map((col) => {
          const peers = draft.filter((w) => dashboardWidgetColumn[w.id] === col.key);
          return (
            <section key={col.key} className="home-edit__group">
              <M3eHeading variant="title" size="small" level={2}>
                {col.title}
              </M3eHeading>
              <M3eList className="list" aria-label={col.title}>
                {peers.map((w, i) => {
                  const info = widgetInfo[w.id];
                  const move = (dir: -1 | 1) =>
                    setDraft((d) =>
                      moveDashboardWidgetAmong(
                        d,
                        w.id,
                        dir,
                        (x) => dashboardWidgetColumn[x.id] === col.key,
                      ),
                    );
                  return (
                    <M3eListItem key={w.id} className="list__item home-edit__item">
                      <M3eSwitch
                        slot="leading"
                        checked={w.visible}
                        icons="selected"
                        aria-label={`「${info.title}」を表示する`}
                        onChange={(e) => {
                          const on = (e.target as HTMLElement & { checked: boolean }).checked;
                          setDraft((d) => updateDashboardWidget(d, w.id, { visible: on }));
                        }}
                      />
                      <span className="list__headline">{info.title}</span>
                      <span slot="supporting-text">
                        {info.description}・いま {counts[w.id] ?? 0} 件
                      </span>
                      <span slot="trailing" className="home-edit__moves">
                        <M3eIconButton
                          aria-label={`「${info.title}」を上へ`}
                          disabled={i === 0}
                          onClick={() => move(-1)}
                        >
                          <M3eIcon name="arrow_upward" />
                        </M3eIconButton>
                        <M3eIconButton
                          aria-label={`「${info.title}」を下へ`}
                          disabled={i === peers.length - 1}
                          onClick={() => move(1)}
                        >
                          <M3eIcon name="arrow_downward" />
                        </M3eIconButton>
                      </span>
                    </M3eListItem>
                  );
                })}
              </M3eList>
            </section>
          );
        })}
      </div>
      <div slot="actions" className="row">
        {customized ? (
          <M3eButton variant="text" disabled={doReset.pending} onClick={() => void doReset.run()}>
            既定に戻す
          </M3eButton>
        ) : null}
        <span className="spacer" />
        <M3eButton variant="text" onClick={onClose}>
          キャンセル
        </M3eButton>
        <M3eButton variant="filled" disabled={doSave.pending} onClick={() => void doSave.run()}>
          保存する
        </M3eButton>
      </div>
    </M3eDialog>
  );
}
