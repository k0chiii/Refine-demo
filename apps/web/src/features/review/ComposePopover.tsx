import { useEffect, useRef, type CSSProperties } from "react";
import { M3eButton, M3eIconButton, M3eIcon } from "@/ui/m3e";

/**
 * 範囲・ピンのそばに出る投稿欄（Google ドキュメント / Figma の「コメントを追加」）。
 * 位置を選んだ瞬間に出るので、モード切替やパネルへの移動が要らない。
 * Enter（Ctrl/⌘）で投稿、Escape で取消。
 */
export function ComposePopover({
  x,
  y,
  value,
  onChange,
  onSubmit,
  onCancel,
  pending,
  label = "コメント",
  style,
}: {
  x: number;
  y: number;
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  onCancel: () => void;
  pending?: boolean;
  label?: string;
  style?: CSSProperties;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    ref.current?.focus();
  }, []);
  return (
    <div
      className="compose-pop"
      role="dialog"
      aria-label={label}
      style={{ left: x, top: y, ...style }}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
    >
      <textarea
        ref={ref}
        className="compose-pop__input"
        aria-label={label}
        placeholder={label}
        rows={3}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") onCancel();
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && value.trim()) onSubmit();
        }}
      />
      <div className="compose-pop__actions">
        <M3eIconButton aria-label="取消" onClick={onCancel}>
          <M3eIcon name="close" />
        </M3eIconButton>
        <span className="spacer" />
        <M3eButton variant="filled" disabled={pending || !value.trim()} onClick={onSubmit}>
          投稿
        </M3eButton>
      </div>
    </div>
  );
}
