import type { ReactNode } from "react";
import { formatDeadlineUntil, remaining } from "@/lib/format";
import { M3eHeading } from "@m3e/react/heading";
import { M3eIcon } from "@m3e/react/icon";
import { M3eActionList, M3eListAction } from "@m3e/react/list";

/**
 * 制作・校正の入口（ホームの代わり）の共通部品。入口ごとに色を変える（制作 = 青、校正 = ティール）。
 * 色は `.hub[data-hub]` のトークン（styles.css）で切り替え、部品は同じものを使う。
 */

/** 締切の 1 行（「締切 11/14（土）23:59（残り 3 日）」）。無ければ空 */
export const deadlineText = (label: string, at: number | null | undefined): string =>
  at ? `${label} ${formatDeadlineUntil(at)}（${remaining(at)}）` : "";

/** 行の右の「次の操作」の印。行全体が押せる（印は見た目だけ。同じ行に操作を二重に入れない） */
export function ActionChip({ icon, children }: { icon?: string; children: ReactNode }) {
  return (
    <span className="hub-chip" slot="trailing">
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
  onOpen: () => void;
}) {
  const shown = lines.filter(Boolean) as string[];
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
        {shown.map((l, i) => (
          <span key={i} className="hub-row__line">
            {l}
          </span>
        ))}
      </span>
      <ActionChip {...(chipIcon ? { icon: chipIcon } : {})}>{chip}</ActionChip>
    </M3eListAction>
  );
}

/** 見出し付きのまとまり（あなたの番・校正中・割り当てる など）。件数を添える */
export function Group({
  title,
  count,
  label,
  side,
  children,
}: {
  title: string;
  count?: number;
  /** 一覧の読み上げ名（省略すると見出し） */
  label?: string;
  /** 補助のまとまりは見出しを控えめに */
  side?: boolean;
  children: ReactNode;
}) {
  return (
    <section className={`dash__section ${side ? "dash__section--side" : ""}`}>
      <div className="dash__head">
        <M3eHeading
          variant="title"
          size={side ? "small" : "large"}
          level={2}
          {...(side ? {} : { emphasized: true })}
          className={side ? "dash__title dash__title--side" : "dash__title"}
        >
          {title}
        </M3eHeading>
        {count !== undefined ? <span className="dash__count">{count}</span> : null}
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
