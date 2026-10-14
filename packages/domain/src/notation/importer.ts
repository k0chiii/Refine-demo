import { compileRulePattern } from "./safeRegex.ts";
import type { ExceptionCondition, NotationRule, RuleLanguage, RuleStrictness } from "./rule.ts";
import { ruleLanguages, ruleStrictness } from "./rule.ts";

/**
 * 表記統一ルールの取り込み（MF99 スプレッドシートの CSV、notation2 の JSON、MF100 の書き出し JSON）。
 * スプレッドシートには説明行・管理メモが混ざるので、ルールにできない行はカテゴリの説明として残し、機械的にルールにしない。
 * 取り込みはプレビュー（この関数の結果）を管理者が確認してから行う。
 */
export type RuleDraft = Omit<
  NotationRule,
  "revision" | "createdBy" | "updatedBy" | "createdAt" | "updatedAt" | "publishedAt"
>;

export interface ImportPreview {
  rules: RuleDraft[];
  /** ルールにできなかった行（カテゴリ説明・運用ポリシーとして保存する候補） */
  notes: Array<{ categoryCode: string; text: string; line: number }>;
  warnings: Array<{ line: number; message: string }>;
  /** 同じ誤表記を持つルール（取り込み内・既存との重複） */
  duplicates: Array<{ key: string; ruleIds: string[] }>;
  /** 同じ誤表記に別の統一表記（矛盾） */
  conflicts: Array<{ key: string; ruleIds: string[]; corrects: string[] }>;
}

