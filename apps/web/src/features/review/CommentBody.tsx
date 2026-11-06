import type { CommentBodyFormat } from "@mf100/domain";
import { Marked, type Token, type Tokens } from "marked";
import { Fragment, useMemo, type ReactNode } from "react";
import { mentionPattern, splitMentions, type MentionName } from "./mentionText";

/*
 * コメント・返信・訂正の履歴の本文を描く。
 * - 書式が markdown: marked の字句（lexer）から React の要素を組む。HTML 文字列は作らず（dangerouslySetInnerHTML は使わない）、
 *   本文に書かれた生の HTML（<script> など）は解釈せず、書かれたとおりの文字で出す。
 * - 書式なし（旧来の平文）: 記号は解釈せず、URL だけをリンクにする。
 * リンクは http・https・mailto だけ（それ以外は文字のまま）。本文中の URL は自動でリンクにする。
 * 「@名前」はメンションされた人のものだけ強調する。
 */

const marked = new Marked({ gfm: true, breaks: true });
// 本文中の URL は下の linkify で自動リンクにする（日本語の句読点・括弧の直前で切るため、marked の自動リンクは使わない）
marked.use({ tokenizer: { url: () => undefined } });

/** リンクにしてよい URL か。許す種類は http・https・mailto。正規化した URL を返す（それ以外は null） */
export function safeHref(href: string): string | null {
  let u: URL;
  try {
    u = new URL(href.trim());
  } catch {
    return null;
  }
  return u.protocol === "http:" || u.protocol === "https:" || u.protocol === "mailto:"
    ? u.href
    : null;
}

