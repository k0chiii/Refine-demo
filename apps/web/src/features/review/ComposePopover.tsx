import { useEffect, useRef, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useKeyboardInset } from "@/lib/useKeyboardInset";
import { M3eButton, M3eButtonSegment, M3eIconButton, M3eIcon, M3eSegmentedButton } from "@/ui/m3e";
import { MentionTextarea } from "./mentions";

/**
 * 範囲・ピンのそばに出る投稿欄（Google ドキュメント / Figma の「コメントを追加」）。
 * 位置を選んだ瞬間に出るので、モード切替やパネルへの移動が要らない。
 * Enter（Ctrl/⌘）で投稿、Escape で取消。「@」で制作物を見られる人をメンションできる。
 *
 * docked（compact）: 選んだ位置のそばではなく、画面下（キーボードが出ていればそのすぐ上）に全幅で出す。
 * 小さい画面では位置のそばの欄がキーボードや指に隠れるため。何に対するコメントかは引用で示す。
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
  /** 書くもの: コメント（指摘して解決する）か FB（解決しない相談）。利用者決定 2026-10-15 */
  kind?: "comment" | "feedback";
  /** 渡すと「コメント／FB」を切り替えられる（コメントできない版では渡さず FB だけ） */
  onKind?: (k: "comment" | "feedback") => void;
}) {
  const fb = kind === "feedback";
  const what = fb ? "FB" : label;
  const ref = useRef<HTMLTextAreaElement>(null);
  const kb = useKeyboardInset(docked === true);
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
      className={`compose-pop ${docked ? "compose-pop--docked" : ""} ${fb ? "compose-pop--fb" : ""}`}
      role="dialog"
      aria-label={what}
      style={
        docked
          ? { bottom: kb > 0 ? kb + 8 : "calc(8px + env(safe-area-inset-bottom, 0px))" }
          : { left: x, top: y, ...style }
      }
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
    >
      {onKind ? (
        <M3eSegmentedButton aria-label="書くもの" className="compose-pop__kind">
          <M3eButtonSegment checked={!fb} onClick={() => onKind("comment")}>
            {label}
          </M3eButtonSegment>
          <M3eButtonSegment checked={fb} onClick={() => onKind("feedback")}>
            FB
          </M3eButtonSegment>
        </M3eSegmentedButton>
      ) : fb ? (
        <div className="compose-pop__note">FB（相談）として書きます</div>
      ) : null}
      {docked && quote ? <div className="compose-pop__quote">「{quote}」</div> : null}
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
