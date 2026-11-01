import type { ReactNode } from "react";
import { formatDeadlineUntil, remaining } from "@/lib/format";
import { UrgentReviewChip } from "@/features/review/UrgentReviewChip";
import { M3eBadge } from "@m3e/react/badge";
import { M3eHeading } from "@m3e/react/heading";
import { M3eIcon } from "@m3e/react/icon";
import { M3eActionList, M3eListAction } from "@m3e/react/list";
import { useWindowClass } from "@/lib/useMedia";

/**
 * 制作・校正の入口（ホームの代わり）の共通部品。色は同じ。入口は構造と文言で分ける。
 * 色は `.hub` の `--hub-*`（styles.css）に 1 か所で定義する。
 */

/** 締切の 1 行（「校正の締切 残り 3 日・10/22（木）」。相対時間を先に、日付を添える）。無ければ空 */
export const deadlineLine = (label: string, at: number | null | undefined): string =>
  at ? `${label} ${remaining(at)}・${formatDeadlineUntil(at)}` : "";

/** 行の右の「次の操作」の印。行全体が押せる（印は見た目だけ。同じ行に操作を二重に入れない） */
export function ActionChip({
  icon,
  children,
  trailing = true,
}: {
  icon?: string;
  children: ReactNode;
  /** 行の右の枠に置く（compact は supporting-text の末尾に置くので false） */
  trailing?: boolean;
}) {
  return (
    <span className="hub-chip" {...(trailing ? { slot: "trailing" } : {})}>
      {icon ? <M3eIcon name={icon} /> : null}
      {children}
    </span>
  );
}

/** 一覧の行（押すと開く）。2 行目以降は `lines` を改行で並べる */
export function WorkspaceRow({
  icon,
  title,
  suffix,
  lines,
  chip,
  chipIcon,
  urgent,
  reviewUrgent,
  onOpen,
}: {
  icon: string;
  title: string;
  /** 題名の後ろに薄く添える（版の名前など） */
  suffix?: string | null | undefined;
  lines: ReadonlyArray<string | false | null | undefined>;
  chip: ReactNode;
  chipIcon?: string;
  /** 期限超過など、注意が要る行（題名を error の色に） */
  urgent?: boolean;
  /** 版提出の「緊急」 */
  reviewUrgent?: boolean;
  onOpen: () => void;
}) {
  const shown = lines.filter(Boolean) as string[];
  const compact = useWindowClass() === "compact";
  const chipProps = chipIcon ? { icon: chipIcon } : {};
  return (
    <M3eListAction
      className={`list__item hub-row ${urgent ? "list__item--urgent" : ""}`}
      onClick={onOpen}
    >
      <M3eIcon slot="leading" name={icon} />
      <span className="list__headline">
        {title}
        {suffix ? <span className="muted">　{suffix}</span> : null}
      </span>
      <span slot="supporting-text">
        {reviewUrgent ? (
          <span className="hub-row__line">
            <UrgentReviewChip className="review-urgent-chip" />
          </span>
        ) : null}
        {shown.map((l, i) => (
          <span key={i} className="hub-row__line">
            {l}
          </span>
        ))}
        {compact ? (
          <span className="hub-row__line hub-row__line--action">
            <ActionChip trailing={false} {...chipProps}>
              {chip}
            </ActionChip>
          </span>
        ) : null}
      </span>
      {compact ? null : <ActionChip {...chipProps}>{chip}</ActionChip>}
    </M3eListAction>
  );
}

/** 見出し付きのまとまり（あなたの番・校正中・割り当てる など）。件数を添える */
export function Group({
  title,
  count,
  label,
  side,
  className,
  children,
}: {
  title: string;
  count?: number;
  /** 一覧の読み上げ名（省略すると見出し） */
  label?: string;
  /** 補助のまとまりは見出しを控えめに */
  side?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section className={`dash__section ${side ? "dash__section--side" : ""} ${className ?? ""}`}>
      <div className="dash__head">
        <M3eHeading
          variant="title"
          size={side ? "small" : "medium"}
          level={2}
          {...(side ? {} : { emphasized: true })}
          className={side ? "dash__title dash__title--side" : "dash__title"}
        >
          {title}
        </M3eHeading>
        {count !== undefined ? (
          <M3eBadge size="medium" className="dash__badge" aria-label={`${count} 件`}>
            {count}
          </M3eBadge>
        ) : null}
      </div>
      <M3eActionList className="list" aria-label={label ?? title}>
        {children}
      </M3eActionList>
    </section>
  );
}

/** 何も無いときの空の表示 */
export function Empty({ icon, children }: { icon: string; children: ReactNode }) {
  return (
    <div className="empty">
      <M3eIcon name={icon} />
      {children}
    </div>
  );
}
