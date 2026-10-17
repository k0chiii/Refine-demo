import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { formatJstShort } from "@/lib/format";
import { reviewStateLabel } from "@/lib/labels";
import { M3eBottomSheet } from "@m3e/react/bottom-sheet";
import { M3eDivider } from "@m3e/react/divider";
import { M3eIcon } from "@m3e/react/icon";
import { M3eIconButton } from "@m3e/react/icon-button";
import { M3eActionList, M3eListAction } from "@m3e/react/list";
import { M3eMenu, M3eMenuItem, M3eMenuItemGroup, M3eMenuTrigger } from "@m3e/react/menu";

/** 選ぶ候補にする版（制作物の版の一覧の 1 行） */
export interface CompareRevision {
  id: string;
  label: string;
  reviewState: string;
  submittedAt: number;
  submitter?: { name?: string | null } | null | undefined;
}

type SheetElement = HTMLElement & { show?: (d?: number) => void; hide?: () => void };

/**
 * シートが閉じきってから（モーダルの inert が戻ってから）選ばれた操作を行う。閉じる途中に開いたダイアログは、
 * まだ inert の祖先の中で開くことになり、閉じる側の解除と入れ違うため。閉じきらなくても 600ms で行う。
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
 * エディタのトップアプリバーの「比べる」（利用者指示 2026-10-17「比べるボタンを作り、それを右上の方、スマホだとピンの横に置けない？
 * そこから何と比べるのかを選びたい。今の制作物の昔の版と、任意の制作物（検索）みたいな感じです」）。比べる入口はここ 1 つ。
 * - 押すと「何と比べるか」を選ぶ。広い画面は M3 の Menu、compact は Bottom sheet（M3 Breakpoints: 補助的な選択）
 *   - 「この制作物の版」: 表示中の版以外の、無効でない版（新しい順）。選ぶと同じ制作物の版と比べる
 *   - 「ほかの制作物」: 制作物を検索して選び、その版を選ぶ（CrossWorkPicker。閲覧権限のある制作物だけ）
 * - 比べている間はボタンが toggle の選択状態で、メニューの先頭に「比べるのをやめる」を出す
 */
