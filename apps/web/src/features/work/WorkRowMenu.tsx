import { useState } from "react";
import { lifecycleActionLabel } from "@/lib/labels";
import { ActionSheet, type ActionSheetItem } from "@/ui/ActionSheet";
import { M3eIcon } from "@m3e/react/icon";
import { M3eIconButton } from "@m3e/react/icon-button";
import { M3eMenu, M3eMenuItem, M3eMenuTrigger } from "@m3e/react/menu";

export interface WorkRowMenuWork {
  id: string;
  title: string;
  /** 情報を編集できるか（listMine の canEdit: 主管） */
  canEdit: boolean;
  /** 制作者だけを変えられるか（listMine の canTransferCreators） */
  canTransferCreators?: boolean;
  /** 進行中・中止・校了など（中止・進行中に戻すの項目を出し分ける） */
  lifecycle?: string;
  /** 中止できるか（listMine の canCancel: 統括・校了者・管理者） */
  canCancel?: boolean;
}

/**
 * 行メニューから変えられる状態（情報タブからは変えない。利用者指示 2026-11-05）。
 * 保留は使わない（同日「保留はいらない」）。前から保留・下書きの制作物だけ「進行中に戻す」を出す
 */
export type RowLifecycleTarget = "active" | "cancelled";

export function rowLifecycleTargets(lifecycle: string | undefined): RowLifecycleTarget[] {
  if (lifecycle === "active") return ["cancelled"];
  if (lifecycle === "on_hold" || lifecycle === "draft") return ["active", "cancelled"];
  return [];
}

const lifecycleIcon: Record<RowLifecycleTarget, string> = {
  active: "play_arrow",
  cancelled: "block",
};

/**
 * 制作物一覧の行の「⋮」（利用者 QA 2026-10-24: 「制作物の画面の表から、三点リーダーとかを設置して変更できるようにしたい」
 * 「コピーも同じメニューの中に」）。M3 の補助的な選択: medium 以上は `m3e-menu`、compact はボトムシート（ActionSheet。docs/UI_M3E.md #4）。
 * 項目は、できることだけ出す（編集は統括、中止は統括・校了者、複製は登録の権限のある人）。どれも無い行には「⋮」自体を出さない。
 * 制作物の情報・状態を変えるのはここと登録だけ（校正画面の「情報」からは変えない。利用者指示 2026-11-05）。
 */
export function WorkRowMenu({
  w,
  canDuplicate,
  compact,
  onEdit,
  onTransferCreators,
  onDuplicate,
  onLifecycle,
}: {
  w: WorkRowMenuWork;
  canDuplicate: boolean;
  compact: boolean;
  onEdit: () => void;
  onTransferCreators: () => void;
  onDuplicate: () => void;
  /** 進行中に戻す・中止する（中止は親が確認してから） */
  onLifecycle?: (to: RowLifecycleTarget) => void;
}) {
  const [sheet, setSheet] = useState(false);
  const items: ActionSheetItem[] = [
    ...(w.canEdit ? [{ icon: "edit", label: "情報を編集", onSelect: onEdit }] : []),
    ...(w.canTransferCreators
      ? [{ icon: "group", label: "制作者を変更", onSelect: onTransferCreators }]
      : []),
    ...(onLifecycle
      ? rowLifecycleTargets(w.lifecycle)
          // 進行中に戻すは編集できる人（統括・管理者）、中止は統括・校了者・管理者
          .filter((to) => (to === "cancelled" ? w.canCancel : w.canEdit))
          .map((to) => ({
            icon: lifecycleIcon[to],
            label: lifecycleActionLabel[to],
            onSelect: () => onLifecycle(to),
          }))
      : []),
    ...(canDuplicate
      ? [
          {
            icon: "content_copy",
            label: "複製",
            supporting: "同じ情報で新しい制作物を登録します",
            onSelect: onDuplicate,
          },
        ]
      : []),
  ];
  if (items.length === 0) return null;
  const menuId = `work-menu-${w.id}`;
  const label = `${w.title} の操作`;
  return (
    <>
      <M3eIconButton
        className="works-table__more"
        aria-label={label}
        title="操作"
        {...(compact ? { onClick: () => setSheet(true) } : {})}
      >
        <M3eIcon name="more_vert" />
        {compact ? null : <M3eMenuTrigger htmlFor={menuId} />}
      </M3eIconButton>
      {compact ? (
        <ActionSheet open={sheet} onClose={() => setSheet(false)} title={w.title} items={items} />
      ) : (
        <M3eMenu id={menuId} positionX="before" className="works-table__menu">
          {items.map((it) => (
            <M3eMenuItem key={it.icon} onClick={it.onSelect}>
              <M3eIcon slot="icon" name={it.icon} />
              {it.label}
            </M3eMenuItem>
          ))}
        </M3eMenu>
      )}
    </>
  );
}
