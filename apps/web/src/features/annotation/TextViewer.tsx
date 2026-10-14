import { nextStacked } from "./stacked";
import { TouchCommentButton, useTouchSelection } from "./touchSelection";
import type { Anchor } from "@mf100/domain";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { diffKindAt, type TextCompareProps } from "@/features/compare/textSync";
import type { OverlayThread } from "./AnchorOverlay";

export interface TextRangeDraft {
  start: number;
  end: number;
  /** 選択範囲の表示位置（本文コンテナ基準 px）。投稿欄をそのそばに出すために使う */
  box?: { x: number; y: number; w: number; h: number };
}

interface Props extends TextCompareProps {
  /** 版スナップショットの本文（添付テキストをそのまま） */
  text: string;
  artifactId: string;
  threads: OverlayThread[];
  activeThreadId: string | null;
  onSelectThread: (id: string) => void;
  selecting: boolean;
  /** 表示倍率（ピンチ・拡大ボタン）。CSS の zoom で本文だけを拡大し、位置の計算は変えない */
  scale?: number;
  draft: TextRangeDraft | null;
  onDraft: (d: TextRangeDraft | null) => void;
  /** 本文の上に重ねるもの（投稿欄など。座標は本文コンテナ基準） */
  inPage?: ReactNode;
  /** 本文の右に並べるもの。各スレッドの縦位置（本文コンテナ基準 px）を渡す */
  renderGutter?: (positions: Map<string, number>, height: number) => ReactNode;
}

type TextThread = OverlayThread & { anchor: Extract<Anchor, { type: "text_range" }> };
type Segment = { start: number; end: number; threads: TextThread[]; draft: boolean };

/**
 * 文章ビューア（F-12 前倒し分: 版スナップショットの閲覧と範囲指摘）。
 * - 本文は読み取り専用。DOM のテキストはスナップショットと 1:1（番号バッジは CSS で描く）なので、
 *   選択範囲 → 文字オフセットの変換が表示状態に依存しない。
 * - 保存値は [start, end) の文字オフセット（版ごとに不変）。
 */
