import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { M3eBottomSheet } from "@m3e/react/bottom-sheet";
import { M3eIcon } from "@m3e/react/icon";
import { M3eActionList, M3eListAction } from "@m3e/react/list";

export interface ActionSheetItem {
  icon: string;
  label: ReactNode;
  onSelect: () => void;
  selected?: boolean;
  /** 2 行目（補助テキスト） */
  supporting?: ReactNode;
  disabled?: boolean;
}

type SheetElement = HTMLElement & {
  show?: (d?: number) => void;
  hide?: () => void;
  open?: boolean;
};
/** M3eBottomSheet は「同時に開くシートは 1 つ」を静的フィールドで持つ（開くと前のシートを hide する） */
type SheetClass = { __openSheet?: SheetElement | undefined };

/**
 * シートが閉じきってから（モーダルの inert が戻ってから）選ばれた操作を行う。
 * 閉じる途中に開いたダイアログなどは、まだ inert の祖先の中で開くことになり、閉じる側の解除と入れ違うため。
 * 閉じきらなくても 600ms で行う（見えないシートに操作を取られない）。
 */
function afterHidden(el: HTMLElement | null, run: () => void): void {
  const until = performance.now() + 600;
  const tick = () => {
    if (!el || !el.matches(":popover-open") || performance.now() > until) run();
    else requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

/**
 * compact の「補助的な選択」（M3 Breakpoints: compact は Bottom sheet、medium 以上は Menu）。
 * モーダルのボトムシート。外側を押す・下へ払う・項目を押すと閉じる。
 *
 * - 本文（document.body）直下へポータルで出す。モーダルのシートは開くと自分の祖先を根まで辿って兄弟を inert にする
 *   （InertController）ため、引き出しなど別のシートの中に置くと、引き出し自身とその外側が inert のまま固まる
 *   （利用者報告「コメントの操作のシートで何も操作ができなくなってしまう」。docs/UI_M3E.md）。
 * - 開くとき、すでに開いている別のシート（エディタの引き出し）を閉じさせない。閉じた引き出しは inert になり、
 *   その中の返信欄・ダイアログが操作できなくなるため。モーダルが上に重なるだけにして、閉じたら元のまま残す。
 */
export function ActionSheet({
  open,
  onClose,
  title,
  items,
  empty,
}: {
  open: boolean;
  onClose: () => void;
  title?: string;
  items: ActionSheetItem[];
  /** 項目が無いときに出す内容（M3 の空状態） */
  empty?: ReactNode;
}) {
  const ref = useRef<SheetElement>(null);
  /** このシートを開く直前に開いていた別のシート（閉じたら開いていたことにして戻す） */
  const under = useRef<SheetElement | undefined>(undefined);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.setAttribute("detents", "fit full");
    if (open) {
      const id = requestAnimationFrame(() => {
        // すでに開いている別のシート（エディタの引き出し）を閉じさせない
        const sheets = customElements.get("m3e-bottom-sheet") as unknown as SheetClass | undefined;
        if (sheets?.__openSheet && sheets.__openSheet !== el) {
          under.current = sheets.__openSheet;
          sheets.__openSheet = undefined;
        }
        el.show?.(0);
      });
      return () => cancelAnimationFrame(id);
    }
    el.hide?.();
    return;
  }, [open]);
  return createPortal(
    <M3eBottomSheet
      ref={ref as never}
      modal
      hideable
      handle
      handleLabel={title ?? "操作"}
      className="action-sheet"
      onClosed={() => {
        const sheets = customElements.get("m3e-bottom-sheet") as unknown as SheetClass | undefined;
        const prev = under.current;
        under.current = undefined;
        if (sheets && prev?.open && !sheets.__openSheet) sheets.__openSheet = prev;
        onClose();
      }}
      // React のポータルは合成イベントを React 上の親へも伝える（カードの onClick を動かさない）
      onClick={(e) => e.stopPropagation()}
    >
      {title ? (
        <div slot="header" className="action-sheet__header">
          <span className="title-small">{title}</span>
        </div>
      ) : null}
      <div className="action-sheet__body">
        {items.length === 0 && empty ? (
          <div className="action-sheet__empty">{empty}</div>
        ) : (
          <M3eActionList className="list action-sheet__list" aria-label={title ?? "操作"}>
            {items.map((it, i) => (
              <M3eListAction
                key={i}
                className="list__item"
                disabled={it.disabled === true}
                onClick={() => {
                  onClose();
                  afterHidden(ref.current, it.onSelect);
                }}
              >
                <M3eIcon slot="leading" name={it.selected ? "check" : it.icon} />
                <span className="list__headline">{it.label}</span>
                {it.supporting ? <span slot="supporting-text">{it.supporting}</span> : null}
              </M3eListAction>
            ))}
          </M3eActionList>
        )}
      </div>
    </M3eBottomSheet>,
    document.body,
  );
}