export function CompareButton({
  revisions,
  currentId,
  compareWith,
  target,
  compact,
  onCompareRevision,
  onPickOther,
  onStop,
}: {
  revisions: readonly CompareRevision[];
  currentId: string | null;
  /** 比べている相手の版（無ければ比べていない） */
  compareWith: string | null;
  /** 比べている相手の表示（同じ制作物なら版名、別の制作物なら「題名・版」） */
  target: string | null;
  compact: boolean;
  /** この制作物の別の版と比べる */
  onCompareRevision: (id: string) => void;
  /** ほかの制作物を検索して比べる（相手を選ぶダイアログを開く） */
  onPickOther: () => void;
  onStop: () => void;
}) {
  const comparing = compareWith !== null;
  const [sheet, setSheet] = useState(false);
  const sheetRef = useRef<SheetElement>(null);
  useEffect(() => {
    const el = sheetRef.current;
    if (!el) return;
    el.setAttribute("detents", "fit full");
    if (sheet) {
      const id = requestAnimationFrame(() => el.show?.(0));
      return () => cancelAnimationFrame(id);
    }
    el.hide?.();
    return;
  }, [sheet]);

  const choices = revisions
    .filter((r) => r.id !== currentId && r.reviewState !== "void")
    .sort((a, b) => b.submittedAt - a.submittedAt);
  const detail = (r: CompareRevision) =>
    [
      reviewStateLabel[r.reviewState] ?? r.reviewState,
      r.submitter?.name,
      formatJstShort(r.submittedAt),
    ]
      .filter(Boolean)
      .join("・");
  const label = comparing ? "比べる（比較中）" : "比べる";

  const button = (
    <M3eIconButton
      aria-label={label}
      title={label}
      toggle
      selected={comparing}
      {...(compact ? { onClick: () => setSheet(true) } : {})}
    >
      <M3eIcon name="compare" />
      <M3eIcon slot="selected" name="compare" className="icon--filled" />
      {compact ? null : <M3eMenuTrigger htmlFor="compare-menu" />}
    </M3eIconButton>
  );

  if (compact) {
    /** 選んだ操作は、シートを閉じてから行う */
    const pick = (run: () => void) => {
      setSheet(false);
      afterHidden(sheetRef.current, run);
    };
    // 本文（document.body）直下へ出す。モーダルのシートは開くと祖先を根まで辿って兄弟を inert にするため、アプリバーの中に置かない
    return (
      <>
        {button}
        {createPortal(
          <M3eBottomSheet
            ref={sheetRef as never}
            modal
            hideable
            handle
            handleLabel="比べる"
            className="action-sheet compare-sheet"
            onClosed={() => setSheet(false)}
          >
            <div slot="header" className="action-sheet__header">
              <span className="title-small">何と比べますか</span>
            </div>
            {comparing ? (
              <>
                <M3eActionList className="list action-sheet__list" aria-label="比較中">
                  <M3eListAction className="list__item" onClick={() => pick(onStop)}>
                    <M3eIcon slot="leading" name="close" />
                    <span className="list__headline">比べるのをやめる</span>
                    {target ? <span slot="supporting-text">比較中: {target}</span> : null}
                  </M3eListAction>
                </M3eActionList>
                <M3eDivider />
              </>
            ) : null}
            <div className="compare-sheet__label small muted">この制作物の版</div>
            {choices.length === 0 ? (
              <p className="small muted compare-sheet__empty">ほかの版はありません</p>
            ) : (
              <M3eActionList className="list action-sheet__list" aria-label="この制作物の版">
                {choices.map((r) => (
                  <M3eListAction
                    key={r.id}
                    className="list__item"
                    onClick={() => pick(() => onCompareRevision(r.id))}
                  >
                    <M3eIcon slot="leading" name={r.id === compareWith ? "check" : "history"} />
                    <span className="list__headline">{r.label}</span>
                    <span slot="supporting-text">{detail(r)}</span>
                  </M3eListAction>
                ))}
              </M3eActionList>
            )}
            <M3eDivider />
            <div className="compare-sheet__label small muted">ほかの制作物</div>
            <M3eActionList className="list action-sheet__list" aria-label="ほかの制作物">
              <M3eListAction className="list__item" onClick={() => pick(onPickOther)}>
                <M3eIcon slot="leading" name="search" />
                <span className="list__headline">制作物を探して比べる</span>
                <span slot="supporting-text">制作物を検索して、その版を選びます</span>
              </M3eListAction>
            </M3eActionList>
          </M3eBottomSheet>,
          document.body,
        )}
      </>
    );
  }

  const heading = (text: ReactNode) => (
    <div className="compare-menu__label" role="presentation">
      {text}
    </div>
  );
  return (
    <>
      {button}
      <M3eMenu id="compare-menu" className="compare-menu" positionX="before">
        {comparing ? (
          <>
            <M3eMenuItem onClick={onStop}>
              <M3eIcon slot="icon" name="close" />
              比べるのをやめる
            </M3eMenuItem>
            <M3eDivider />
          </>
        ) : null}
        {heading("この制作物の版")}
        {choices.length === 0 ? (
          heading(<span className="compare-menu__empty">ほかの版はありません</span>)
        ) : (
          <M3eMenuItemGroup aria-label="この制作物の版">
            {choices.map((r) => (
              <M3eMenuItem key={r.id} onClick={() => onCompareRevision(r.id)}>
                <M3eIcon slot="icon" name={r.id === compareWith ? "check" : "history"} />
                {r.label}
                <span slot="supporting-text">{detail(r)}</span>
              </M3eMenuItem>
            ))}
          </M3eMenuItemGroup>
        )}
        <M3eDivider />
        {heading("ほかの制作物")}
        <M3eMenuItem onClick={onPickOther}>
          <M3eIcon slot="icon" name="search" />
          制作物を探して比べる…
        </M3eMenuItem>
      </M3eMenu>
    </>
  );
}
