import type { ReactNode } from "react";
import { M3eIcon } from "./m3e";

export type ChipTone = "neutral" | "primary" | "success" | "warning" | "error";

/**
 * 状態表示（校正受付・採否・重大度・権限など）。
 * M3 の assist/filter chip は「操作」用なので、読み取り専用の状態には色役割（primary / tertiary / error
 * と補助の success）のコンテナ色で塗った非対話チップを使う。意味と色の対応は tone で固定する。
 */
export function StatusChip({
  tone = "neutral",
  icon,
  children,
  className,
  title,
}: {
  tone?: ChipTone;
  icon?: string | undefined;
  children: ReactNode;
  className?: string;
  title?: string;
}) {
  return (
    <span className={`chip chip--${tone} ${className ?? ""}`} {...(title ? { title } : {})}>
      {icon ? <M3eIcon name={icon} className="chip__icon" /> : null}
      {children}
    </span>
  );
}
