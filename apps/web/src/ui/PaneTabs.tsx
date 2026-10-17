import { M3eBadge } from "@m3e/react/badge";
import { M3eTab, M3eTabs } from "@m3e/react/tabs";

/**
 * 画面内の切り替え（M3E tabs・secondary）。内容は呼び出し側が描く（パネルは使わない）。
 * 対応が必要な件数（未処理の提案・未解決のコメント・表記の指摘）だけ M3E badge で添える（ただの総数には付けない）。選択は呼び出し側の状態に従う（制御コンポーネント）。
 */
export function PaneTabs<T extends string>({
  items,
  value,
  onChange,
  label,
  className,
  stretch,
}: {
  items: Array<{ id: T; label: string; count?: number | null; icon?: string }>;
  value: T;
  onChange: (id: T) => void;
  label: string;
  className?: string;
  stretch?: boolean;
}) {
  return (
    <M3eTabs
      aria-label={label}
      className={`pane-tabs ${className ?? ""}`}
      disablePagination="auto"
      {...(stretch ? { stretch: true } : {})}
    >
      {items.map((it) => (
        <M3eTab key={it.id} selected={value === it.id} onClick={() => onChange(it.id)}>
          {it.label}
          {it.count ? (
            <M3eBadge size="medium" className="pane-tabs__badge">
              {it.count}
            </M3eBadge>
          ) : null}
        </M3eTab>
      ))}
    </M3eTabs>
  );
}
