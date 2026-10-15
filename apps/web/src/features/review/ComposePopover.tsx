import { useEffect, useRef, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useKeyboardInset } from "@/lib/useKeyboardInset";
import { M3eButton, M3eIconButton, M3eIcon } from "@/ui/m3e";
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
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const kb = useKeyboardInset(docked === true);
  useEffect(() => {
    ref.current?.focus({ preventScroll: true });
  }, []);
  const panel = (
    <div
      className={`compose-pop ${docked ? "compose-pop--docked" : ""}`}
      role="dialog"
      aria-label={label}
      style={
        docked
          ? { bottom: kb > 0 ? kb + 8 : "calc(8px + env(safe-area-inset-bottom, 0px))" }
          : { left: x, top: y, ...style }
      }
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
    >
      {docked && quote ? <div className="compose-pop__quote">「{quote}」</div> : null}
      <MentionTextarea
        ref={ref}
        className="compose-pop__input"
        aria-label={label}
        placeholder={`${label}（@ でメンション）`}
        rows={docked ? 2 : 3}
        value={value}
        onValue={onChange}
        mentions={mentions}
        onMentions={onMentions}
        onKeyDown={(e) => {
          if (e.key === "Escape") onCancel();
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
          投稿
        </M3eButton>
      </div>
    </div>
  );
  // docked は画面に固定する。スクロールや変形する親の中だと位置がずれるので body に出す
  return docked ? createPortal(panel, document.body) : panel;
}