export function TextViewer({
  text,
  artifactId,
  threads,
  activeThreadId,
  onSelectThread,
  selecting,
  scale = 1,
  draft,
  onDraft,
  inPage,
  renderGutter,
  diff,
  controller,
  onUserScroll,
}: Props) {
  const bodyRef = useRef<HTMLPreElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const programmatic = useRef(0);
  if (controller)
    controller.current = {
      stage: () => stageRef.current,
      markProgrammatic: () => {
        programmatic.current = performance.now();
      },
      yOf: (offset) => {
        const stage = stageRef.current;
        const body = bodyRef.current;
        if (!stage || !body) return null;
        for (const el of body.querySelectorAll<HTMLElement>("[data-start]")) {
          const st = Number(el.dataset.start);
          const en = Number(el.dataset.end);
          if (offset >= st && offset < en)
            return (
              el.getBoundingClientRect().top - stage.getBoundingClientRect().top + stage.scrollTop
            );
        }
        return null;
      },
    };
  const wrapRef = useRef<HTMLDivElement>(null);
  const [positions, setPositions] = useState<Map<string, number>>(new Map());
  const [height, setHeight] = useState(0);
  const mine = threads.filter(
    (t): t is TextThread => t.anchor.type === "text_range" && t.anchor.artifactId === artifactId,
  );

  // 境界を集めてセグメント化（重なりは複数スレッドを持つセグメントとして表す）
  const bounds = new Set<number>([0, text.length]);
  for (const t of mine) {
    bounds.add(Math.min(t.anchor.start, text.length));
    bounds.add(Math.min(t.anchor.end, text.length));
  }
  if (draft) {
    bounds.add(draft.start);
    bounds.add(draft.end);
  }
  for (const d of diff ?? []) {
    if (d.kind === "change") continue;
    bounds.add(Math.min(d.start, text.length));
    bounds.add(Math.min(d.end, text.length));
  }
  const points = [...bounds].sort((a, b) => a - b);
  const segments: Segment[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const start = points[i]!;
    const end = points[i + 1]!;
    if (end <= start) continue;
    segments.push({
      start,
      end,
      threads: mine.filter((t) => t.anchor.start <= start && t.anchor.end >= end),
      draft: draft !== null && draft.start <= start && draft.end >= end,
    });
  }

  useEffect(() => {
    if (!activeThreadId || !bodyRef.current) return;
    bodyRef.current
      .querySelector(`[data-thread~="${CSS.escape(activeThreadId)}"]`)
      ?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [activeThreadId]);

  // 各スレッドの先頭セグメントの縦位置を測る（整列レイアウト用）
  const key = mine.map((t) => `${t.id}:${t.anchor.start}`).join("|");
  useLayoutEffect(() => {
    const wrap = wrapRef.current;
    const body = bodyRef.current;
    if (!wrap || !body) return;
    const measure = () => {
      const base = wrap.getBoundingClientRect();
      const next = new Map<string, number>();
      for (const t of mine) {
        const el = body.querySelector(`[data-thread~="${CSS.escape(t.id)}"]`);
        if (el) next.set(t.id, el.getBoundingClientRect().top - base.top);
      }
      setPositions(next);
      setHeight(wrap.offsetHeight);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(wrap);
    return () => ro.disconnect();
  }, [key, text]);

  /** いまの選択を本文の位置に直す（本文の外・空なら null） */
  const computeSelection = useCallback((): TextRangeDraft | null => {
    if (!selecting || !bodyRef.current || !wrapRef.current) return null;
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return null;
    const range = sel.getRangeAt(0);
    const body = bodyRef.current;
    if (!body.contains(range.startContainer) || !body.contains(range.endContainer)) return null;
    const pre = document.createRange();
    pre.setStart(body, 0);
    pre.setEnd(range.startContainer, range.startOffset);
    const start = pre.toString().length;
    pre.setEnd(range.endContainer, range.endOffset);
    const end = pre.toString().length;
    if (end <= start) return null;
    const r = range.getBoundingClientRect();
    const base = wrapRef.current.getBoundingClientRect();
    return {
      start,
      end,
      box: { x: r.left - base.left, y: r.top - base.top, w: r.width, h: r.height },
    };
  }, [selecting]);

  const touchSel = useTouchSelection(selecting, computeSelection);
  const readSelection = () => {
    // 指の操作では選び終えた合図が取れないので、ボタン（TouchCommentButton）で確定する
    if (touchSel.touch) return;
    const d = computeSelection();
    if (d) onDraft(d);
  };
  const commitTouch = () => {
    const d = touchSel.candidate;
    touchSel.clear();
    window.getSelection()?.removeAllRanges();
    if (d) onDraft(d);
  };

  return (
    <div className="viewer text-viewer">
      {touchSel.candidate ? <TouchCommentButton onCommit={commitTouch} /> : null}
      <div
        className="viewer__stage"
        tabIndex={0}
        ref={stageRef}
        onScroll={() => {
          if (onUserScroll && performance.now() - programmatic.current > 120) onUserScroll();
        }}
      >
        <div className="text-viewer__wrap" ref={wrapRef}>
          <pre
            ref={bodyRef}
            className="text-viewer__body"
            style={{ zoom: scale }}
            aria-label="校正対象の文章"
            onMouseUp={readSelection}
            onKeyUp={readSelection}
          >
            {segments.map((seg) => {
              const first = seg.threads.filter((t) => t.anchor.start === seg.start);
              const active = seg.threads.some((t) => t.id === activeThreadId);
              const severity = seg.threads.find((t) => t.severity === "critical") ? "critical" : "";
              const label = first.map((t) => t.index).join(",");
              const cls = [
                seg.threads.length > 0 ? "text-anchor" : "",
                active ? "text-anchor--active" : "",
                severity ? `text-anchor--${severity}` : "",
                seg.draft ? "text-anchor--draft" : "",
                diffKindAt(diff, seg.start, seg.end)
                  ? `diff-hl diff-hl--${diffKindAt(diff, seg.start, seg.end)}`
                  : "",
              ]
                .filter(Boolean)
                .join(" ");
              const content = text.slice(seg.start, seg.end);
              if (!cls)
                return (
                  <span key={seg.start} data-start={seg.start} data-end={seg.end}>
                    {content}
                  </span>
                );
              return (
                <span
                  key={seg.start}
                  data-start={seg.start}
                  data-end={seg.end}
                  className={cls}
                  data-thread={seg.threads.map((t) => t.id).join(" ")}
                  {...(label ? { "data-index": label } : {})}
                  {...(seg.threads.length > 0
                    ? {
                        role: "button",
                        tabIndex: 0,
                        title: `指摘 ${seg.threads.map((t) => `#${t.index}`).join(" ")}`,
                        // 同じ箇所に複数あれば押すたびに次のコメントへ
                        onClick: (e: { stopPropagation: () => void }) => {
                          e.stopPropagation();
                          const id = nextStacked(
                            seg.threads.map((t) => t.id),
                            activeThreadId,
                          );
                          if (id) onSelectThread(id);
                        },
                        onKeyDown: (e: { key: string }) => {
                          if (e.key !== "Enter") return;
                          const id = nextStacked(
                            seg.threads.map((t) => t.id),
                            activeThreadId,
                          );
                          if (id) onSelectThread(id);
                        },
                      }
                    : {})}
                >
                  {content}
                </span>
              );
            })}
          </pre>
          {inPage}
        </div>
        {renderGutter ? renderGutter(positions, height) : null}
      </div>
    </div>
  );
}
