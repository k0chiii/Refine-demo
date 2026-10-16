import type { ReactNode } from "react";
import { M3eIcon } from "./m3e";

export type ChipTone = "neutral" | "primary" | "success" | "warning" | "error";

/**
 * 状態表示。M3 には状態のラベルの部品が無い（chip は操作の部品）ので、文字＋アイコン＋色で出す（色だけに頼らない。
 * M3 の色の役割 error / success / warning を文字に使う。§49）。属性や補足は塗らずに文字（`meta`）で出す。
 */
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
