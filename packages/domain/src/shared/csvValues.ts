import { deadlineFromJst } from "./deadline.ts";
import type { Instant } from "./time.ts";

/**
 * CSV（一括登録）のセルの読み方。制作物の CSV（work/bulkImport.ts）と担当の CSV（org/team.ts）で共通。
 * アプリ自身の雛形を読むためのもので、外部ツールの書き出しの形は特別扱いしない。
 */

const pad = (n: string) => n.padStart(2, "0");

/**
 * 日付の欄 → 時刻（epoch ms）。2026-11-14・2026/11/14・2026.11.14 と、時刻付き「2026-11-14 18:00」「2026-11-14T18:00」。
 * 時刻が無ければその日の終わり（締切の意味。shared/deadline.ts）。空は null、読めなければ undefined
 */
export function parseCsvDateTime(value: string): Instant | null | undefined {
  const v = value.normalize("NFKC").replace(/\s+/g, " ").trim();
  if (v === "") return null;
  const m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[ T](\d{1,2}):(\d{2}))?$/.exec(v);
  if (!m) return undefined;
  const date = `${m[1]}-${pad(m[2]!)}-${pad(m[3]!)}`;
  const time = m[4] !== undefined ? `${pad(m[4])}:${m[5]}` : null;
  return deadlineFromJst(date, time) ?? undefined;
}

/** チェックボックスの欄 → 真偽。Yes / No（はい・いいえ・true・false・あり・なし・○・× も）。空は null、読めなければ undefined */
export function parseCsvBoolean(value: string): boolean | null | undefined {
  const v = value.normalize("NFKC").trim().toLowerCase();
  if (v === "") return null;
  if (["yes", "y", "true", "1", "はい", "有", "あり", "○", "✓", "✔"].includes(v)) return true;
  if (["no", "n", "false", "0", "いいえ", "無", "なし", "×", "✗", "-", "—"].includes(v))
    return false;
  return undefined;
}

/**
 * 複数の値の欄を分ける。「;」「、」「,」（全角も）・改行で区切り、空と重なりを除く。
 * 括弧の中の「,」（「印刷物（紙, ビラ）」など）では分けない
 */
export function splitCsvList(value: string): string[] {
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
    const t = p.trim();
    if (t !== "" && !out.includes(t)) out.push(t);
  }
  return out;
}
