import { useEffect, useRef } from "react";
import { scrollBehavior } from "@/lib/motion";

/**
 * 選んだコメントのカードを、コメント一覧のなかで見える位置までスクロールする（紙面のピン・範囲・URL の ?thread=・通知から選んだとき）。
 *
 * どのレイアウトでも同じ道具を通す: ボトムシート（M3E の本体が自分でスクロールする）・補助ペイン（引き出し）のどちらでも、
 * カードから外へたどって最初のスクロール域を見つけ、その域だけを動かす（scrollIntoView はページ全体も動かしてしまい、
 * 画面外にあるシートを目がけてレイアウトがずれる）。
 *
 * 開く途中のシートや、まだ描かれていない一覧を測らないよう、固定の待ち時間ではなく「カードが DOM に現れる」「祖先の動き
 * （シートの移動・高さの吸着）が終わる」「スクロール域の大きさが落ち着く」を待つ。選び直しで中断できる（AbortSignal）。
 */

const CARD = "[data-thread-id]";
/** 選択のあとカードの高さが変わる（返信欄・履歴が開く）間だけ、見え方を保つ */
const FOLLOW_MS = 1500;
/** 一覧が現れるまで待つ上限（フレーム数。データ読み込み・タブ切り替えの分。約 10 秒） */
const MAX_WAIT_FRAMES = 600;

const frame = (signal: AbortSignal) =>
  new Promise<boolean>((resolve) => {
    if (signal.aborted) return resolve(false);
    const id = requestAnimationFrame(() => resolve(!signal.aborted));
    signal.addEventListener(
      "abort",
      () => {
        cancelAnimationFrame(id);
        resolve(false);
      },
      { once: true },
    );
  });

async function frames(n: number, signal: AbortSignal): Promise<boolean> {
  for (let i = 0; i < n; i++) if (!(await frame(signal))) return false;
  return true;
}

/** 要素の親（スロット・シャドウ境界をまたぐ。M3E のシートの本体は shadow DOM のなか） */
function composedParent(n: Node): Element | null {
  if (n instanceof Element && n.assignedSlot) return n.assignedSlot;
  const p = n.parentNode;
  if (p instanceof ShadowRoot) return p.host;
  return p instanceof Element ? p : null;
}

function scrollParent(el: Element): HTMLElement | null {
  for (let p = composedParent(el); p; p = composedParent(p)) {
    const o = getComputedStyle(p).overflowY;
    if ((o === "auto" || o === "scroll" || o === "overlay") && p.scrollHeight > p.clientHeight + 1)
      return p as HTMLElement;
  }
  return null;
}

/** カードの祖先で動いている（終わりのある）アニメーション。シートの移動・高さの吸着など */
function runningAnimations(el: Element): Animation[] {
  const out: Animation[] = [];
  for (let p: Element | null = el; p; p = composedParent(p)) {
    for (const a of p.getAnimations?.() ?? []) {
      if (a.playState !== "running") continue;
      const end = a.effect?.getComputedTiming().endTime;
      if (typeof end === "number" && Number.isFinite(end)) out.push(a);
    }
  }
  return out;
}

const margin = (el: Element, side: "Top" | "Bottom") => {
  const v = parseFloat(getComputedStyle(el)[`scrollMargin${side}`]);
  return Number.isFinite(v) ? v : 0;
};

/** スクロール域のなかでカードが見える範囲（余白を除く）に対する、動かす量。0 なら動かさない */
function revealDelta(
  box: { top: number; bottom: number },
  view: { top: number; bottom: number },
  mode: "start" | "nearest",
): number {
  const above = box.top - view.top;
  const below = box.bottom - view.bottom;
  if (above >= 0 && below <= 0) return 0;
  if (mode === "start") return above;
  // 近いほうへ。カードが域より高いときは上端を優先し、上端を域の外へ押し出さない
  if (above < 0) return above;
  return Math.min(below, above);
}

function cardIn(id: string): HTMLElement | null {
  const css = typeof CSS !== "undefined" && CSS.escape ? CSS.escape(id) : id;
  for (const el of document.querySelectorAll<HTMLElement>(`.comments__list ${CARD}`))
    if (el.dataset.threadId === id || el.matches(`[data-thread-id="${css}"]`)) {
      // 表示されていない複製（隠れた引き出しなど）は選ばない
      if (el.getClientRects().length > 0) return el;
    }
  return null;
}

