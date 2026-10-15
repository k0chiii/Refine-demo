import { nextStacked } from "./stacked";
import { TouchCommentButton, useTouchSelection } from "./touchSelection";
import type { Anchor } from "@mf100/domain";
import { getSchema, generateJSON } from "@tiptap/core";
import { Node as PMNode } from "@tiptap/pm/model";
import { EditorContent, useEditor } from "@tiptap/react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { documentExtensions } from "@/features/writing/extensions";
import { buildPlainText, offsetToPos, posToOffset } from "@/features/writing/plainText";
import { RangeHighlight, setHighlights, type HighlightRange } from "@/features/writing/plugins";
import type { TextCompareProps } from "@/features/compare/textSync";
import type { OverlayThread } from "./AnchorOverlay";
import type { TextRangeDraft } from "./TextViewer";
import { scrollBehavior } from "@/lib/motion";

type TextThread = OverlayThread & { anchor: Extract<Anchor, { type: "text_range" }> };

/** 提出された HTML（文章エディタの版スナップショット）を平文にする。校正画面の範囲指摘のオフセットはこの平文が基準 */
export function htmlToPlainText(html: string): string {
  const extensions = documentExtensions();
  const schema = getSchema(extensions);
  const doc = PMNode.fromJSON(schema, generateJSON(html, extensions));
  return buildPlainText(doc).text;
}

/**
 * 書式付き文章のビューア（文章エディタから提出された版）。見た目は書いたときと同じで、操作は TextViewer と同じ:
 * 文字を選ぶと範囲指摘の下書き、指摘の範囲は強調と番号、押すとその指摘へ。
 * - 表示は文章エディタと同じスキーマで読み込むので、HTML に未知の要素（script やイベント属性）があっても表示されない
 * - 保存値は平文の [start, end)（htmlToPlainText と同じ数え方）。版ごとに不変
 */