const BARE_URL = /https?:\/\/[^\s<>"'`　、。，．！？「」『』（）]+/g;
const TRAILING = /[.,;:!?'"*_~]$/;

/** 文中の URL（http・https）の位置。末尾の句読点・対にならない閉じ括弧は URL に含めない */
export function findUrls(text: string): Array<{ start: number; end: number }> {
  const out: Array<{ start: number; end: number }> = [];
  for (const m of text.matchAll(BARE_URL)) {
    let url = m[0];
    for (;;) {
      if (TRAILING.test(url)) url = url.slice(0, -1);
      else if (url.endsWith(")") && count(url, "(") < count(url, ")")) url = url.slice(0, -1);
      else if (url.endsWith("]") && count(url, "[") < count(url, "]")) url = url.slice(0, -1);
      else break;
    }
    if (/^https?:\/\/[^/?#]+/.test(url) && safeHref(url))
      out.push({ start: m.index, end: m.index + url.length });
  }
  return out;
}

function count(s: string, ch: string): number {
  let n = 0;
  for (const c of s) if (c === ch) n++;
  return n;
}

const stop = (e: { stopPropagation: () => void }) => e.stopPropagation();

function Link({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a
      className="comment-body__link"
      href={href}
      target="_blank"
      rel="noopener noreferrer nofollow"
      // カード全体の「選ぶ」へ伝えない（リンクを開くだけ）
      onClick={stop}
    >
      {children}
    </a>
  );
}

interface Ctx {
  mentions: RegExp | null;
  /** リンクの文字の中（URL をもう一度リンクにしない） */
  inLink?: boolean;
}

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

/**
 * marked は本文の文字を HTML として扱うので、&lt; &amp; のような文字参照は作られたまま字句に残る（入力欄の書き出しも < を &lt; にする）。
 * 画面には文字として出すので、ここで元の文字に戻す（HTML として解釈はしない）
 */
export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const code =
        e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff)
        ? String.fromCodePoint(code)
        : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

/** 文字列 → 自動リンク + メンションの強調 */
function textNodes(text: string, ctx: Ctx, key: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  for (const { start, end } of ctx.inLink ? [] : findUrls(text)) {
    if (start > last)
      out.push(...splitMentions(text.slice(last, start), ctx.mentions, `${key}m${last}`));
    const url = text.slice(start, end);
    out.push(
      <Link key={`${key}u${start}`} href={safeHref(url)!}>
        {url}
      </Link>,
    );
    last = end;
  }
  if (last < text.length)
    out.push(...splitMentions(text.slice(last), ctx.mentions, `${key}m${last}`));
  return out;
}

function inlines(tokens: readonly Token[] | undefined, ctx: Ctx, key = ""): ReactNode[] {
  return (tokens ?? []).map((t, i) => {
    const k = `${key}${i}`;
    return <Fragment key={k}>{inline(t, ctx, k)}</Fragment>;
  });
}

function inline(t: Token, ctx: Ctx, key: string): ReactNode {
  switch (t.type) {
    case "text": {
      const x = t as Tokens.Text;
      return x.tokens ? inlines(x.tokens, ctx, key) : textNodes(decodeEntities(x.text), ctx, key);
    }
    case "escape":
      return decodeEntities((t as Tokens.Escape).text);
    case "strong":
      return <strong>{inlines((t as Tokens.Strong).tokens, ctx, key)}</strong>;
    case "em":
      return <em>{inlines((t as Tokens.Em).tokens, ctx, key)}</em>;
    case "del":
      return <del>{inlines((t as Tokens.Del).tokens, ctx, key)}</del>;
    case "codespan":
      return <code>{(t as Tokens.Codespan).text}</code>;
    case "br":
      return <br />;
    case "link": {
      const x = t as Tokens.Link;
      const href = safeHref(x.href);
      const children = inlines(x.tokens, { ...ctx, inLink: true }, key);
      // 許さない種類のリンクは、書かれた文字だけを出す（リンクにしない）
      return href ? <Link href={href}>{children}</Link> : children;
    }
    case "image":
      return (t as Tokens.Image).text;
    default:
      // html（生の HTML）などは解釈せず、書かれたとおりの文字で出す
      return (t as { raw: string }).raw;
  }
}

function blocks(tokens: readonly Token[] | undefined, ctx: Ctx, key = ""): ReactNode[] {
  return (tokens ?? []).map((t, i) => {
    const k = `${key}${i}`;
    return <Fragment key={k}>{block(t, ctx, k)}</Fragment>;
  });
}

function block(t: Token, ctx: Ctx, key: string): ReactNode {
  switch (t.type) {
    case "space":
    case "def":
      return null;
    case "paragraph":
      return <p>{inlines((t as Tokens.Paragraph).tokens, ctx, key)}</p>;
    case "text": {
      // 箇条書きの項目の中の文（段落にしない）
      const x = t as Tokens.Text;
      return x.tokens ? inlines(x.tokens, ctx, key) : textNodes(decodeEntities(x.text), ctx, key);
    }
    case "heading":
      // 入力欄は見出しを作らない。他で書かれた見出しは太字の段落として出す（見出しの大きさでカードを崩さない）
      return (
        <p>
          <strong>{inlines((t as Tokens.Heading).tokens, ctx, key)}</strong>
        </p>
      );
    case "code":
      return (
        <pre>
          <code>{(t as Tokens.Code).text}</code>
        </pre>
      );
    case "blockquote":
      return <blockquote>{blocks((t as Tokens.Blockquote).tokens, ctx, key)}</blockquote>;
    case "list": {
      const x = t as Tokens.List;
      const items = x.items.map((item, i) => (
        <li key={i}>
          {item.task ? (
            <span className="comment-body__task">{item.checked ? "☑ " : "☐ "}</span>
          ) : null}
          {blocks(item.tokens, ctx, `${key}.${i}.`)}
        </li>
      ));
      return x.ordered ? (
        <ol start={typeof x.start === "number" ? x.start : 1}>{items}</ol>
      ) : (
        <ul>{items}</ul>
      );
    }
    case "hr":
      return <hr />;
    default:
      // html・table など: 解釈せず、書かれたとおりの文字で出す
      return <p>{(t as { raw: string }).raw.trim()}</p>;
  }
}

/**
 * 旧来の平文の本文を、入力欄に Markdown として読み込める形にする（平文のコメントを訂正するとき）。
 * 記号は打ち消し、改行は改行のまま保つ（Markdown の記号として解釈されない）。
 */
export function plainToMarkdown(text: string): string {
  const lines = text
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/([\\`*_{}[\]()#+\-.!~<>|&])/g, "\\$1"));
  // 続く行は Markdown の改行（行末の空白 2 つ）で保つ。空行は段落の区切り
  return lines
    .map((line, i) =>
      i === lines.length - 1
        ? line
        : line === "" || lines[i + 1] === ""
          ? `${line}\n`
          : `${line}  \n`,
    )
    .join("");
}

/** 旧来の平文: 改行はそのまま（CSS の pre-wrap）、URL だけリンクにする */
function plain(body: string, ctx: Ctx): ReactNode[] {
  return textNodes(body, ctx, "p");
}

export function CommentBody({
  body,
  format,
  mentionUsers,
  className,
}: {
  body: string;
  /** 本文の書式。無ければ旧来の平文 */
  format?: CommentBodyFormat | undefined;
  /** 本文でメンションされた人（強調する名前） */
  mentionUsers?: readonly MentionName[] | undefined;
  className?: string;
}) {
  const names = mentionUsers;
  const content = useMemo(() => {
    const ctx: Ctx = { mentions: mentionPattern(names) };
    return format === "markdown" ? blocks(marked.lexer(body), ctx) : plain(body, ctx);
  }, [body, format, names]);
  return (
    <div
      className={`comment-body ${format === "markdown" ? "" : "comment-body--plain"} ${className ?? ""}`}
    >
      {content}
    </div>
  );
}
