import { useEffect, useState } from "react";

/** 画面下に出ているソフトウェアキーボードの高さとみなす最小値（ブラウザのツールバーの出入りを拾わない） */
const MIN_KEYBOARD = 120;

/**
 * レイアウトの高さと、見えている範囲（visual viewport）の差からキーボードの高さを出す。
 * iOS Safari と Android Chrome（既定の resizes-visual）はキーボードでレイアウトを縮めないため、この差がキーボードになる。
 */
export function keyboardInset(
  layoutHeight: number,
  visualHeight: number,
  visualTop: number,
): number {
  const inset = Math.round(layoutHeight - visualHeight - visualTop);
  return inset >= MIN_KEYBOARD ? inset : 0;
}

/** ソフトウェアキーボードの高さ（px。出ていなければ 0）。enabled が false のあいだは監視しない */
export function useKeyboardInset(enabled = true): number {
  return useKeyboard(enabled).inset;
}

/**
 * ソフトウェアキーボードの高さ（inset）と、出ているか（open）。
 * iPhone のホーム画面アプリ（standalone）はキーボードでレイアウトの高さも縮むので、inset が 0 でも出ていることがある
 * （そのときは画面の下端がもうキーボードの上。下のセーフエリアの余白を足すと、キーボードとのあいだに隙間ができる）
 */
export function useKeyboard(enabled = true): { inset: number; open: boolean } {
  const [state, setState] = useState({ inset: 0, open: false });
  useEffect(() => {
    const vv = typeof window === "undefined" ? undefined : window.visualViewport;
    if (!enabled || !vv) {
      setState({ inset: 0, open: false });
      return;
    }
    // 同じ幅（向き）で見た、いちばん高い見えている高さ（キーボードが出ていないときの高さ）
    let baseline = { width: vv.width, height: vv.height };
    const update = () => {
      if (Math.abs(vv.width - baseline.width) > 1)
        baseline = { width: vv.width, height: vv.height };
      else if (vv.height > baseline.height) baseline = { ...baseline, height: vv.height };
      const inset = keyboardInset(window.innerHeight, vv.height, vv.offsetTop);
      const open = isKeyboardOpen({
        editing: isEditing(document.activeElement),
        baselineHeight: baseline.height,
        visualHeight: vv.height,
        layoutHeight: window.innerHeight,
        visualTop: vv.offsetTop,
      });
      setState((s) => (s.inset === inset && s.open === open ? s : { inset, open }));
    };
    // フォーカスの出入り（キーボードの出入りの前後）でも確かめる。キーボードが出きるまで少し待ってもう一度
    const timers: number[] = [];
    const onFocus = () => {
      requestAnimationFrame(update);
      timers.push(window.setTimeout(update, 350));
    };
    update();
    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    document.addEventListener("focusin", onFocus);
    document.addEventListener("focusout", onFocus);
    return () => {
      vv.removeEventListener("resize", update);
      vv.removeEventListener("scroll", update);
      document.removeEventListener("focusin", onFocus);
      document.removeEventListener("focusout", onFocus);
      for (const t of timers) window.clearTimeout(t);
    };
  }, [enabled]);
  return state;
}

/**
 * enabled のあいだ、ページ（と外枠）のスクロールの位置を留め、終わったら元に戻す。
 * iOS は画面下に固定した入力欄にフォーカスすると、見せようとしてページごと上へずらし、閉じても戻さない
 * （アプリバーが上に消えたまま。2026-10-21 の画面収録で確認）。欄はキーボードのすぐ上に自分で置くので、ずらしは要らない
 */
export function usePinPageScroll(enabled: boolean) {
  useEffect(() => {
    if (!enabled || typeof window === "undefined") return;
    const boxes = [...document.querySelectorAll<HTMLElement>(".shell__main, .shell__content")];
    const saved = { x: window.scrollX, y: window.scrollY, tops: boxes.map((b) => b.scrollTop) };
    const restore = () => {
      if (window.scrollX !== saved.x || window.scrollY !== saved.y)
        window.scrollTo(saved.x, saved.y);
      boxes.forEach((b, i) => {
        if (b.scrollTop !== saved.tops[i]) b.scrollTop = saved.tops[i]!;
      });
    };
    window.addEventListener("scroll", restore, { passive: true });
    for (const b of boxes) b.addEventListener("scroll", restore, { passive: true });
    return () => {
      window.removeEventListener("scroll", restore);
      for (const b of boxes) b.removeEventListener("scroll", restore);
      restore();
    };
  }, [enabled]);
}

