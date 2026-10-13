import type { ReactNode } from "react";
import { M3eHeading } from "./m3e";

/** 画面タイトル（headline-small・強調）。右側に主要操作を並べる。 */
export function PageHeader({
  title,
  meta,
  children,
  level = 1,
  size = "small",
}: {
  title: ReactNode;
  /** タイトル直後に並べる補足（チップなど） */
  meta?: ReactNode;
  /** 右寄せの操作 */
  children?: ReactNode;
  level?: 1 | 2 | 3;
  size?: "small" | "medium";
}) {
  return (
    <header className="page-header">
      <M3eHeading
        variant="headline"
        size={size}
        level={level}
        emphasized
        className="page-header__title"
      >
        {title}
      </M3eHeading>
      {meta}
      <span className="spacer" />
      {children}
    </header>
  );
}
