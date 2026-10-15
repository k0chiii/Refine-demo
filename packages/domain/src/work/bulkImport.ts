import { parseCsv } from "../notation/importer.ts";
import { deadlineFromJst, toJstDate } from "../shared/deadline.ts";
import type { Instant } from "../shared/time.ts";
import { confidentialities, mediaTypes, type Confidentiality, type MediaType } from "./Work.ts";

/**
 * 制作物の一括登録（CSV）。利用者決定 2026-10-15「制作物の登録は管理者が一括で行う」。
 * 取り込む前に、行ごとの内容と担当者の対応（メールアドレスかユーザー名 → 利用者）を表で確かめてから登録する。
 * ここは CSV の解析・検証と担当者の照合だけを持つ純粋関数。登録はアプリケーション層の `importWorks`。
 *
 * 列（見出しの名前で探す。並び順は自由・知らない列は無視）:
 *   題名*・年度・用途・区分*・媒体*・制作者*・主管・校了権限者*・納期・旧ID・機密区分・表記カテゴリ（* は必須）
 * - 制作者・主管・表記カテゴリは複数を「;」「、」「,」（全角も可）か改行で区切る
 * - 担当者はメールアドレス（@ を含む）かユーザー名（一度サインインした利用者）で書く。同名が複数いるときはメールで書く
 * - 納期は 2026-11-14 か 2026/11/14（その日の終わりまで）。時刻を付けるなら「2026-11-14 18:00」
 * - 媒体は PDF・画像・文章・SNS 投稿・動画・Web・Figma・その他（内部の英字の値でもよい）
 */
export const workCsvColumns = [
  {
    key: "title",
    header: "題名",
    aliases: ["題名", "名称", "タイトル", "制作物", "title"],
    required: true,
  },
  { key: "year", header: "年度", aliases: ["年度", "回", "year"], required: false },
  {
    key: "purpose",
    header: "用途",
    aliases: ["用途", "目的", "目的・対象者", "purpose"],
    required: false,
  },
  { key: "category", header: "区分", aliases: ["区分", "分類", "category"], required: true },
  { key: "mediaType", header: "媒体", aliases: ["媒体", "媒体種別", "mediaType"], required: true },
  { key: "creators", header: "制作者", aliases: ["制作者", "creators", "creator"], required: true },
  {
    key: "managers",
    header: "主管",
    aliases: ["主管", "主管担当", "managers", "manager"],
    required: false,
  },
  {
    key: "approver",
    header: "校了権限者",
    aliases: ["校了権限者", "校了担当", "approver"],
    required: true,
  },
  { key: "deadline", header: "納期", aliases: ["納期", "deadline"], required: false },
  { key: "legacyId", header: "旧ID", aliases: ["旧ID", "旧 ID", "legacyId"], required: false },
  {
    key: "confidentiality",
    header: "機密区分",
    aliases: ["機密区分", "機密", "confidentiality"],
    required: false,
  },
  {
    key: "notation",
    header: "表記カテゴリ",
    aliases: ["表記カテゴリ", "表記ルールのカテゴリ", "notationCategories"],
    required: false,
  },
] as const;
type ColumnKey = (typeof workCsvColumns)[number]["key"];

/** 1 回に取り込める行数（Convex の 1 mutation に収めるため。超えたら分けて取り込む） */
export const WORK_IMPORT_MAX_ROWS = 200;

const mediaAliases: Record<string, MediaType> = {
  pdf: "pdf",
  画像: "image",
  image: "image",
  文章: "document",
  document: "document",
  sns: "sns",
  "sns 投稿": "sns",
  sns投稿: "sns",
  動画: "video",
  video: "video",
  web: "web",
  figma: "figma",
  その他: "other",
  other: "other",
};
const confidentialityAliases: Record<string, Confidentiality> = {
  通常: "normal",
  normal: "normal",
  非公開: "restricted",
  取扱注意: "restricted",
  "非公開・取扱注意": "restricted",
  restricted: "restricted",
};

