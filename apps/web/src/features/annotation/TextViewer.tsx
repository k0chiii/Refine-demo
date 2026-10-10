import type { Anchor } from "@mf100/domain";
import { useEffect, useRef } from "react";
import type { OverlayThread } from "./AnchorOverlay";

export interface TextRangeDraft {
  start: number;
  end: number;
}

interface Props {
  /** 版スナップショットの本文（添付テキストをそのまま） */
  text: string;
  artifactId: string;
  threads: OverlayThread[];
  activeThreadId: string | null;
  onSelectThread: (id: string) => void;
  selecting: boolean;
  draft: TextRangeDraft | null;
  onDraft: (d: TextRangeDraft | null) => void;
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
  draft,
  onDraft,
}: Props) {
  const bodyRef = useRef<HTMLPreElement>(null);
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

  const readSelection = () => {
    if (!selecting || !bodyRef.current) return;
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return;
    const range = sel.getRangeAt(0);
    const body = bodyRef.current;
    if (!body.contains(range.startContainer) || !body.contains(range.endContainer)) return;
    const pre = document.createRange();
    pre.setStart(body, 0);
    pre.setEnd(range.startContainer, range.startOffset);
    const start = pre.toString().length;
    pre.setEnd(range.endContainer, range.endOffset);
    const end = pre.toString().length;
    if (end > start) onDraft({ start, end });
  };

  return (
    <div className="viewer text-viewer">
      <div className="viewer__toolbar" role="toolbar" aria-label="文章操作">
        <span className="small muted">{text.length.toLocaleString("ja-JP")} 文字</span>
        {selecting ? <span className="chip chip--warn">本文をドラッグして範囲を指定</span> : null}
        <span className="small muted">
          文章の共同編集はこのシステムでは行いません（版スナップショットの閲覧・範囲指摘のみ）
        </span>
      </div>
      <div className="viewer__stage">
        <pre
          ref={bodyRef}
          className="text-viewer__body"
          aria-label="校正対象の文章"
          onMouseUp={readSelection}
          onKeyUp={readSelection}
        >
          {segments.map((seg) => {
            const first = seg.threads.filter((t) => t.anchor.start === seg.start);
            const active = seg.threads.some((t) => t.id === activeThreadId);
            const severity = seg.threads.find((t) => t.severity === "critical")
              ? "critical"
              : seg.threads.find((t) => t.severity === "major")
                ? "major"
                : "";
            const label = first.map((t) => t.index).join(",");
            const cls = [
              seg.threads.length > 0 ? "text-anchor" : "",
              active ? "text-anchor--active" : "",
              severity ? `text-anchor--${severity}` : "",
              seg.draft ? "text-anchor--draft" : "",
            ]
              .filter(Boolean)
              .join(" ");
            const content = text.slice(seg.start, seg.end);
            if (!cls) return <span key={seg.start}>{content}</span>;
            return (
              <span
                key={seg.start}
                className={cls}
                data-thread={seg.threads.map((t) => t.id).join(" ")}
                {...(label ? { "data-index": label } : {})}
                {...(seg.threads.length > 0
                  ? {
                      role: "button",
                      tabIndex: 0,
                      title: `指摘 ${seg.threads.map((t) => `#${t.index}`).join(" ")}`,
                      onClick: (e: { stopPropagation: () => void }) => {
                        e.stopPropagation();
                        onSelectThread(seg.threads[0]!.id);
                      },
                      onKeyDown: (e: { key: string }) =>
                        e.key === "Enter" && onSelectThread(seg.threads[0]!.id),
                    }
                  : {})}
              >
                {content}
              </span>
            );
          })}
        </pre>
      </div>
    </div>
  );
}
