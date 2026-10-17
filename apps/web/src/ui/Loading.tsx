import type { M3eLoadingIndicatorElement } from "@m3e/web/loading-indicator";
import { useEffect, useRef } from "react";
import { useMedia } from "@/lib/useMedia";
import { M3eLoadingIndicator } from "@m3e/react/loading-indicator";

/**
 * 読み込み中の表示（利用者指示 2026-10-17「読み込み中のやつも M3E に揃えてね」）。
 * 画面・区画の中身がまだ届いていないときに、文字「読み込み中…」の代わりに M3 Expressive の
 * Loading indicator（形が移り変わる不確定の指標。短い待ちに使う）を中央に出す。
 * - 読み上げ: 外側が role="status" で、現れたときに `label` を一度知らせる（指標の絵は aria-hidden。二重に読ませない）。
 *   `caption` を付けたときだけ文字も見える（ファイルの取得など長くなり得る待ちに）
 * - 動きを減らす設定（prefers-reduced-motion）では指標の回転と変形を止めて形だけ出す（M3E 側は未対応）
 * - ごく短い読み込みで点滅しないよう、現れるまで 150ms 待つ（styles.css の .loading）
 * - `calm`: 外側の回転（transform。合成だけで済む）は残し、内側の形の変形（clip-path。毎フレーム主スレッドで
 *   描き直す）を止める。ファイルの取得・ビューアの読み込みのように、待つ間に PDF.js などの重い処理が同じ
 *   スレッドで走る場所に使う（UI_M3E §60。CPU 4 倍遅で校正画面の PDF が出るまでが約 0.5〜1.5 秒延びていた）
 * 進み具合が分かる処理（転送・自動校正）は従来どおり progress indicator（M3 Progress indicators）を使う。
 */
let calmStyles: CSSStyleSheet | undefined;
/** M3E の指標の内側（.active-indicator）の rotate-inner（clip-path の変形）だけを止める。形は soft burst のまま */
function calmSheet(): CSSStyleSheet {
  if (!calmStyles) {
    calmStyles = new CSSStyleSheet();
    calmStyles.replaceSync(
      ".container.calm .active-indicator { animation: none; clip-path: var(--_polygon-soft-burst); }",
    );
  }
  return calmStyles;
}

export function Loading({
  label,
  caption,
  size = "medium",
  inline = false,
  contained = false,
  className,
  slot,
  calm = false,
}: {
  /** 何を読み込んでいるか（読み上げの名前。例「制作物を読み込んでいます」） */
  label: string;
  /** 指標の下（inline では右）に文字も出す。true なら label、文字列ならその文を */
  caption?: boolean | string;
  /** medium: 48px（既定。画面・区画の中央）、small: 32px（側の一覧・小さなパネル） */
  size?: "medium" | "small";
  /** 文中・行の中に置く（inline-flex。指標 24px） */
  inline?: boolean;
  /** 他の中身の上に重ねるときの contained（M3: 背景と区別する容器付き） */
  contained?: boolean;
  className?: string;
  /** Web Components の slot に置くとき */
  slot?: string;
  /** 形の変形を止めて回転だけにする（重い処理と並ぶ待ち。上の説明） */
  calm?: boolean;
}) {
  const reduced = useMedia("(prefers-reduced-motion: reduce)");
  const ref = useRef<M3eLoadingIndicatorElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let cancelled = false;
    // M3E の指標は shadow DOM の .container.animate で回る。動きを減らす設定ではその印を外して止める
    void el.updateComplete.then(() => {
      if (cancelled || !el.shadowRoot) return;
      const container = el.shadowRoot.querySelector(".container");
      container?.classList.toggle("animate", !reduced);
      container?.classList.toggle("calm", calm);
      if (calm && !el.shadowRoot.adoptedStyleSheets.includes(calmSheet()))
        el.shadowRoot.adoptedStyleSheets = [...el.shadowRoot.adoptedStyleSheets, calmSheet()];
    });
    return () => {
      cancelled = true;
    };
  }, [reduced, calm]);

  const text = caption === true ? label : typeof caption === "string" ? caption : null;
  const Tag = inline ? "span" : "div";
  const cls = [
    "loading",
    inline ? "loading--inline" : size === "small" ? "loading--small" : "",
    className ?? "",
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <Tag className={cls} role="status" {...(slot ? { slot } : {})}>
      <M3eLoadingIndicator
        ref={ref}
        variant={contained ? "contained" : "uncontained"}
        aria-hidden="true"
      />
      {text ? (
        <span className="loading__text">{text}</span>
      ) : (
        <span className="sr-only">{label}</span>
      )}
    </Tag>
  );
}