/** 文字を入力中か（キーボードを出す要素にフォーカスがある） */
function isEditing(el: Element | null): boolean {
  if (!el) return false;
  if (el instanceof HTMLTextAreaElement) return !el.readOnly && !el.disabled;
  if (el instanceof HTMLInputElement)
    return (
      !el.readOnly &&
      !el.disabled &&
      ![
        "button",
        "checkbox",
        "radio",
        "range",
        "color",
        "file",
        "submit",
        "reset",
        "image",
      ].includes(el.type)
    );
  return (el as HTMLElement).isContentEditable === true;
}

/**
 * キーボードが出ているか。入力中で、見えている高さが（同じ幅で見た）いちばん高いときより
 * キーボード分（120 以上）低いか、レイアウトとの差がキーボード分あるとき。
 * iPhone のホーム画面アプリ（standalone）はキーボードでレイアウトの高さ（innerHeight）も縮むため、
 * レイアウトとの差だけでは分からない（2026-10-16 の画面収録で確認）。
 */
export function isKeyboardOpen(s: {
  editing: boolean;
  baselineHeight: number;
  visualHeight: number;
  layoutHeight: number;
  visualTop: number;
}): boolean {
  if (!s.editing) return false;
  return (
    keyboardInset(s.layoutHeight, s.visualHeight, s.visualTop) > 0 ||
    s.baselineHeight - s.visualHeight >= MIN_KEYBOARD
  );
}

/**
 * 画面を「見えている範囲」（visual viewport）に収める（チャットの画面）。enabled のあいだ、
 * :root に --mf-vvh（見えている高さ）と --mf-vv-top（iOS がずらした量）を入れ、キーボードが出ていれば mf-kb-open を付ける。
 * iOS Safari はキーボードでレイアウトを縮めず、ページごと上へずらして入力欄を見せる（アプリバーや下部ナビまで動く）。
 * 画面をこの範囲に固定すると、キーボードのぶん投稿の欄だけが縮み、返信欄はキーボードのすぐ上に留まる。
 */
export function useVisualViewportBox(enabled: boolean) {
  useEffect(() => {
    const vv = typeof window === "undefined" ? undefined : window.visualViewport;
    if (!enabled || !vv) return;
    const root = document.documentElement;
    // 同じ幅（向き）で見た、いちばん高い見えている高さ（キーボードが出ていないときの高さ）
    let baseline = { width: vv.width, height: vv.height };
    // iOS は入力欄を見せようとして、overflow: hidden の外枠までスクロールする（アプリバーが上に消える）。
    // 画面は見えている範囲に合わせて縮めているので、外枠とページのスクロールは常に 0 に戻す
    const unscroll = () => {
      if (window.scrollY !== 0 || window.scrollX !== 0) window.scrollTo(0, 0);
      document
        .querySelectorAll<HTMLElement>(
          ".shell--chat, .shell--chat .shell__main, .shell--chat .shell__content",
        )
        .forEach((el) => {
          if (el.scrollTop !== 0) el.scrollTop = 0;
        });
    };
    const update = () => {
      if (Math.abs(vv.width - baseline.width) > 1)
        baseline = { width: vv.width, height: vv.height };
      else if (vv.height > baseline.height) baseline = { ...baseline, height: vv.height };
      unscroll();
      root.style.setProperty("--mf-vvh", `${vv.height}px`);
      root.style.setProperty("--mf-vv-top", `${vv.offsetTop}px`);
      root.classList.toggle(
        "mf-kb-open",
        isKeyboardOpen({
          editing: isEditing(document.activeElement),
          baselineHeight: baseline.height,
          visualHeight: vv.height,
          layoutHeight: window.innerHeight,
          visualTop: vv.offsetTop,
        }),
      );
    };
    // フォーカスの出入り（キーボードの出入りの前後）でも確かめる。キーボードが出きるまで少し待ってもう一度
    const timers: number[] = [];
    const onFocus = () => {
      requestAnimationFrame(update);
      timers.push(window.setTimeout(update, 350));
    };
    update();
    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    window.addEventListener("scroll", unscroll, { passive: true });
    document.addEventListener("focusin", onFocus);
    document.addEventListener("focusout", onFocus);
    return () => {
      vv.removeEventListener("resize", update);
      vv.removeEventListener("scroll", update);
      window.removeEventListener("scroll", unscroll);
      document.removeEventListener("focusin", onFocus);
      document.removeEventListener("focusout", onFocus);
      for (const t of timers) window.clearTimeout(t);
      root.style.removeProperty("--mf-vvh");
      root.style.removeProperty("--mf-vv-top");
      root.classList.remove("mf-kb-open");
    };
  }, [enabled]);
}
