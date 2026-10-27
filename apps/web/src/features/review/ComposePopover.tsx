import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal, flushSync } from "react-dom";
import { portalHost } from "@/lib/portalHost";
import {
  expectedKeyboardHeight,
  useRestorePageScroll,
  useVisualBottom,
} from "@/lib/useKeyboardInset";
import { M3eIcon } from "@m3e/react/icon";
import { useComposeState, type ComposeStore } from "./composeStore";
import { AttachDropZone, AttachFileButton } from "./AttachFileButton";
import { PendingCommentFiles } from "./PendingCommentFiles";
import { RichCommentField, type RichCommentHandle } from "./RichCommentField";
import { useCommentFileUploads } from "./useCommentFileUploads";

/**
 * 書きかけを ComposeStore に置く投稿欄。打つたびに描き直されるのはこの部品だけで、親（Editor）は描き直されない。
 * 本文・メンション以外の props は ComposePopover と同じ。
 */
export function StoredComposePopover({
  store,
  ...rest
}: { store: ComposeStore } & Omit<
  Parameters<typeof ComposePopover>[0],
  "value" | "onChange" | "onMentions"
>) {
  const { body } = useComposeState(store);
  return (
    <ComposePopover
      {...rest}
      value={body}
      onChange={store.setBody}
      onMentions={store.setMentions}
    />
  );
}

/**
 * 投稿欄を置く場所。
 * - anchored: 選んだ場所のそばに浮かべる（中間幅のビューア・SNS 投稿のプレビュー）
 * - docked: 画面下（キーボードが出ていればそのすぐ上）に全幅で固定する（compact でシートが開いていないとき）。
 *   小さい画面では位置のそばの欄がキーボードや指に隠れるため
 * - embedded: 枠の中に静的に置く。host があればそこ（スマホの開いているシートの下。利用者指示 2026-10-20「ボトムシート？が出てる状態の時は
 *   そうじゃなくて埋め込みだといいのかも」）へ portal し、無ければその場（広い画面の引き出し「コメント」の下）
 */
export type ComposePlacement =
  | { kind: "anchored"; x: number; y: number }
  | { kind: "docked" }
  | { kind: "embedded"; host?: HTMLElement };

/**
 * コメントの投稿欄（Google ドキュメント / Figma の「コメントを追加」）。位置を選んだ瞬間に出る。
 * Enter（Ctrl/⌘）で投稿、Escape で取消。「@」で制作物を見られる人をメンションできる。
 * 本文は書式つきの入力欄（Markdown。太字・リスト・引用・コード・リンク。RichCommentField）。
 *
 * anchored の欄が見えている範囲（ビューアのスクロール枠・画面）や浮遊ツールバーからはみ出しそうなら、内側へずらす
 * （利用者指示 2026-10-16「はみ出そうならスライドする形で調整」）。紙面を拡大して横にスクロールしているときも、
 * スクロールに合わせて追いかける。縦は欄の高さまでしかずらさない（選んだ場所が遠く離れたら一緒に流れていく）
 */