/** 全角英数・全角空白をそろえ、連続する空白を 1 つに（名前・見出しの照合用） */
export function normalizePersonKey(value: string): string {
  return value.normalize("NFKC").replace(/\s+/g, " ").trim().toLowerCase();
}

function splitList(value: string): string[] {
  return value
    .split(/[;；、,，\n]/)
    .map((s) => s.trim())
    .filter((s) => s !== "");
}

export interface WorkCsvRow {
  /** CSV の行番号（1 始まり。見出しの行を含む） */
  line: number;
  title: string;
  year: number;
  purpose: string;
  category: string;
  mediaType: MediaType | null;
  creators: string[];
  managers: string[];
  approver: string;
  deadlineAt: Instant | null;
  legacyId: string;
  confidentiality: Confidentiality;
  notationCategories: string[];
  /** 取り込めない理由（担当者の照合は別。{@link resolveWorkImport} で足す） */
  problems: string[];
}

export interface WorkCsvParseResult {
  rows: WorkCsvRow[];
  /** ファイル全体の問題（見出しが無い・必須の列が無い・行が多すぎる） */
  errors: string[];
}

function findHeader(
  rows: string[][],
): { index: number; map: Partial<Record<ColumnKey, number>> } | null {
  for (let i = 0; i < Math.min(rows.length, 10); i++) {
    const map: Partial<Record<ColumnKey, number>> = {};
    rows[i]!.forEach((cell, k) => {
      const v = normalizePersonKey(cell);
      for (const col of workCsvColumns)
        if (map[col.key] === undefined && col.aliases.some((a) => normalizePersonKey(a) === v))
          map[col.key] = k;
    });
    if (map.title !== undefined) return { index: i, map };
  }
  return null;
}

/** 納期の欄 → 締切の時刻（その日の終わり、または指定の時刻）。空は null、読めなければ undefined */
export function parseWorkDeadline(value: string): Instant | null | undefined {
  const v = value.normalize("NFKC").trim();
  if (v === "") return null;
  const m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[ T](\d{1,2}):(\d{2}))?$/.exec(v);
  if (!m) return undefined;
  const date = `${m[1]}-${m[2]!.padStart(2, "0")}-${m[3]!.padStart(2, "0")}`;
  const time = m[4] !== undefined ? `${m[4].padStart(2, "0")}:${m[5]}` : null;
  return deadlineFromJst(date, time) ?? undefined;
}

/**
 * CSV を行ごとの登録内容に読む。担当者はまだ文字列のまま（照合は {@link resolveWorkImport}）。
 * 空の行は飛ばす。見出しより前の行（説明など）は読まない。
 */
