import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { useKeyboardInset } from "@/lib/useKeyboardInset";
import { M3eButton } from "@m3e/react/button";
import { M3eIcon } from "@m3e/react/icon";
import { M3eIconButton } from "@m3e/react/icon-button";
import { ChoiceGroup } from "@/ui/ChoiceGroup";
import { useComposeState, type ComposeStore } from "./composeStore";
import { MentionTextarea } from "./mentions";

/**
 * 書きかけを ComposeStore に置く投稿欄。打つたびに描き直されるのはこの部品だけで、親（Editor）は描き直されない。
 * 本文・メンション以外の props は ComposePopover と同じ。
 */
export function StoredComposePopover({
  store,
  ...rest
}: { store: ComposeStore } & Omit<
  Parameters<typeof ComposePopover>[0],
  "value" | "onChange" | "mentions" | "onMentions"
>) {
  const { body, mentions } = useComposeState(store);
  return (
    <ComposePopover
      {...rest}
      value={body}
      onChange={store.setBody}
      mentions={mentions}
      onMentions={store.setMentions}
    />
  );
}

/**
 * 範囲・ピンのそばに出る投稿欄（Google ドキュメント / Figma の「コメントを追加」）。
 * 位置を選んだ瞬間に出るので、モード切替やパネルへの移動が要らない。
 * Enter（Ctrl/⌘）で投稿、Escape で取消。「@」で制作物を見られる人をメンションできる。
 *
 * docked（compact）: 選んだ位置のそばではなく、画面下（キーボードが出ていればそのすぐ上）に全幅で出す。
 * 小さい画面では位置のそばの欄がキーボードや指に隠れるため。何に対するコメントかは引用で示す。
 *
 * そばに出す欄が見えている範囲（ビューアのスクロール枠・画面）や浮遊ツールバーからはみ出しそうなら、内側へずらす
 * （利用者指示 2026-10-16「はみ出そうならスライドする形で調整」）。紙面を拡大して横にスクロールしているときも、
 * スクロールに合わせて追いかける。縦は欄の高さまでしかずらさない（選んだ場所が遠く離れたら一緒に流れていく）
 */
