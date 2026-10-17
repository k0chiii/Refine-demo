import { deadlineFromJst } from "../shared/deadline.ts";
import type { Instant } from "../shared/time.ts";

/**
 * Notion の CSV 書き出しの値の読み方（docs/NOTION_ALIGNMENT.md）。
 * - 日付: 「2026年5月16日」「2026年5月16日 18:00」「May 16, 2026」「May 16, 2026 6:00 PM」「2026-05-16」「2026/5/16 18:00」。
 *   時刻の無い日付はその日の終わり（締切の意味。shared/deadline.ts）。「→」で範囲が書かれていれば終わりの方
 * - チェックボックス: Yes / No（true / false・はい / いいえ・有 / 無・✓ / ✗・1 / 0 も読む）
 * - リレーション: ページの題名の後ろに「 (https://www.notion.so/…)」が付くことがあるので外す。複数は「, 」区切り
 */

const MONTHS: Record<string, number> = {
  january: 1,
  jan: 1,
  february: 2,
  feb: 2,
  march: 3,
  mar: 3,
  april: 4,
  apr: 4,
  may: 5,
  june: 6,
  jun: 6,
  july: 7,
  jul: 7,
  august: 8,
  aug: 8,
  september: 9,
  sep: 9,
  sept: 9,
  october: 10,
  oct: 10,
  november: 11,
  nov: 11,
  december: 12,
  dec: 12,
};

const pad = (n: number | string) => String(n).padStart(2, "0");

/** 時刻の部分「18:00」「6:00 PM」「午後6:00」→ HH:mm。無ければ null、読めなければ undefined */
function parseTime(text: string): string | null | undefined {
  const v = text.trim();
  if (v === "") return null;
  const m = /^(午前|午後)?\s*(\d{1,2}):(\d{2})(?::\d{2})?\s*(AM|PM|am|pm)?$/.exec(v);
  if (!m) return undefined;
  let h = Number(m[2]);
  const min = Number(m[3]);
  const ampm = (m[4] ?? "").toLowerCase() || (m[1] === "午後" ? "pm" : m[1] === "午前" ? "am" : "");
  if (ampm === "pm" && h < 12) h += 12;
  if (ampm === "am" && h === 12) h = 0;
  if (h > 23 || min > 59) return undefined;
  return `${pad(h)}:${pad(min)}`;
}

/**
 * 日付の欄 → 時刻（epoch ms）。空は null、読めなければ undefined。
 * 時刻が無ければその日の終わり（翌日 0:00 JST）、あればその時刻（JST）。
 */
export function parseNotionDate(value: string): Instant | null | undefined {
  let v = value.normalize("NFKC").replace(/\s+/g, " ").trim();
  if (v === "") return null;
  // 範囲「5月1日 → 5月16日」は終わりの方
  if (v.includes("→")) v = v.split("→").pop()!.trim();
  // 「(GMT+9)」などの注記は外す
  v = v.replace(/\s*\([^)]*\)\s*$/, "").trim();

  let date: string | null = null;
  let rest = "";
  let m: RegExpExecArray | null;
  if ((m = /^(\d{4})年(\d{1,2})月(\d{1,2})日(.*)$/.exec(v))) {
    date = `${m[1]}-${pad(m[2]!)}-${pad(m[3]!)}`;
    rest = m[4]!;
  } else if ((m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(.*)$/.exec(v))) {
    date = `${m[1]}-${pad(m[2]!)}-${pad(m[3]!)}`;
    rest = m[4]!.replace(/^T/, " ");
  } else if ((m = /^([A-Za-z]+)\.? (\d{1,2}),? (\d{4})(.*)$/.exec(v))) {
    const month = MONTHS[m[1]!.toLowerCase()];
    if (!month) return undefined;
    date = `${m[3]}-${pad(month)}-${pad(m[2]!)}`;
    rest = m[4]!;
  } else if ((m = /^(\d{1,2}) ([A-Za-z]+)\.? (\d{4})(.*)$/.exec(v))) {
    const month = MONTHS[m[2]!.toLowerCase()];
    if (!month) return undefined;
    date = `${m[3]}-${pad(month)}-${pad(m[1]!)}`;
    rest = m[4]!;
  }
  if (date === null) return undefined;
  const time = parseTime(rest.replace(/^[,、]?\s*/, ""));
  if (time === undefined) return undefined;
  return deadlineFromJst(date, time) ?? undefined;
}

/** チェックボックスの欄 → 真偽。空は null、読めなければ undefined */
export function parseNotionCheckbox(value: string): boolean | null | undefined {
  const v = value.normalize("NFKC").trim().toLowerCase();
  if (v === "") return null;
  if (
    ["yes", "true", "y", "1", "はい", "有", "あり", "○", "✓", "✔", "☑", "x", "checked"].includes(v)
  )
    return true;
  if (
    [
      "no",
      "false",
      "n",
      "0",
      "いいえ",
      "無",
      "なし",
      "×",
      "✗",
      "☐",
      "unchecked",
      "-",
      "—",
    ].includes(v)
  )
    return false;
  return undefined;
}

/** リレーションの欄の 1 つ「題名 (https://www.notion.so/…)」→ 題名 */
export function stripNotionLink(value: string): string {
  return value
    .replace(/\s*\((?:https?:\/\/)?(?:www\.)?notion\.(?:so|site)\/[^)]*\)\s*$/i, "")
    .replace(/\s*<?(?:https?:\/\/)?(?:www\.)?notion\.(?:so|site)\/\S*>?\s*$/i, "")
    .trim();
}

/**
 * 複数の値の欄を分ける。「;」「、」「,」（全角も）・改行で区切り、Notion のリンクを外し、空と重なりを除く。
 * 括弧の中の「,」（「印刷物（紙, ビラ）」など）では分けない
 */
export function splitNotionList(value: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let cur = "";
  for (const ch of value) {
    if (ch === "(" || ch === "（") depth++;
    else if (ch === ")" || ch === "）") depth = Math.max(0, depth - 1);
    if (depth === 0 && /[;；、,，\n]/.test(ch)) {
      parts.push(cur);
      cur = "";
      continue;
    }
    cur += ch;
  }
  parts.push(cur);
  const out: string[] = [];
  for (const p of parts) {
    const t = stripNotionLink(p.trim());
    if (t !== "" && !out.includes(t)) out.push(t);
  }
  return out;
}