export function parseWorkCsv(
  text: string,
  opts: { defaultYear: number; now: Instant },
): WorkCsvParseResult {
  const table = parseCsv(text);
  const header = findHeader(table);
  if (!header)
    return {
      rows: [],
      errors: [
        "見出しの行が見つかりません。1 行目に「題名」などの列名を書いてください（雛形を書き出せます）",
      ],
    };
  const missing = workCsvColumns.filter((c) => c.required && header.map[c.key] === undefined);
  const errors = missing.length
    ? [`必須の列がありません: ${missing.map((c) => c.header).join("・")}`]
    : [];
  const rows: WorkCsvRow[] = [];
  for (let i = header.index + 1; i < table.length; i++) {
    const cells = table[i]!;
    if (cells.every((c) => c.trim() === "")) continue;
    const get = (key: ColumnKey) => {
      const k = header.map[key];
      return k === undefined ? "" : (cells[k] ?? "").trim();
    };
    const problems: string[] = [];
    const title = get("title");
    if (title === "") problems.push("題名がありません");
    const category = get("category");
    if (category === "") problems.push("区分がありません");

    const yearText = get("year").normalize("NFKC");
    let year = opts.defaultYear;
    if (yearText !== "") {
      const n = Number(yearText.replace(/^MF/i, ""));
      if (Number.isInteger(n) && n > 0 && n < 10_000) year = n;
      else problems.push(`年度「${yearText}」を数として読めません`);
    }

    const mediaText = get("mediaType");
    const mediaType =
      mediaAliases[normalizePersonKey(mediaText)] ??
      ((mediaTypes as readonly string[]).includes(mediaText) ? (mediaText as MediaType) : null);
    if (mediaType === null)
      problems.push(mediaText === "" ? "媒体がありません" : `媒体「${mediaText}」が分かりません`);

    const creators = splitList(get("creators"));
    if (creators.length === 0) problems.push("制作者がありません");
    const approvers = splitList(get("approver"));
    if (approvers.length === 0) problems.push("校了権限者がありません");
    if (approvers.length > 1) problems.push("校了権限者は 1 人だけ書いてください");

    const deadlineText = get("deadline");
    const deadline = parseWorkDeadline(deadlineText);
    if (deadline === undefined)
      problems.push(`納期「${deadlineText}」を日付として読めません（例: 2026-11-14）`);
    else if (deadline !== null && deadline <= opts.now) problems.push("納期が過ぎています");

    const confText = get("confidentiality");
    const confidentiality =
      confText === ""
        ? "normal"
        : (confidentialityAliases[normalizePersonKey(confText)] ??
          ((confidentialities as readonly string[]).includes(confText)
            ? (confText as Confidentiality)
            : null));
    if (confidentiality === null)
      problems.push(`機密区分「${confText}」が分かりません（通常・非公開）`);

    rows.push({
      line: i + 1,
      title,
      year,
      purpose: get("purpose"),
      category,
      mediaType,
      creators,
      managers: splitList(get("managers")),
      approver: approvers[0] ?? "",
      deadlineAt: deadline ?? null,
      legacyId: get("legacyId"),
      confidentiality: confidentiality ?? "normal",
      notationCategories: splitList(get("notation")),
      problems,
    });
  }
  if (rows.length > WORK_IMPORT_MAX_ROWS)
    errors.push(
      `1 回に取り込めるのは ${WORK_IMPORT_MAX_ROWS} 行までです（${rows.length} 行あります）。ファイルを分けてください`,
    );
  if (rows.length === 0 && errors.length === 0) errors.push("取り込む行がありません");
  return { rows, errors };
}

/** 照合に使う利用者（一度サインインした委員） */
export interface DirectoryUser {
  id: string;
  name: string;
  email: string | null;
}

export type PersonMatch =
  | { key: string; user: DirectoryUser }
  | { key: string; user: null; reason: "not_found" | "ambiguous"; candidates: DirectoryUser[] };

/** メールアドレス（@ を含む）は大文字小文字を区別せず完全一致、それ以外は名前の完全一致（空白のゆれは無視） */
export function matchPerson(key: string, directory: readonly DirectoryUser[]): PersonMatch {
  const k = normalizePersonKey(key);
  const hits = k.includes("@")
    ? directory.filter((u) => u.email !== null && normalizePersonKey(u.email) === k)
    : directory.filter((u) => normalizePersonKey(u.name) === k);
  const unique = Array.from(new Map(hits.map((u) => [u.id, u])).values());
  if (unique.length === 1) return { key, user: unique[0]! };
  return {
    key,
    user: null,
    reason: unique.length === 0 ? "not_found" : "ambiguous",
    candidates: unique,
  };
}

/** 登録に渡す内容（アプリケーション層の CreateWorkInput の部分集合） */
export interface WorkImportInput {
  title: string;
  year: number;
  purpose: string;
  category: string;
  mediaType: MediaType;
  creatorIds: string[];
  managerIds: string[];
  approverId: string;
  deadlineAt?: Instant;
  legacyId?: string;
  confidentiality: Confidentiality;
  notationCategories: string[];
}