export function ComposePopover({
  x,
  y,
  value,
  onChange,
  mentions,
  onMentions,
  onSubmit,
  onCancel,
  pending,
  label = "コメント",
  style,
  extra,
  docked,
  quote,
  place,
  placeIcon = "schedule",
  kind = "comment",
  onKind,
}: {
  x: number;
  y: number;
  value: string;
  onChange: (v: string) => void;
  mentions: readonly string[];
  onMentions: (ids: string[]) => void;
  onSubmit: () => void;
  onCancel: () => void;
  pending?: boolean;
  label?: string;
  style?: CSSProperties;
  /** 投稿以外の操作（例: 選んだ文字を表記ルールに提案） */
  extra?: ReactNode;
  docked?: boolean;
  /** docked のとき、何に対するコメントかを示す引用（選んだ文字など） */
  quote?: string;
  /** 何に対するコメントか（動画の時刻「0:03–0:06」など）。docked でなくても出す */
  place?: string;
  /** place のアイコン（既定は時計。Web の要素は ads_click、Figma のフレームは design_services） */
  placeIcon?: string;
  /** 書くもの: コメント（指摘して解決する）か FB（解決しない相談）。利用者決定 2026-10-15 */
  kind?: "comment" | "feedback";
  /** 渡すと「コメント／FB」を切り替えられる（コメントできない版では渡さず FB だけ） */
  onKind?: (k: "comment" | "feedback") => void;
}) {
  const fb = kind === "feedback";
  const what = fb ? "FB" : label;
  const ref = useRef<HTMLTextAreaElement>(null);
  const kb = useKeyboardInset(docked === true);
  const panelRef = useRef<HTMLDivElement>(null);
  const shift = useFitInside(panelRef, !docked, x, y);
  useEffect(() => {
    // 開いたときのフォーカスの元（ボタンや紙面）を覚え、閉じたらそこへ戻す（body に落とさない。§35 A-04）
    const opener = document.activeElement as HTMLElement | null;
    ref.current?.focus({ preventScroll: true });
    return () => {
      const now = document.activeElement;
      if ((!now || now === document.body) && opener?.isConnected)
        opener.focus({ preventScroll: true });
    };
  }, []);
  const panel = (
    <div
      ref={panelRef}
      className={`compose-pop ${docked ? "compose-pop--docked" : ""} ${fb ? "compose-pop--fb" : ""}`}
      role="dialog"
      aria-label={what}
      style={
        docked
          ? { bottom: kb > 0 ? kb + 8 : "calc(8px + env(safe-area-inset-bottom, 0px))" }
          : {
              left: x,
              top: y,
              ...(shift.x || shift.y ? { translate: `${shift.x}px ${shift.y}px` } : {}),
              ...style,
            }
      }
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
    >
      {onKind ? (
        <ChoiceGroup
          label="書くもの"
          className="compose-pop__kind"
          value={fb ? "feedback" : "comment"}
          onChange={onKind}
          choices={[
            { value: "comment", label },
            { value: "feedback", label: "FB" },
          ]}
        />
      ) : fb ? (
        <div className="compose-pop__note">FB（相談）として書きます</div>
      ) : null}
      {docked && quote ? <div className="compose-pop__quote">「{quote}」</div> : null}
      {place ? (
        <div className="compose-pop__place">
          <M3eIcon name={placeIcon} />
          {place}
        </div>
      ) : null}
      <MentionTextarea
        ref={ref}
        className="compose-pop__input"
        aria-label={what}
        // 改善の提案には理由も添えてもらう（必須にはせず案内だけ。利用者決定 2026-10-15 A-5）。
        // FB は解決しない相談・意見（迷っていること、ほかの案など）
        placeholder={
          fb
            ? "FB（相談・意見。解決はしません。@ でメンション）"
            : `${label}（改善案には理由も添えて。@ でメンション）`
        }
        rows={docked ? 2 : 3}
        value={value}
        onValue={onChange}
        mentions={mentions}
        onMentions={onMentions}
        onKeyDown={(e) => {
          // Esc は書いた文字を消さない（M3 Inputs › Escape key。§35 I-07）。空なら取消、書きかけならフォーカスを外すだけ。
          // IME の変換を取り消す Esc では何もしない
          if (e.key === "Escape" && !e.nativeEvent.isComposing) {
            e.stopPropagation();
            if (value.trim()) ref.current?.blur();
            else onCancel();
          }
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && value.trim()) onSubmit();
        }}
      />
      <div className="compose-pop__actions">
        <M3eIconButton aria-label="キャンセル" onClick={onCancel}>
          <M3eIcon name="close" />
        </M3eIconButton>
        <span className="spacer" />
        {extra}
        <M3eButton variant="filled" disabled={pending || !value.trim()} onClick={onSubmit}>
          {fb ? "FB で相談" : "投稿"}
        </M3eButton>
      </div>
    </div>
  );
  // docked は画面に固定する。スクロールや変形する親の中だと位置がずれるので body に出す
  return docked ? createPortal(panel, document.body) : panel;
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
      const top = Math.max(area?.top ?? 0, 0) + GAP;
      let bottom = Math.min(area?.bottom ?? window.innerHeight, window.innerHeight) - GAP;
      // 浮遊ツールバー: 縦長（右の縦のツールバー）は左へ、横長（下のツールバー）は上へよける
      const mid = { x: (left + right) / 2, y: (top + bottom) / 2 };
      for (const t of document.querySelectorAll<HTMLElement>(".ws__toolbar, .ws__side-toolbar")) {
        const tr = t.getBoundingClientRect();
        if (tr.width === 0 || tr.height === 0) continue;
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
