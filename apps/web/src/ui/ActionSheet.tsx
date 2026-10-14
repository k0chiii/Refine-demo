import { useEffect, useRef, type ReactNode } from "react";
import { M3eActionList, M3eBottomSheet, M3eIcon, M3eListAction } from "@/ui/m3e";

export interface ActionSheetItem {
  icon: string;
  label: ReactNode;
  onSelect: () => void;
  selected?: boolean;
}

/**
 * compact の「補助的な選択」（M3 Breakpoints: compact は Bottom sheet、medium 以上は Menu）。
 * モーダルのボトムシート。外側を押す・下へ払う・項目を押すと閉じる。
 */
export function ActionSheet({
  open,
  onClose,
  title,
  items,
}: {
  open: boolean;
  onClose: () => void;
  title?: string;
  items: ActionSheetItem[];
}) {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    const el = ref.current as
      | (HTMLElement & { show?: (d?: number) => void; hide?: () => void })
      | null;
    if (!el) return;
    el.setAttribute("detents", "fit full");
    if (open) {
      const id = requestAnimationFrame(() => el.show?.(0));
      return () => cancelAnimationFrame(id);
    }
    el.hide?.();
    return;
  }, [open]);
  return (
    <M3eBottomSheet
      ref={ref as never}
      modal
      hideable
      handle
      handleLabel={title ?? "操作"}
      className="action-sheet"
      onClosed={onClose}
      onClick={(e) => e.stopPropagation()}
    >
      {title ? (
        <div slot="header" className="action-sheet__header">
          <span className="title-small">{title}</span>
        </div>
      ) : null}
      <M3eActionList className="list action-sheet__list" aria-label={title ?? "操作"}>
        {items.map((it, i) => (
          <M3eListAction
            key={i}
            className="list__item"
            onClick={() => {
              onClose();
              it.onSelect();
            }}
          >
            <M3eIcon slot="leading" name={it.selected ? "check" : it.icon} />
            <span className="list__headline">{it.label}</span>
          </M3eListAction>
        ))}
      </M3eActionList>
    </M3eBottomSheet>
  );
}