export function RichTextViewer({
  html,
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
}: TextCompareProps & {
  html: string;
  artifactId: string;
  threads: OverlayThread[];
  activeThreadId: string | null;
  onSelectThread: (id: string) => void;
  selecting: boolean;
  /** 表示倍率（ピンチ・拡大ボタン）。CSS の zoom で本文だけを拡大し、位置の計算は変えない */
  scale?: number;
  draft: TextRangeDraft | null;
  onDraft: (d: TextRangeDraft | null) => void;
  inPage?: ReactNode;
  renderGutter?: (positions: Map<string, number>, height: number) => ReactNode;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const programmatic = useRef(0);
  const [positions, setPositions] = useState<Map<string, number>>(new Map());
  const [height, setHeight] = useState(0);
  const editor = useEditor(
    {
      extensions: [...documentExtensions(), RangeHighlight],
      content: html,
      editable: false,
      editorProps: {
        attributes: {
          class: "doc doc--view",
          "aria-label": "校正対象の文章",
        },
      },
    },
    [html],
  );
  const mine = useMemo(
    () =>
      threads.filter(
        (t): t is TextThread =>
          t.anchor.type === "text_range" && t.anchor.artifactId === artifactId,
      ),
    [threads, artifactId],
  );

  // 指摘の範囲と下書き範囲を強調する
  const key = `${mine.map((t) => `${t.id}:${t.anchor.start}-${t.anchor.end}:${t.severity}`).join("|")}|${activeThreadId}|${draft?.start}-${draft?.end}|${(diff ?? []).map((d) => `${d.kind}${d.start}-${d.end}`).join(",")}`;
  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    const doc = editor.state.doc;
    const index = buildPlainText(doc);
    const size = doc.content.size;
    const ranges: HighlightRange[] = mine.map((t) => ({
      from: offsetToPos(index, t.anchor.start, size),
      to: offsetToPos(index, t.anchor.end, size),
      className: [
        "text-anchor",
        t.id === activeThreadId ? "text-anchor--active" : "",
        t.severity === "critical" ? "text-anchor--critical" : "",
      ]
        .filter(Boolean)
        .join(" "),
      attrs: { "data-thread": t.id, title: `コメント #${t.index}` },
      badge: String(t.index),
    }));
    if (draft)
      ranges.push({
        from: offsetToPos(index, draft.start, size),
        to: offsetToPos(index, draft.end, size),
        className: "text-anchor text-anchor--draft",
      });
    for (const d of diff ?? []) {
      if (d.kind === "change") continue;
      ranges.push({
        from: offsetToPos(index, d.start, size),
        to: offsetToPos(index, d.end, size),
        className: `diff-hl diff-hl--${d.kind}`,
      });
    }
    setHighlights(editor, ranges);
  }, [editor, key]);

  useEffect(() => {
    if (!activeThreadId || !wrapRef.current) return;
    wrapRef.current
      .querySelector(`[data-thread~="${CSS.escape(activeThreadId)}"]`)
      ?.scrollIntoView({ block: "center", behavior: scrollBehavior() });
  }, [activeThreadId]);

  // 各指摘の先頭の縦位置（「ピンの高さに並べる」用）
  useLayoutEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap || !editor || editor.isDestroyed) return;
    const measure = () => {
      const base = wrap.getBoundingClientRect();
      const index = buildPlainText(editor.state.doc);
      const size = editor.state.doc.content.size;
      const next = new Map<string, number>();
      for (const t of mine) {
        try {
          const c = editor.view.coordsAtPos(offsetToPos(index, t.anchor.start, size));
          next.set(t.id, c.top - base.top);
        } catch {
          // 位置が文書外（版が壊れている等）は並べない
        }
      }
      setPositions(next);
      setHeight(wrap.offsetHeight);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(wrap);
    return () => ro.disconnect();
  }, [editor, key]);

  if (controller)
    controller.current = {
      stage: () => stageRef.current,
      markProgrammatic: () => {
        programmatic.current = performance.now();
      },
      yOf: (offset) => {
        const stage = stageRef.current;
        if (!stage || !editor || editor.isDestroyed) return null;
        try {
          const index = buildPlainText(editor.state.doc);
          const c = editor.view.coordsAtPos(
            offsetToPos(index, offset, editor.state.doc.content.size),
          );
          return c.top - stage.getBoundingClientRect().top + stage.scrollTop;
        } catch {
          return null;
        }
      },
    };

  /** いまの選択を本文の位置に直す（本文の外・空なら null） */
  const computeSelection = useCallback((): TextRangeDraft | null => {
    if (!selecting || !editor || !wrapRef.current) return null;
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return null;
    const range = sel.getRangeAt(0);
    const dom = editor.view.dom;
    if (!dom.contains(range.startContainer) || !dom.contains(range.endContainer)) return null;
    let from: number;
    let to: number;
    try {
      from = editor.view.posAtDOM(range.startContainer, range.startOffset);
      to = editor.view.posAtDOM(range.endContainer, range.endOffset);
    } catch {
      return null;
    }
    const index = buildPlainText(editor.state.doc);
    const start = posToOffset(index, Math.min(from, to));
    const end = posToOffset(index, Math.max(from, to));
    if (end <= start) return null;
    const r = range.getBoundingClientRect();
    const base = wrapRef.current.getBoundingClientRect();
    return {
      start,
      end,
      box: { x: r.left - base.left, y: r.top - base.top, w: r.width, h: r.height },
    };
  }, [selecting, editor]);

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
        <div
          className="text-viewer__wrap rich-viewer__wrap"
          ref={wrapRef}
          onMouseUp={readSelection}
          onKeyUp={readSelection}
          onClick={(e) => {
            // 重なった範囲は入れ子の装飾になるので、押した位置を含むコメントをすべて集め、押すたびに次へ
            const ids: string[] = [];
            for (
              let el = (e.target as HTMLElement).closest<HTMLElement>("[data-thread]");
              el;
              el = el.parentElement?.closest<HTMLElement>("[data-thread]") ?? null
            )
              for (const id of el.dataset.thread?.split(" ") ?? [])
                if (id && !ids.includes(id)) ids.push(id);
            const id = nextStacked(ids, activeThreadId);
            if (id) onSelectThread(id);
          }}
        >
          <div className="write__page rich-viewer__page" style={{ zoom: scale }}>
            <EditorContent editor={editor} />
          </div>
          {inPage}
        </div>
        {renderGutter ? renderGutter(positions, height) : null}
      </div>
    </div>
  );
}
