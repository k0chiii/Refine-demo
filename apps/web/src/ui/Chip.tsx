import type { ReactNode } from "react";
import { M3eIcon } from "./m3e";

export type ChipTone = "neutral" | "primary" | "success" | "warning" | "error";

/**
 * 状態表示。方針（GitHub のレビュー、Linear、Figma / Frame.io のコメント UI に倣う）:
 * - 色付きのチップは「操作を左右する状態」1 つだけ（受付中・期限超過・未対応・未完了・校了）。
 * - 属性や補足（版、種別、件数、担当、ファイル名）は塗らずに文字（`meta`）で出す。
 * tone を省略すると文字表示になる。
 */
export function StatusChip({
  tone,
  icon,
  children,
  className,
  title,
}: {
  tone?: ChipTone | undefined;
  icon?: string | undefined;
  children: ReactNode;
  className?: string;
  title?: string;
}) {
  const plain = !tone || tone === "neutral";
  return (
    <span
      className={`${plain ? "meta" : `chip chip--${tone}`} ${className ?? ""}`}
      {...(title ? { title } : {})}
    >
      {icon ? <M3eIcon name={icon} className="chip__icon" /> : null}
      {children}
    </span>
  );
}

/** 文字だけの状態表示（色は意味のあるときだけ: error / warning / success） */
export function StatusText({
  tone = "neutral",
  icon,
  children,
  className,
  title,
}: {
  tone?: ChipTone | undefined;
  icon?: string | undefined;
  children: ReactNode;
  className?: string;
  title?: string;
}) {
  return (
    <span className={`meta meta--${tone} ${className ?? ""}`} {...(title ? { title } : {})}>
      {icon ? <M3eIcon name={icon} className="chip__icon" /> : null}
      {children}
    </span>
  );
}