export interface WorkImportRow {
  row: WorkCsvRow;
  creators: PersonMatch[];
  managers: PersonMatch[];
  approver: PersonMatch | null;
  /** 取り込めない理由（行の内容と担当者の照合） */
  problems: string[];
  /** 問題が無い行だけ登録の内容が入る */
  input: WorkImportInput | null;
}

export interface WorkImportPreview {
  rows: WorkImportRow[];
  errors: string[];
  /** 登録できる行の数 */
  ready: number;
}

function describeMiss(label: string, m: PersonMatch): string | null {
  if (m.user) return null;
  return m.reason === "ambiguous"
    ? `${label}「${m.key}」に当たる人が ${m.candidates.length} 人います。メールアドレスで書いてください`
    : `${label}「${m.key}」が見つかりません（一度サインインした人だけ指定できます）`;
}

/**
 * 解析結果と利用者の一覧から、取り込みの確認表を作る。
 * 旧ID が CSV の中や既存の制作物と重なる行は、二重登録を避けるため取り込まない。
 */
export function resolveWorkImport(
  parsed: WorkCsvParseResult,
  directory: readonly DirectoryUser[],
  opts: { existingLegacyIds?: Iterable<string> } = {},
): WorkImportPreview {
  const existing = new Set(Array.from(opts.existingLegacyIds ?? [], (s) => s.trim()));
  const seenLegacy = new Set<string>();
  const rows = parsed.rows.map((row): WorkImportRow => {
    const creators = row.creators.map((k) => matchPerson(k, directory));
    const managers = row.managers.map((k) => matchPerson(k, directory));
    const approver = row.approver ? matchPerson(row.approver, directory) : null;
    const problems = [...row.problems];
    for (const m of creators) {
      const p = describeMiss("制作者", m);
      if (p) problems.push(p);
    }
    for (const m of managers) {
      const p = describeMiss("主管", m);
      if (p) problems.push(p);
    }
    if (approver) {
      const p = describeMiss("校了権限者", approver);
      if (p) problems.push(p);
    }
    if (row.legacyId) {
      if (existing.has(row.legacyId))
        problems.push(`旧ID「${row.legacyId}」の制作物がすでにあります`);
      else if (seenLegacy.has(row.legacyId))
        problems.push(`旧ID「${row.legacyId}」が CSV の中で重なっています`);
      seenLegacy.add(row.legacyId);
    }
    const ok = problems.length === 0 && parsed.errors.length === 0 && row.mediaType !== null;
    const input: WorkImportInput | null = ok
      ? {
          title: row.title,
          year: row.year,
          purpose: row.purpose,
          category: row.category,
          mediaType: row.mediaType!,
          creatorIds: Array.from(new Set(creators.map((m) => m.user!.id))),
          managerIds: Array.from(new Set(managers.map((m) => m.user!.id))),
          approverId: approver!.user!.id,
          ...(row.deadlineAt !== null ? { deadlineAt: row.deadlineAt } : {}),
          ...(row.legacyId ? { legacyId: row.legacyId } : {}),
          confidentiality: row.confidentiality,
          notationCategories: row.notationCategories,
        }
      : null;
    return { row, creators, managers, approver, problems, input };
  });
  return { rows, errors: parsed.errors, ready: rows.filter((r) => r.input).length };
}

function csvCell(value: string): string {
  return /[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/** 雛形（見出しと記入例 1 行。納期の例は 30 日後）。Excel で文字化けしないよう先頭に BOM を付けるのは書き出す側 */
export function workCsvTemplate(now: Instant = Date.now()): string {
  const header = workCsvColumns.map((c) => c.header);
  const example = [
    "MF100 公式パンフレット",
    "100",
    "来場者向け総合案内",
    "印刷物",
    "PDF",
    "mock-creator@example.invalid",
    "五月 主管",
    "mock-approver@example.invalid",
    toJstDate(now + 30 * 86_400_000),
    "PR-001",
    "通常",
    "A1;A2",
  ];
  return `${[header, example].map((r) => r.map(csvCell).join(",")).join("\r\n")}\r\n`;
}