export function ComposePopover({
  placement,
  value,
  onChange,
  onMentions,
  onSubmit,
  onCancel,
  pending,
  revisionId,
  label = "コメント",
  extra,
  quote,
  place,
  autoFocus = true,
}: {
  placement: ComposePlacement;
  value: string;
  onChange: (v: string) => void;
  onMentions: (ids: string[]) => void;
  /** 投稿する。添付は検証済みになったものの ID（添付が無ければ空） */
  onSubmit: (fileIds: string[]) => void;
  onCancel: () => void;
  pending?: boolean;
  /** コメントを付ける版。あれば添付できる */
  revisionId?: string;
  label?: string;
  /** 投稿以外の操作（例: 選んだ文字を表記ルールに提案） */
  extra?: ReactNode;
  /** 何に対するコメントかを示す引用（選んだ文字など）。anchored では出さない（すぐそばに選んだ文字がある） */
  quote?: string;
  /** 何に対するコメントか（動画の時刻「0:03–0:06」など）。どの置き方でも出す。アイコンは種類によらず地図のピン */
  place?: string;
  /** 開いたとき文字欄にカーソルを移すか。移さないと、選んだ文字（紙面の選択）をそのままコピーできる */
  autoFocus?: boolean;
}) {
  const what = label;
  const uploads = useCommentFileUploads({ revisionId: revisionId ?? "", purpose: "comment" });
  const canAttach = revisionId !== undefined;
  // 本文が空でも添付があれば投稿できる。圧縮・送信の途中、失敗が残っているあいだは投稿させない
  const hasContent = value.trim() !== "" || (canAttach && uploads.fileIds.length > 0);
  const canSend = hasContent && !(canAttach && (uploads.busy || uploads.hasError));
  const send = () => {
    if (canSend && !pending) onSubmit(canAttach ? uploads.fileIds : []);
  };
  const richRef = useRef<RichCommentHandle>(null);
  const embedded = placement.kind === "embedded";
  const floating = placement.kind === "docked";
  const at = placement.kind === "anchored" ? placement : null;
  const panelRef = useRef<HTMLDivElement>(null);
  // 画面下の欄は見えている範囲の下端に置く（キーボードの上・iOS のずらしに追従）。閉じたらページの位置を戻す
  const vb = useVisualBottom(panelRef, floating);
  useRestorePageScroll(floating);
  // 本文にフォーカスが入った瞬間（キーボードが出る前）に、欄をキーボードの見込みの高さより上へ上げておく。
  // 下のままだと iOS が欄を見せようと画面ごと上へずらし、選んだ範囲（紙面）まで動く（利用者指示 2026-10-21
  // 「範囲選択した箇所が動かないようにしたい」）。キーボードが出たら、見えている範囲の下端の位置に戻す
  const [raise, setRaise] = useState(false);
  // 指で本文を押した時刻。指で押してフォーカスが入ったときだけ上げる（開いたときの自動のフォーカスでは上げない）
  const touchedAt = useRef(0);
  // 指の画面では、浮かぶ欄を開いたときに自動でフォーカスしない（iOS はキーボードを出さず、次に押してもフォーカスの出入りが無い）
  const coarse =
    typeof window !== "undefined" && window.matchMedia?.("(pointer: coarse)").matches === true;
  const kbOpen = useRef(vb.open);
  kbOpen.current = vb.open;
  useEffect(() => {
    if (vb.open) setRaise(false);
  }, [vb.open]);
  useEffect(() => {
    if (!raise) return;
    // キーボードが出なかった（押しただけ・ボタンだった）ら戻す
    const t = window.setTimeout(() => {
      if (!kbOpen.current) setRaise(false);
    }, 1500);
    return () => window.clearTimeout(t);
  }, [raise]);
  const shift = useFitInside(panelRef, at !== null, at?.x ?? 0, at?.y ?? 0);
  useEffect(() => {
    // 開いたときのフォーカスの元（ボタンや紙面）を覚え、閉じたらそこへ戻す（body に落とさない。§35 A-04）
    const opener = document.activeElement as HTMLElement | null;
    // 書式つきの欄は読み込みが済んでから自分でフォーカスする（autoFocus）
    return () => {
      const now = document.activeElement;
      if ((!now || now === document.body) && opener?.isConnected)
        opener.focus({ preventScroll: true });
    };
  }, []);
  const panel = (
    <div
      ref={panelRef}
      className={`compose-pop ${embedded ? "compose-pop--embedded" : floating ? "compose-pop--docked" : ""}`}
      role="dialog"
      aria-label={what}
      style={
        at
          ? {
              left: at.x,
              top: at.y,
              ...(shift.x || shift.y ? { translate: `${shift.x}px ${shift.y}px` } : {}),
            }
          : floating
            ? // 見えている範囲の下端から 8px 上。キーボードが出ていなければ下のセーフエリアも空ける
              vb.top === null
              ? { bottom: "calc(8px + env(safe-area-inset-bottom, 0px))" }
              : {
                  top: vb.open
                    ? vb.top - 8
                    : raise
                      ? vb.top - expectedKeyboardHeight() - 8
                      : `calc(${vb.top - 8}px - env(safe-area-inset-bottom, 0px))`,
                }
            : undefined
      }
      onPointerDown={(e) => e.stopPropagation()}
      // 本文にフォーカスが入った瞬間（キーボードが出る前）に欄を上げる。押した指の操作には手を出さない
      // （ブラウザのフォーカスを止めて自分でフォーカスすると、iOS はキーボードを出さない。2026-10-21 利用者指摘）。
      // 押した瞬間に上げると、離した位置が紙面になってフォーカスが紙面へ行く
      onTouchStartCapture={(e) => {
        if ((e.target as Element).closest(".rt__content")) touchedAt.current = Date.now();
      }}
      onFocusCapture={(e) => {
        if (
          floating &&
          !vb.open &&
          Date.now() - touchedAt.current < 1000 &&
          (e.target as Element).closest(".rt__content")
        )
          flushSync(() => setRaise(true));
      }}
      onClick={(e) => e.stopPropagation()}
    >
      {!at && quote ? <div className="compose-pop__quote">「{quote}」</div> : null}
      {place ? (
        <div className="compose-pop__place">
          <M3eIcon name="location_on" />
          {place}
        </div>
      ) : null}
      <AttachDropZone uploads={uploads} enabled={canAttach} className="compose-pop__drop">
        <RichCommentField
          ref={richRef}
          ariaLabel={what}
          // 改善の提案には理由も添えてもらう（必須にはせず案内だけ。利用者決定 2026-10-15 A-5）
          placeholder="改善案には理由も添えて"
          rows={2}
          autoFocus={autoFocus && !(floating && coarse)}
          value={value}
          onValue={onChange}
          onMentions={onMentions}
          // Esc は書いた文字を消さない（§35 I-07）。空なら取消、書きかけならフォーカスを外すだけ
          onEscape={() => {
            if (hasContent || uploads.items.length > 0) richRef.current?.blur();
            else onCancel();
          }}
          onSubmit={send}
          onCancel={onCancel}
          attach={canAttach ? <AttachFileButton uploads={uploads} /> : null}
          attachments={canAttach ? <PendingCommentFiles uploads={uploads} /> : null}
          extra={extra}
          send={{
            label: "投稿",
            ready: hasContent,
            disabled: pending === true || !canSend,
            onSend: send,
          }}
        />
      </AttachDropZone>
    </div>
  );
  if (placement.kind === "embedded")
    return placement.host ? createPortal(panel, placement.host) : panel;
  // docked は画面に固定する。スクロールや変形する親の中だと位置がずれるので body に出す（要素の全画面の間はその要素の中）
  return floating ? createPortal(panel, portalHost()) : panel;
}

