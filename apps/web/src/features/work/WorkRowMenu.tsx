import { useState } from "react";
import { ActionSheet, type ActionSheetItem } from "@/ui/ActionSheet";
import { M3eIcon } from "@m3e/react/icon";
import { M3eIconButton } from "@m3e/react/icon-button";
import { M3eMenu, M3eMenuItem, M3eMenuTrigger } from "@m3e/react/menu";

export interface WorkRowMenuWork {
  id: string;
  title: string;
  /** 情報を編集できるか（listMine の canEdit: 主管） */
  canEdit: boolean;
}

/**
 * 制作物一覧の行の「⋮」（利用者 QA 2026-10-24: 「制作物の画面の表から、三点リーダーとかを設置して変更できるようにしたい」
 * 「コピーも同じメニューの中に」）。M3 の補助的な選択: medium 以上は `m3e-menu`、compact はボトムシート（ActionSheet。docs/UI_M3E.md #4）。
 * 項目は、できることだけ出す（編集は主管、複製は登録の権限のある人）。どちらも無い行には「⋮」自体を出さない。
 */
export function WorkRowMenu({
  w,
  canDuplicate,
  compact,
  onEdit,
  onDuplicate,
}: {
  w: WorkRowMenuWork;
  canDuplicate: boolean;
  compact: boolean;
  onEdit: () => void;
  onDuplicate: () => void;
}) {
  const [sheet, setSheet] = useState(false);
  const items: ActionSheetItem[] = [
    ...(w.canEdit ? [{ icon: "edit", label: "情報を編集", onSelect: onEdit }] : []),
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
