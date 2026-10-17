import type { ReactNode } from "react";
import { M3eCard } from "@m3e/react/card";
import { M3eHeading } from "@m3e/react/heading";

/**
 * 情報カード（M3E card）。見出しは title-medium、本文は content slot（余白あり）。
 * variant: filled（既定・surface-container-highest 系）/ outlined / elevated。
 */
export function Card({
  title,
  actions,
  children,
  variant = "outlined",
  className,
  ariaLabel,
  style,
  level = 2,
}: {
  /** 見出しの階層（h1 はアプリバー。画面の節は 2、その下は 3。§35 I-11） */
  level?: 2 | 3 | 4;
  title?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  variant?: "filled" | "outlined" | "elevated";
  className?: string;
  ariaLabel?: string;
  style?: React.CSSProperties;
}) {
  return (
    <M3eCard
      variant={variant}
      className={`card ${className ?? ""}`}
      {...(ariaLabel ? { "aria-label": ariaLabel, role: "region" } : {})}
      {...(style ? { style } : {})}
    >
      {title ? (
        <div slot="header" className="card__header">
          <M3eHeading variant="title" size="medium" level={level} className="card__title">
            {title}
          </M3eHeading>
          {actions ? <div className="card__actions">{actions}</div> : null}
        </div>
      ) : null}
      <div slot="content" className="card__content">
        {children}
      </div>
    </M3eCard>
  );
}