/** RFC 4180 の CSV（引用符・改行を含むセル）を行に分ける */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  const src = text.replace(/^﻿/, "");
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]!;
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      row.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += ch;
  }
  if (cell !== "" || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

const headerAliases: Record<string, string[]> = {
  ruleId: ["ID", "ルールID", "ruleId"],
  enabled: ["有効", "enabled"],
  category: ["カテゴリ", "カテゴリー", "分類", "区分"],
  title: ["項目名", "項目", "見出し"],
  correct: ["統一表記", "正しい表記", "正", "表記"],
  incorrect: ["誤表記", "誤", "誤った表記", "揺れ"],
  pattern: ["正規表現", "regex", "パターン"],
  exception: ["例外", "例外条件"],
  note: ["備考", "メモ", "説明"],
  en: ["英語表記", "英語", "English"],
  zh: ["中国語表記", "中国語", "中文"],
  year: ["年度", "回"],
  strictness: ["厳格さ", "必須/推奨", "区別"],
};

function findHeader(rows: string[][]): { index: number; map: Record<string, number> } | null {
  for (let i = 0; i < Math.min(rows.length, 30); i++) {
    const map: Record<string, number> = {};
    rows[i]!.forEach((c, k) => {
      const v = c.trim();
      for (const [key, names] of Object.entries(headerAliases))
        if (names.some((n) => v === n || v.toLowerCase() === n.toLowerCase())) map[key] ??= k;
    });
    if (map.correct !== undefined && (map.incorrect !== undefined || map.pattern !== undefined))
      return { index: i, map };
  }
  return null;
}

/** セル内の複数の表記（改行・「、」・「/」・「|」区切り） */
export function splitList(cell: string | undefined): string[] {
  if (!cell) return [];
  return cell
    .split(/\r?\n|、|，|\/|\||;|；/u)
    .map((s) => s.trim())
    .filter(Boolean);
}

const categoryCodeOf = (cell: string): string | null => {
  const m = /^\s*([A-E][0-9]?)\b/u.exec(cell.normalize("NFKC"));
  return m ? m[1]!.toUpperCase() : null;
};

/**
 * MF99 スプレッドシートの CSV をプレビューにする。
 * - 見出し行を探し、それより前の行と、統一表記も誤表記も無い行はルールにしない（notes へ）
 * - カテゴリは「カテゴリ」列、無ければ直前のカテゴリ見出し行（A1 固有名詞… など）を引き継ぐ
 * - 年度は指定が無ければ defaultYear（MF99 のルールを MF100 に無条件で当てない）
 */
export function previewCsvImport(
  text: string,
  opts: { defaultYear: number; existing?: readonly RuleDraft[]; idPrefix?: string },
): ImportPreview {
  const rows = parseCsv(text);
  const head = findHeader(rows);
  const preview: ImportPreview = {
    rules: [],
    notes: [],
    warnings: [],
    duplicates: [],
    conflicts: [],
  };
  if (!head) {
    preview.warnings.push({
      line: 1,
      message: "見出し行（統一表記・誤表記 などの列名）が見つかりません",
    });
    return preview;
  }
  const { index, map } = head;
  let currentCategory = "A1";
  for (let i = 0; i < index; i++) {
    const text0 = rows[i]!.join(" ").trim();
    if (text0) preview.notes.push({ categoryCode: currentCategory, text: text0, line: i + 1 });
  }
  const seq = new Map<string, number>();
  for (let i = index + 1; i < rows.length; i++) {
    const r = rows[i]!;
    const cell = (k: string) => (map[k] !== undefined ? (r[map[k]!] ?? "").trim() : "");
    const joined = r.join(" ").trim();
    if (!joined) continue;
    const catCell = cell("category");
    const cat = catCell ? categoryCodeOf(catCell) : null;
    if (cat) currentCategory = cat;
    const correct = splitList(cell("correct"));
    const incorrect = splitList(cell("incorrect"));
    // 正規表現は「|」「/」を含むので、セル内の改行だけで区切る
    const patterns = cell("pattern")
      .split(/\r?\n/)
      .map((x) => x.trim())
      .filter(Boolean);
    if (correct.length === 0 && incorrect.length === 0 && patterns.length === 0) {
      // カテゴリ見出し行（例: 「A2 日本語頻出単語」）や説明行
      const maybeCat = categoryCodeOf(joined);
      if (maybeCat && joined.length < 40) currentCategory = maybeCat;
      else preview.notes.push({ categoryCode: currentCategory, text: joined, line: i + 1 });
      continue;
    }
    if (correct.length === 0) {
      preview.warnings.push({
        line: i + 1,
        message: "統一表記が空なので取り込みません（説明として残します）",
      });
      preview.notes.push({ categoryCode: currentCategory, text: joined, line: i + 1 });
      continue;
    }
    for (const p of patterns) {
      const c = compileRulePattern(p);
      if (!c.ok)
        preview.warnings.push({
          line: i + 1,
          message: `正規表現を使えません（${c.reason}）: ${p}`,
        });
    }
    const n = (seq.get(currentCategory) ?? 0) + 1;
    seq.set(currentCategory, n);
    const exceptionText = cell("exception");
    const exceptions: ExceptionCondition[] = exceptionText
      ? [{ kind: "phrase", value: "", note: exceptionText }]
      : [];
    const years = cell("year")
      ? splitList(cell("year")).map(Number).filter(Number.isFinite)
      : [opts.defaultYear];
    const strictCell = cell("strictness");
    const strictness: RuleStrictness = /推奨/.test(strictCell)
      ? "recommended"
      : /確認/.test(strictCell)
        ? "review"
        : "required";
    const en = cell("en");
    const zh = cell("zh");
    const givenId = cell("ruleId");
    const enabledCell = cell("enabled");
    preview.rules.push({
      ruleId:
        givenId ||
        `${opts.idPrefix ?? "MF"}${opts.defaultYear}-${currentCategory}-${String(n).padStart(4, "0")}`,
      categoryCode: currentCategory,
      title: cell("title") || correct[0]!,
      description: cell("note"),
      correct,
      incorrect: incorrect.filter((x) => !correct.includes(x)),
      patterns,
      exceptions,
      language: "ja",
      scopes: [],
      years,
      priority: 0,
      strictness,
      enabled: !/^(false|0|無効|いいえ)$/i.test(enabledCell),
      ...(en || zh ? { translations: { ...(en ? { en } : {}), ...(zh ? { zh } : {}) } } : {}),
    });
  }
  detectDuplicates(preview, opts.existing ?? []);
  return preview;
}

/** 同じ誤表記を持つルール（重複）と、同じ誤表記に違う統一表記（矛盾）を探す */
export function detectDuplicates(preview: ImportPreview, existing: readonly RuleDraft[]): void {
  const byKey = new Map<string, Array<{ ruleId: string; correct: string }>>();
  for (const r of [...existing, ...preview.rules])
    for (const k of [...r.incorrect, ...r.patterns]) {
      const key = `${r.language}:${k}`;
      const list = byKey.get(key) ?? [];
      if (!list.some((x) => x.ruleId === r.ruleId))
        list.push({ ruleId: r.ruleId, correct: r.correct[0] ?? "" });
      byKey.set(key, list);
    }
  for (const [key, list] of byKey) {
    if (list.length < 2) continue;
    const corrects = Array.from(new Set(list.map((x) => x.correct)));
    if (corrects.length > 1)
      preview.conflicts.push({ key, ruleIds: list.map((x) => x.ruleId), corrects });
    else preview.duplicates.push({ key, ruleIds: list.map((x) => x.ruleId) });
  }
}

/** JSON の取り込み（MF100 の書き出し形式、または notation2 の {category, wrong[], correct[]} 形式） */
export function previewJsonImport(
  json: unknown,
  opts: { defaultYear: number; existing?: readonly RuleDraft[] },
): ImportPreview {
  const preview: ImportPreview = {
    rules: [],
    notes: [],
    warnings: [],
    duplicates: [],
    conflicts: [],
  };
  const list = Array.isArray(json)
    ? json
    : Array.isArray((json as { rules?: unknown })?.rules)
      ? (json as { rules: unknown[] }).rules
      : null;
  if (!list) {
    preview.warnings.push({ line: 0, message: "rules 配列が見つかりません" });
    return preview;
  }
  list.forEach((raw, i) => {
    const o = raw as Record<string, unknown>;
    const strs = (v: unknown) =>
      Array.isArray(v)
        ? v.filter((x): x is string => typeof x === "string")
        : typeof v === "string"
          ? [v]
          : [];
    const correct = strs(o.correct);
    if (correct.length === 0) {
      preview.warnings.push({ line: i + 1, message: "統一表記が空なので取り込みません" });
      return;
    }
    const notation2 = Array.isArray(o.wrong);
    const lang = ruleLanguages.includes(o.language as RuleLanguage)
      ? (o.language as RuleLanguage)
      : "ja";
    const strict = ruleStrictness.includes(o.strictness as RuleStrictness)
      ? (o.strictness as RuleStrictness)
      : "required";
    const cat =
      typeof o.categoryCode === "string"
        ? o.categoryCode
        : typeof o.category === "string"
          ? (categoryCodeOf(o.category) ?? "A1")
          : "A1";
    preview.rules.push({
      ruleId:
        typeof o.ruleId === "string" ? o.ruleId : `IMPORT-${cat}-${String(i + 1).padStart(4, "0")}`,
      categoryCode: cat,
      title: typeof o.title === "string" ? o.title : correct[0]!,
      description: typeof o.description === "string" ? o.description : "",
      correct,
      // notation2 の wrong は正規表現として扱われていたので patterns に入れる
      incorrect: notation2 ? [] : strs(o.incorrect),
      patterns: notation2 ? strs(o.wrong) : strs(o.patterns),
      exceptions: Array.isArray(o.exceptions)
        ? (o.exceptions as ExceptionCondition[]).filter((x) => x && typeof x.value === "string")
        : typeof o.exception === "string" && o.exception
          ? [{ kind: "phrase", value: "", note: o.exception }]
          : [],
      language: lang,
      scopes: strs(o.scopes),
      years: Array.isArray(o.years)
        ? (o.years as unknown[]).filter((x): x is number => typeof x === "number")
        : [opts.defaultYear],
      priority: typeof o.priority === "number" ? o.priority : 0,
      strictness: strict,
      enabled: o.enabled !== false,
      ...(typeof o.note === "string" && o.note ? { note: o.note } : {}),
      ...(o.translations && typeof o.translations === "object"
        ? { translations: o.translations as { en?: string; zh?: string } }
        : {}),
    });
  });
  detectDuplicates(preview, opts.existing ?? []);
  return preview;
}

/** ルールの妥当性（サーバー側でも必ず確かめる） */
export function validateRuleDraft(r: RuleDraft): string[] {
  const errors: string[] = [];
  if (!r.ruleId.trim() || r.ruleId.length > 80) errors.push("ruleId が不正です");
  if (!r.categoryCode.trim()) errors.push("カテゴリが空です");
  if (r.correct.length === 0) errors.push("統一表記が空です");
  if (r.incorrect.length === 0 && r.patterns.length === 0)
    errors.push("誤表記か正規表現のどちらかが必要です");
  if (r.title.length > 200 || r.description.length > 2000) errors.push("題名・説明が長すぎます");
  if ([...r.correct, ...r.incorrect, ...r.patterns].length > 200) errors.push("表記が多すぎます");
  for (const p of r.patterns) {
    const c = compileRulePattern(p);
    if (!c.ok) errors.push(`正規表現: ${c.reason}`);
  }
  for (const e of r.exceptions)
    if ((e.kind === "before" || e.kind === "after") && e.value && !compileRulePattern(e.value).ok)
      errors.push(`例外の正規表現が不正です: ${e.value}`);
  if (!ruleLanguages.includes(r.language)) errors.push("言語が不正です");
  if (!ruleStrictness.includes(r.strictness)) errors.push("厳格さが不正です");
  return errors;
}

const csvCell = (v: string) => (/[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

/**
 * CSV に書き出す（取り込みと同じ列名）。複数の表記はセル内の改行で区切る。
 * 例外条件の構造（語句・直前・直後）は CSV では説明文になるので、完全な移行には JSON を使う。
 */
export function rulesToCsv(rules: readonly RuleDraft[]): string {
  const head = [
    "ID",
    "カテゴリ",
    "項目名",
    "統一表記",
    "誤表記",
    "正規表現",
    "例外",
    "備考",
    "英語表記",
    "中国語表記",
    "年度",
    "厳格さ",
    "有効",
  ];
  const strict: Record<RuleStrictness, string> = {
    required: "必須",
    recommended: "推奨",
    review: "要確認",
  };
  const rows = rules.map((r) =>
    [
      r.ruleId,
      r.categoryCode,
      r.title,
      r.correct.join("\n"),
      r.incorrect.join("\n"),
      r.patterns.join("\n"),
      r.exceptions
        .map((e) => e.note ?? (e.kind === "phrase" ? e.value : `${e.kind}: ${e.value}`))
        .join("\n"),
      r.description,
      r.translations?.en ?? "",
      r.translations?.zh ?? "",
      r.years.join("\n"),
      strict[r.strictness],
      r.enabled ? "有効" : "無効",
    ]
      .map(csvCell)
      .join(","),
  );
  return [head.join(","), ...rows].join("\r\n") + "\r\n";
}

/** JSON に書き出す（MF100 の形式。previewJsonImport でそのまま取り込める） */
export function rulesToJson(rules: readonly RuleDraft[], categories: readonly unknown[]): string {
  return JSON.stringify({ format: "mf100-notation", version: 1, categories, rules }, null, 2);
}