/** スクロールする一番近い親（無ければ null = 画面） */
function scrollParent(el: HTMLElement): HTMLElement | null {
  for (let p = el.parentElement; p; p = p.parentElement) {
    const st = getComputedStyle(p);
    if (
      /(auto|scroll)/.test(st.overflowX + st.overflowY) &&
      (p.scrollWidth > p.clientWidth || p.scrollHeight > p.clientHeight)
    )
      return p;
  }
  return null;
}

const GAP = 8;

/**
 * 欄を、見えている範囲（スクロール枠と画面の重なり）と浮遊ツールバー（下の .ws__toolbar・右の縦の .ws__side-toolbar）の
 * 内側に収めるためのずらし量。
 * 置いた位置（x, y）が変わるたびと、スクロール・画面の大きさ・欄の大きさが変わるたびに測り直す
 */
function useFitInside(
  ref: React.RefObject<HTMLDivElement | null>,
  enabled: boolean,
  x: number,
  y: number,
) {
  const [shift, setShift] = useState({ x: 0, y: 0 });
  const current = useRef(shift);
  current.current = shift;
  useLayoutEffect(() => {
    const el = ref.current;
    if (!enabled || !el) return;
    const parent = scrollParent(el);
    const fit = () => {
      const r = el.getBoundingClientRect();
      // いまのずらしを除いた、本来の位置
      const base = {
        left: r.left - current.current.x,
        right: r.right - current.current.x,
        top: r.top - current.current.y,
        bottom: r.bottom - current.current.y,
      };
      const area = parent?.getBoundingClientRect();
      let left = Math.max(area?.left ?? 0, 0) + GAP;
      let right = Math.min(area?.right ?? window.innerWidth, window.innerWidth) - GAP;
      // 面の上に浮かぶ書式のツールバーのぶんも空ける
      const above = el.querySelector<HTMLElement>(".rt-wrap > .rt__toolbar")?.offsetHeight ?? 0;
      const top = Math.max(area?.top ?? 0, 0) + GAP + (above ? above + GAP : 0);
      let bottom = Math.min(area?.bottom ?? window.innerHeight, window.innerHeight) - GAP;
      // 浮遊ツールバー: 縦長（右の縦のツールバー）は左へ、横長（下のツールバー）は上へよける
      const mid = { x: (left + right) / 2, y: (top + bottom) / 2 };
      for (const t of document.querySelectorAll<HTMLElement>(".ws__toolbar, .ws__side-toolbar")) {
        const tr = t.getBoundingClientRect();
        if (tr.width === 0 || tr.height === 0) continue;
        // 引き出しが開いているあいだ隠している縦のツールバーは、よけなくてよい
        if (getComputedStyle(t).visibility === "hidden") continue;
        const overlapsV = tr.top < base.bottom && tr.bottom > base.top;
        const overlapsH = tr.left < base.right && tr.right > base.left;
        if (tr.height > tr.width && tr.left > mid.x && overlapsV)
          right = Math.min(right, tr.left - GAP);
        else if (tr.width >= tr.height && tr.top > mid.y && overlapsH)
          bottom = Math.min(bottom, tr.top - GAP);
        else if (tr.height > tr.width && tr.right < mid.x && overlapsV)
          left = Math.max(left, tr.right + GAP);
      }
      let dx = 0;
      if (base.right > right) dx = right - base.right;
      if (base.left + dx < left) dx = left - base.left;
      let dy = 0;
      if (base.bottom > bottom) dy = bottom - base.bottom;
      if (base.top + dy < top) dy = top - base.top;
      // 縦は欄の高さまで（選んだ場所から離れすぎない）
      const h = base.bottom - base.top;
      dy = Math.max(-h, Math.min(h, dy));
      if (dx !== current.current.x || dy !== current.current.y) setShift({ x: dx, y: dy });
    };
    fit();
    const target: HTMLElement | Window = parent ?? window;
    target.addEventListener("scroll", fit, { passive: true });
    window.addEventListener("resize", fit);
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => {
      target.removeEventListener("scroll", fit);
      window.removeEventListener("resize", fit);
      ro.disconnect();
    };
  }, [enabled, x, y]);
  return enabled ? shift : { x: 0, y: 0 };
}
