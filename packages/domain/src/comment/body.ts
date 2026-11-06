import { DomainError } from "../shared/DomainError.ts";

/**
 * コメント・返信・訂正の本文の書式。
 * - 無い（undefined）: 旧来の平文（改行は保つ。Markdown としては読まない）。保存済みの行はすべてこれ（移行しない）
 * - "markdown": Markdown（Web の入力欄が書き出す。太字・リスト・引用・コード・リンクなど）
 * 書式は本文と対にして保存する（スレッド・返信イベント・訂正イベント）。
 */
export const commentBodyFormats = ["markdown"] as const;
export type CommentBodyFormat = (typeof commentBodyFormats)[number];

/** 本文の長さの上限（文字数。FB と同じ。利用者決定 2026-10-20: コメントと FB を 1 つに統合する） */
export const COMMENT_BODY_MAX = 5000;

export function isCommentBodyFormat(value: unknown): value is CommentBodyFormat {
  return typeof value === "string" && (commentBodyFormats as readonly string[]).includes(value);
}

/** 書式の指定を検査する。無ければ旧来の平文（undefined）。知らない書式は comment_body_format_invalid */
export function validateCommentBodyFormat(
  format: string | undefined,
): CommentBodyFormat | undefined {
  if (format === undefined) return undefined;
  if (!isCommentBodyFormat(format))
    throw new DomainError("comment_body_format_invalid", { format, allowed: commentBodyFormats });
  return format;
}

/** 本文の長さ（上限を超えたら comment_body_too_long）。サロゲートペアは 1 文字と数える */
export function assertCommentBodyLength(body: string): void {
  const length = Array.from(body).length;
  if (length > COMMENT_BODY_MAX)
    throw new DomainError("comment_body_too_long", { max: COMMENT_BODY_MAX, length });
}

/** 投稿・返信・訂正の本文と書式を検査し、保存する書式（無ければ undefined）を返す */
export function validateCommentBody(
  body: string,
  format: string | undefined,
): CommentBodyFormat | undefined {
  const checked = validateCommentBodyFormat(format);
  assertCommentBodyLength(body);
  return checked;
}

/**
 * 本文を、書式の記号を除いた平文にする（通知の抜粋・端末の通知に使う）。
 * 旧来の平文はそのまま。Markdown は、太字・斜体・取り消し線・コードの記号、見出し・引用・箇条書きの行頭、
 * リンク（文字だけ残す）、コードのフェンスを外す。完全な Markdown 処理ではなく、抜粋のための近似。
 */
export function plainTextOf(body: string, format?: CommentBodyFormat): string {
  if (format !== "markdown") return body;
  const lines = body.replace(/\r\n?/g, "\n").split("\n");
  const out: string[] = [];
  let fence: string | null = null;
  for (const line of lines) {
    const open = /^\s*(`{3,}|~{3,})/.exec(line);
    if (fence === null) {
      if (open) {
        fence = open[1]![0]!;
        continue;
      }
    } else {
      if (open && open[1]![0] === fence) fence = null;
      else out.push(line);
      continue;
    }
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) continue;
    out.push(
      inlineText(
        line
          .replace(/^\s{0,3}#{1,6}\s+/, "")
          .replace(/^(\s*>)+\s?/, "")
          .replace(/^\s*(?:[-*+]|\d{1,9}[.)])\s+(?:\[[ xX]\]\s+)?/, ""),
      ),
    );
  }
  return decodeEntities(out.join("\n")).trim();
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

/** Markdown の入力欄は < を &lt; と書き出すので、抜粋では文字に戻す */
function decodeEntities(s: string): string {
  return s.replace(/&(amp|lt|gt|quot|apos|#39);/g, (_, e: string) =>
    e === "#39" ? "'" : (ENTITIES[e] ?? ""),
  );
}

/** バックスラッシュで打ち消した記号は、ほかの記号の処理から守っておき、最後に戻す */
const ESCAPED = /\\([\\`*_{}[\]()#+\-.!~>|<])/g;
const GUARD = /\uE000([0-9a-f]+)\uE001/g;

function inlineText(s: string): string {
  return s
    .replace(ESCAPED, (_, c: string) => `\uE000${c.charCodeAt(0).toString(16)}\uE001`)
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]*)\]\((?:[^()\s]|\([^)]*\))*(?:\s+"[^"]*")?\)/g, "$1")
    .replace(/<((?:https?:\/\/|mailto:)[^>\s]+)>/g, "$1")
    .replace(/(`+)([^`]|[^`][\s\S]*?[^`])\1(?!`)/g, "$2")
    .replace(/(\*\*|__)(?=\S)([\s\S]*?\S)\1/g, "$2")
    .replace(/~~(?=\S)([\s\S]*?\S)~~/g, "$1")
    .replace(/\*(?=\S)([^*]*?\S)\*/g, "$1")
    .replace(/(^|[^\w])_(?=\S)([^_]*?\S)_(?![\w])/g, "$1$2")
    .replace(GUARD, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)));
}
