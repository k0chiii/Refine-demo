import type { ReactNode } from "react";

export interface MentionName {
  name: string;
}

/** メンションされた人の名前に一致する「@名前」の正規表現（長い名前を先に）。人がいなければ null */
export function mentionPattern(users: readonly MentionName[] | undefined): RegExp | null {
  if (!users?.length) return null;
  const names = [...new Set(users.map((u) => u.name))].sort((a, b) => b.length - a.length);
  const escaped = names.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  return new RegExp(`@(?:${escaped.join("|")})`, "g");
}

/** 文字列の中の「@名前」を強調の span に分ける（メンションされた人の名前だけ） */
export function splitMentions(text: string, re: RegExp | null, keyPrefix = ""): ReactNode[] {
  if (!re) return [text];
  const out: ReactNode[] = [];
  let last = 0;
  for (const m of text.matchAll(re)) {
    if (m.index > last) out.push(text.slice(last, m.index));
    out.push(
      <span key={`${keyPrefix}${m.index}`} className="mention">
        {m[0]}
      </span>,
    );
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

/** 本文の「@名前」を強調して描く（メンションされた人の名前だけ） */
export function renderWithMentions(
  body: string,
  users: readonly MentionName[] | undefined,
): ReactNode {
  const re = mentionPattern(users);
  return re ? splitMentions(body, re) : body;
}
