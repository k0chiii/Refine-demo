import type { M3eLoadingIndicatorElement } from "@m3e/web/loading-indicator";
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { useMedia } from "@/lib/useMedia";
import { M3eLoadingIndicator } from "@m3e/react/loading-indicator";

/** 読み込み表示が途切れて（外れて）からこの間に次の表示が付いたら、ひと続きの待ちとして扱う */
const CONTINUE_MS = 250;
/** ひと続きの読み込みの開始と、いま付いている数（画面の切り替えで作り直されても、遅れ・形の位相を引き継ぐ。docs/UI_M3E.md §65） */
const session = { start: 0, active: 0, lastEnd: Number.NEGATIVE_INFINITY };
const continuing = () => session.active > 0 || performance.now() - session.lastEnd < CONTINUE_MS;
/** いまのひと続きの読み込みが始まってからの経過（新しく始まるなら 0） */
const elapsedNow = () => (continuing() ? performance.now() - session.start : 0);

/**
 * 読み込み中の表示（利用者指示 2026-10-17「読み込み中のやつも M3E に揃えてね」）。
 * 画面・区画の中身がまだ届いていないときに、文字「読み込み中…」の代わりに M3 Expressive の
 * Loading indicator（形が移り変わる不確定の指標。短い待ちに使う）を中央に出す。
 * - 読み上げ: 外側が role="status" で、現れたときに `label` を一度知らせる（指標の絵は aria-hidden。二重に読ませない）。
 *   `caption` を付けたときだけ文字も見える（ファイルの取得など長くなり得る待ちに）
 * - 動きを減らす設定（prefers-reduced-motion）では指標の回転と変形を止めて形だけ出す（M3E 側は未対応）
 * - ごく短い読み込みで点滅しないよう、現れるまで 150ms 待つ（styles.css の .loading）。
 *   待ちの途中で画面の切り替え（ルートの待ち → 画面 → ビューア）により作り直されても、遅れは最初から数え直さず
 *   （もう現れていれば最初から見せる）、形の変化も途中から続ける（「一回の読み込みで表示が何度も変わる」を作らない。§65）
 * 進み具合が分かる処理（転送・自動校正）は従来どおり progress indicator（M3 Progress indicators）を使う。
 */
export function Loading({
  label,
  caption,
  size = "medium",
  inline = false,
  contained = false,
  className,
  slot,
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
}) {
  const reduced = useMedia("(prefers-reduced-motion: reduce)");
  const ref = useRef<M3eLoadingIndicatorElement>(null);
  /** 作られたとき、ひと続きの待ちがすでに何 ms 続いていたか */
  const [elapsed] = useState(elapsedNow);
  useLayoutEffect(() => {
    if (!continuing()) session.start = performance.now();
    session.active++;
    return () => {
      session.active--;
      if (session.active === 0) session.lastEnd = performance.now();
    };
  }, []);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let cancelled = false;
    // M3E の指標は shadow DOM の .container.animate で回る。動きを減らす設定ではその印を外して止める
    void el.updateComplete.then(() => {
      if (cancelled) return;
      el.shadowRoot?.querySelector(".container")?.classList.toggle("animate", !reduced);
      // 作り直されたときは、前の指標が回っていた位相から続ける
      if (!reduced && elapsed > 0)
        for (const node of el.shadowRoot?.querySelectorAll("*") ?? [])
          for (const a of node.getAnimations()) a.currentTime = elapsed;
    });
    return () => {
      cancelled = true;
    };
  }, [reduced, elapsed]);
  // もう現れているはずの待ちなら、現れ方の遅れ・フェードを付けない（一度消えて点滅するのを避ける）
  const appear: CSSProperties | undefined =
    elapsed >= 150
      ? { animation: "none" }
      : elapsed > 0
        ? { animationDelay: `${150 - elapsed}ms` }
        : undefined;

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
    <Tag
      className={cls}
      role="status"
      {...(appear ? { style: appear } : {})}
      {...(slot ? { slot } : {})}
    >
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
