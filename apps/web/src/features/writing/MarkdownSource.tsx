import type { Editor } from "@tiptap/core";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type MutableRefObject,
} from "react";
import { M3eIcon } from "@m3e/react/icon";
import { jsonToMarkdown, markdownToJson } from "./markdown";
import { hasUnrepresentableFormatting } from "./markdownFidelity";

/** 入力が止まってからエディタへ反映するまでの待ち */
export const SOURCE_DEBOUNCE_MS = 500;

/**
 * 文章エディタの原文（Markdown）。紙面の場所に Markdown を直接書く。
 *
 * エディタへの反映（setContent）は、入力が止まって SOURCE_DEBOUNCE_MS たったときと、呼び出し側が applyRef.current() を呼んだとき
 * （プレビューへ戻る・版として提出・書き出し）。反映するのは「前回そろえた Markdown と違うとき」だけで、
 * 原文を書き換えなければエディタの中身には触らない（Markdown で表せない既存の色などを消さないため）。
 * 反映は通常の変更として自動保存・共同編集に乗り、プレビューに戻ってからの元に戻すで 1 回分として戻せる。
 * 原文を書き換えていないあいだに別の人が文章を変えたら、原文もその内容に入れ替える
 */
export function MarkdownSource({
  editor,
  applyRef,
  onEdit,
  onSave,
  onPrint,
}: {
  editor: Editor;
  /** 未反映の原文を今すぐエディタへ入れる口（描画のあいだだけ入る） */
  applyRef: MutableRefObject<(() => void) | null>;
  /** 原文を打ったとき（自動保存の「未保存」にする） */
  onEdit: () => void;
  onSave: () => void;
  onPrint: () => void;
}) {
  const [text, setText] = useState(() => jsonToMarkdown(editor.getJSON()));
  // 開いた時点の文章に、Markdown で表せない書式が入っているか（原文で書き換えると消えるので知らせる）
  const [lossy] = useState(() => hasUnrepresentableFormatting(editor.getJSON()));
  const latest = useRef(text);
  const synced = useRef(text);
  const applying = useRef(false);
  const timer = useRef<number | undefined>(undefined);
  const area = useRef<HTMLTextAreaElement | null>(null);

  const apply = useCallback(() => {
    window.clearTimeout(timer.current);
    if (editor.isDestroyed || latest.current === synced.current) return;
    synced.current = latest.current;
    applying.current = true;
    try {
      editor.commands.setContent(markdownToJson(latest.current));
    } finally {
      applying.current = false;
    }
  }, [editor]);

  useEffect(() => {
    applyRef.current = apply;
    return () => {
      apply();
      applyRef.current = null;
    };
  }, [apply, applyRef]);

  useEffect(() => {
    const onUpdate = () => {
      if (applying.current || latest.current !== synced.current) return;
      const next = jsonToMarkdown(editor.getJSON());
      if (next === synced.current) return;
      synced.current = latest.current = next;
      setText(next);
    };
    editor.on("update", onUpdate);
    return () => {
      editor.off("update", onUpdate);
    };
  }, [editor]);

  // 内容に合わせて高さを伸ばす（幅が変わって折り返しが変わったときも）
  const fit = useCallback(() => {
    const el = area.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, []);
  useLayoutEffect(fit, [text, fit]);
  useEffect(() => {
    const el = area.current;
    if (!el) return;
    let width = el.clientWidth;
    const ro = new ResizeObserver(() => {
      if (el.clientWidth === width) return;
      width = el.clientWidth;
      fit();
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [fit]);

  return (
    <div className="msrc">
      {lossy ? (
        <p className="msrc__note" role="note">
          <M3eIcon name="info" aria-hidden="true" />
          <span>
            文字の色・揃え・上付き/下付きは原文では表せません。原文で書き換えると、それらの書式は消えます
          </span>
        </p>
      ) : null}
      <textarea
        ref={area}
        className="msrc__area"
        aria-label="Markdown の原文"
        spellCheck={false}
        lang="ja"
        value={text}
        onChange={(e) => {
          latest.current = e.target.value;
          setText(e.target.value);
          window.clearTimeout(timer.current);
          timer.current = window.setTimeout(apply, SOURCE_DEBOUNCE_MS);
          onEdit();
        }}
        onKeyDown={(e) => {
          if (!(e.metaKey || e.ctrlKey)) return;
          const key = e.key.toLowerCase();
          if (key === "s") {
            e.preventDefault();
            apply();
            onSave();
          } else if (key === "p") {
            e.preventDefault();
            onPrint();
          }
        }}
      />
    </div>
  );
}