/**
 * 選んだスレッドのカードを一覧のなかで見える位置へ。カードが見つかってスクロールできたら true、
 * 中断・見つからないまま上限に達したら false
 */
export async function scrollThreadIntoView(id: string, signal: AbortSignal): Promise<boolean> {
  let card: HTMLElement | null = null;
  for (let i = 0; i < MAX_WAIT_FRAMES && !card; i++) {
    card = cardIn(id);
    if (!card && !(await frame(signal))) return false;
  }
  if (!card) return false;

  // シートが開く・タブが切り替わる途中に測らない: 祖先の動きが終わり、スクロール域が 2 フレーム動かなくなるまで待つ
  if (!(await frames(2, signal))) return false;
  let last = "";
  for (let i = 0; i < 120; i++) {
    const running = runningAnimations(card);
    if (running.length > 0) {
      await Promise.race([
        Promise.allSettled(running.map((a) => a.finished)),
        new Promise<void>((r) => signal.addEventListener("abort", () => r(), { once: true })),
      ]);
      if (signal.aborted) return false;
      last = "";
      continue;
    }
    const sp = scrollParent(card);
    const r = sp?.getBoundingClientRect();
    const key = r ? `${r.top}|${r.height}|${sp!.scrollHeight}` : "none";
    if (key === last) break;
    last = key;
    if (!(await frame(signal))) return false;
  }
  if (!card.isConnected) return false;
  const sp = scrollParent(card);
  if (!sp) return true; // 一覧が全部見えている（スクロールするものがない）

  // スムーズスクロールの途中でも「行き先」を基準に測る（今の位置で測ると、動いている最中のスクロールを上書きして邪魔をする）
  let dest = sp.scrollTop;
  const place = (mode: "start" | "nearest", behavior: ScrollBehavior) => {
    const c = card!.getBoundingClientRect();
    const s = sp.getBoundingClientRect();
    const origin = s.top + sp.clientTop;
    const top = c.top - origin + sp.scrollTop; // スクロール域の中身の座標
    const delta = revealDelta(
      { top: top - margin(card!, "Top"), bottom: top + c.height + margin(card!, "Bottom") },
      { top: dest, bottom: dest + sp.clientHeight },
      mode,
    );
    if (Math.abs(delta) < 1) return;
    dest = Math.max(0, Math.min(dest + delta, sp.scrollHeight - sp.clientHeight));
    sp.scrollTo({ top: dest, behavior });
  };
  place("start", scrollBehavior());

  // 返信欄・履歴が開いてカードが伸びる間は、見え方を保つ。利用者が自分でスクロールしたらやめる
  await new Promise<void>((resolve) => {
    const stop = () => {
      ro.disconnect();
      clearTimeout(timer);
      for (const ev of ["wheel", "touchstart", "pointerdown", "keydown"])
        sp.removeEventListener(ev, stop);
      signal.removeEventListener("abort", stop);
      resolve();
    };
    const ro = new ResizeObserver(() => {
      if (card!.isConnected) place("nearest", "auto");
    });
    ro.observe(card!);
    ro.observe(sp);
    const timer = setTimeout(stop, FOLLOW_MS);
    for (const ev of ["wheel", "touchstart", "pointerdown", "keydown"])
      sp.addEventListener(ev, stop, { passive: true, once: true });
    signal.addEventListener("abort", stop, { once: true });
  });
  return true;
}

/**
 * 選択の要求（`n` は選ぶたびに増える）ごとに 1 回だけ、コメント一覧がその場にあれば（`enabled`）スクロールする。
 * 一覧が閉じている・別のタブのあいだは待ち、現れたら実行する。ライブ更新で一覧が描き直されても、同じ要求では動かさない。
 */
export function useRevealThread(request: { id: string; n: number } | null, enabled: boolean): void {
  const done = useRef<{ id: string; n: number } | null>(null);
  useEffect(() => {
    if (!request || !enabled || done.current === request) return;
    const ctl = new AbortController();
    void scrollThreadIntoView(request.id, ctl.signal).then((ok) => {
      if (ok) done.current = request;
    });
    return () => ctl.abort();
  }, [request, enabled]);
}
