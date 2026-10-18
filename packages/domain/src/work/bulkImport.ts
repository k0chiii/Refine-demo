import { parseCsv } from "../notation/importer.ts";
import { matchTeam, type Team, type TeamMatch } from "../org/team.ts";
import { parseCsvBoolean, parseCsvDateTime, splitCsvList } from "../shared/csvValues.ts";
import { toJstDate } from "../shared/deadline.ts";
import type { Instant } from "../shared/time.ts";
import {
  defaultMediaTypeFor,
  genreOfSubGenre,
  normalizeWorkTags,
  parseNonNegativeInteger,
  parseWorkGenre,
  parseWorkSubGenre,
  WORK_SIZE_MAX,
  workGenreLabels,
  workSubGenreLabel,
  type WorkGenre,
  type WorkSubGenre,
} from "./metadata.ts";
import { confidentialities, mediaTypes, type Confidentiality, type MediaType } from "./Work.ts";
import {
  defaultWorkTeamPolicy,
  WORK_CATEGORY_MAX,
  WORK_TITLE_MAX,
  type WorkTeamPolicy,
} from "./workInput.ts";

/**
 * 制作物の一括登録（CSV）。利用者決定 2026-10-15「制作物の登録は管理者が一括で行う」。
 * 列の名前は委員会の制作物 DB の項目名（docs/NOTION_ALIGNMENT.md。利用者決定 2026-10-17）。読むのはこのアプリの雛形で、
 * 外部ツールの書き出しをそのまま取り込む仕組みではない（実データの連携はしない。利用者決定 2026-10-17）。
 * 以前の列名（題名・用途・旧ID・校了権限者・主管担当）もそのまま読める。
 * 取り込む前に、行ごとの内容と担当者の対応（メールアドレスかユーザー名 → 利用者）を表で確かめてから登録する。
 * ここは CSV の解析・検証と担当者の照合だけを持つ純粋関数。登録はアプリケーション層の `importWorks`。
 *
 * 列（見出しの名前で探す。並び順は自由・知らない列は無視。* は必須）:
 *   制作物名*・制作物 ID・大ジャンル・小ジャンル・区分・媒体・目的・用途・担当（主管担当）・制作担当・関係担当・
 *   制作者*・関係者・主管（人）・校了者*・校了とみなす人数・納期・入稿日・投稿日・印刷日・入稿の有無・印刷する部数/枚数/個数・サイズ・尺・
 *   制作日数・タグ・機密区分・表記カテゴリ・年度
 * - 区分は小ジャンル（無ければ大ジャンル）から入る。媒体は小ジャンル・大ジャンルから既定が入る（書けばそちら）
 * - 複数の値は「;」「、」「,」（全角も可）か改行で区切る
 * - 担当（組織）は「局 › 担当」「局/担当」、担当の名前だけ（同名が無いとき）、局の名前かコード（PR など）で書く。
 *   担当（主管担当）は 1 つ、制作担当も 1 つ（WorkTeamPolicy。利用者決定 2026-10-17）、関係担当は複数
 * - 人はメールアドレス（@ を含む）かユーザー名（一度サインインした利用者）で書く。同名が複数いるときはメールで書く
 * - 校了者は複数書ける（利用者決定 2026-10-18）。「校了とみなす人数」の列（省略は 1）は 1 以上・校了者の数以下。
 *   制作者は校了者にできない（同じ人が両方にいる行は取り込めない行になる）
 * - 日付は 2026-11-14・2026/11/14（その日の終わりまで）。時刻を付けるなら「2026-11-14 18:00」
 * - チェックボックス（入稿の有無）は Yes / No（はい・いいえ も）
 * - 有効性・校了済みは状態（中止・校了）から導く値なので列に持たない。中止・校了は登録してから操作で入れる
 */
export const workCsvColumns = [
  {
    key: "title",
    header: "制作物名",
    aliases: ["制作物名", "題名", "名称", "タイトル", "制作物", "title"],
    required: true,
  },
  {
    key: "legacyId",
    header: "制作物 ID",
    aliases: ["制作物 ID", "制作物ID", "旧ID", "旧 ID", "legacyId"],
    required: false,
  },
  {
    key: "genre",
    header: "大ジャンル",
    aliases: ["大ジャンル", "ジャンル", "genre"],
    required: false,
  },
  { key: "subGenre", header: "小ジャンル", aliases: ["小ジャンル", "subGenre"], required: false },
  { key: "category", header: "区分", aliases: ["区分", "分類", "category"], required: false },
  { key: "mediaType", header: "媒体", aliases: ["媒体", "媒体種別", "mediaType"], required: false },
  {
    key: "purpose",
    header: "目的・用途",
    aliases: ["目的・用途", "用途", "目的", "目的・対象者", "purpose"],
    required: false,
  },
  {
    key: "ownerTeam",
    header: "担当",
    aliases: ["担当", "主管担当", "主管の担当", "ownerTeam"],
    required: false,
  },
  {
    key: "productionTeams",
    header: "制作担当",
    aliases: ["制作担当", "productionTeams"],
    required: false,
  },
  {
    key: "relatedTeams",
    header: "関係担当",
    aliases: ["関係担当", "関連担当", "relatedTeams"],
    required: false,
  },
  { key: "creators", header: "制作者", aliases: ["制作者", "creators", "creator"], required: true },
  { key: "stakeholders", header: "関係者", aliases: ["関係者", "stakeholders"], required: false },
  { key: "managers", header: "主管", aliases: ["主管", "managers", "manager"], required: false },
  {
    key: "approver",
    header: "校了者",
    aliases: ["校了者", "校了権限者", "校了担当", "approver"],
    required: true,
  },
  {
    key: "approvalQuorum",
    header: "校了とみなす人数",
    aliases: ["校了とみなす人数", "校了人数", "校了に必要な人数", "approvalQuorum"],
    required: false,
  },
  { key: "deadline", header: "納期", aliases: ["納期", "deadline"], required: false },
  {
    key: "publishAt",
    header: "入稿日・投稿日・印刷日",
    aliases: ["入稿日・投稿日・印刷日", "入稿日", "投稿日", "印刷日", "publishAt"],
    required: false,
  },
  {
    key: "requiresPrinterSubmission",
    header: "入稿の有無",
    aliases: ["入稿の有無", "入稿", "requiresPrinterSubmission"],
    required: false,
  },
  {
    key: "printQuantity",
    header: "印刷する部数/枚数/個数",
    aliases: ["印刷する部数/枚数/個数", "部数", "印刷部数", "印刷する部数", "printQuantity"],
    required: false,
  },
  {
    key: "sizeOrLength",
    header: "サイズ・尺",
    aliases: ["サイズ・尺", "サイズ", "尺", "sizeOrLength"],
    required: false,
  },
  {
    key: "productionDays",
    header: "制作日数",
    aliases: ["制作日数", "productionDays"],
    required: false,
  },
  { key: "tags", header: "タグ", aliases: ["タグ", "tags"], required: false },
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
  { key: "year", header: "年度", aliases: ["年度", "回", "year"], required: false },
] as const;
type ColumnKey = (typeof workCsvColumns)[number]["key"];

/** 雛形に出す列（読む列と同じ） */
export const workCsvTemplateColumns: readonly (typeof workCsvColumns)[number][] = workCsvColumns;

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
  映像: "video",
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

const splitList = splitCsvList;

export interface WorkCsvRow {
  /** CSV の行番号（1 始まり。見出しの行を含む） */
  line: number;
  title: string;
  year: number;
  purpose: string;
  category: string;
  mediaType: MediaType | null;
  genre: WorkGenre | null;
  subGenre: WorkSubGenre | null;
  creators: string[];
  managers: string[];
  /** 関係者 */
  stakeholders: string[];
  /** 校了者（複数可） */
  approvers: string[];
  /** 校了とみなす人数。列が空なら null（1 として扱う） */
  approvalQuorum: number | null;
  deadlineAt: Instant | null;
  publishAt: Instant | null;
  requiresPrinterSubmission: boolean | null;
  printQuantity: number | null;
  sizeOrLength: string;
  productionDays: number | null;
  tags: string[];
  legacyId: string;
  confidentiality: Confidentiality;
  notationCategories: string[];
  /** 主管担当（組織）の書き方のまま。無ければ null（照合は {@link resolveWorkImport}） */
  ownerTeam: string | null;
  /** 制作担当（組織）の書き方のまま */
  productionTeams: string[];
  /** 関係担当（組織）の書き方のまま */
  relatedTeams: string[];
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

/**
 * 納期の欄 → 締切の時刻（その日の終わり、または指定の時刻）。空は null、読めなければ undefined。
 * 2026-11-14・2026/11/14 と、時刻付き「2026-11-14 18:00」（shared/csvValues.ts）
 */
export function parseWorkDeadline(value: string): Instant | null | undefined {
  return parseCsvDateTime(value);
}

/**
 * CSV を行ごとの登録内容に読む。担当者はまだ文字列のまま（照合は {@link resolveWorkImport}）。
 * 空の行は飛ばす。見出しより前の行（説明など）は読まない。
 */
export function parseWorkCsv(
  text: string,
  opts: { defaultYear: number; now: Instant; teamPolicy?: WorkTeamPolicy },
): WorkCsvParseResult {
  const maxProduction = (opts.teamPolicy ?? defaultWorkTeamPolicy).maxProductionTeams;
  const table = parseCsv(text);
  const header = findHeader(table);
  if (!header)
    return {
      rows: [],
      errors: [
        "見出しの行が見つかりません。1 行目に「制作物名」などの列名を書いてください（雛形を書き出せます）",
      ],
    };
  const missing = workCsvColumns.filter((c) => c.required && header.map[c.key] === undefined);
  const errors = missing.length
    ? [`必須の列がありません: ${missing.map((c) => c.header).join("・")}`]
    : [];
  if (
    header.map.category === undefined &&
    header.map.subGenre === undefined &&
    header.map.genre === undefined
  )
    errors.push("「小ジャンル」（または「大ジャンル」「区分」）の列がありません");
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
    if (title === "") problems.push("制作物名がありません");
    else if (title.length > WORK_TITLE_MAX)
      problems.push(`制作物名は ${WORK_TITLE_MAX} 文字までです（${title.length} 文字あります）`);

    // 大ジャンル・小ジャンル（Notion の選択肢）。小ジャンルから大ジャンルの既定が決まる
    const genreText = get("genre");
    let genre: WorkGenre | null = genreText === "" ? null : parseWorkGenre(genreText);
    if (genreText !== "" && genre === null)
      problems.push(
        `大ジャンル「${genreText}」が分かりません（${Object.values(workGenreLabels).join("・")}）`,
      );
    const subText = get("subGenre");
    const subGenre = subText === "" ? null : parseWorkSubGenre(subText);
    if (subText !== "" && subGenre === null)
      problems.push(`小ジャンル「${subText}」が分かりません`);
    if (genre === null && subGenre !== null) genre = genreOfSubGenre(subGenre);

    // 区分は小ジャンル（無ければ大ジャンル）の名前。書いてあればそちら
    const category =
      get("category") || workSubGenreLabel(subGenre) || (genre ? workGenreLabels[genre] : "");
    if (category === "") problems.push("小ジャンル（または区分）がありません");
    else if (category.length > WORK_CATEGORY_MAX)
      problems.push(`区分は ${WORK_CATEGORY_MAX} 文字までです（${category.length} 文字あります）`);

    const yearText = get("year").normalize("NFKC");
    let year = opts.defaultYear;
    if (yearText !== "") {
      const n = Number(yearText.replace(/^MF/i, ""));
      if (Number.isInteger(n) && n > 0 && n < 10_000) year = n;
      else problems.push(`年度「${yearText}」を数として読めません`);
    }

    // 媒体: 書いてあればそれ、無ければ小ジャンル・大ジャンルの既定
    const mediaText = get("mediaType");
    let mediaType: MediaType | null = null;
    if (mediaText !== "") {
      mediaType =
        mediaAliases[normalizePersonKey(mediaText)] ??
        ((mediaTypes as readonly string[]).includes(mediaText) ? (mediaText as MediaType) : null);
      if (mediaType === null) problems.push(`媒体「${mediaText}」が分かりません`);
    } else {
      mediaType = defaultMediaTypeFor(subGenre, genre);
      if (mediaType === null) problems.push("媒体がありません（小ジャンルか媒体を書いてください）");
    }

    const creators = splitList(get("creators"));
    if (creators.length === 0) problems.push("制作者がありません");
    const approvers = splitList(get("approver"));
    if (approvers.length === 0) problems.push("校了者がありません");
    const quorumText = get("approvalQuorum");
    const approvalQuorum = parseNonNegativeInteger(quorumText);
    if (approvalQuorum === undefined)
      problems.push(`校了とみなす人数「${quorumText}」を数として読めません`);
    else if (
      approvalQuorum !== null &&
      (approvalQuorum < 1 || approvalQuorum > Math.max(approvers.length, 1))
    )
      problems.push(`校了とみなす人数は 1 以上、校了者の数（${approvers.length} 人）以下です`);
    const stakeholders = splitList(get("stakeholders"));

    const deadlineText = get("deadline");
    const deadline = parseWorkDeadline(deadlineText);
    if (deadline === undefined)
      problems.push(
        `納期「${deadlineText}」を日付として読めません（例: 2026-11-14、2026年11月14日）`,
      );
    else if (deadline !== null && deadline <= opts.now) problems.push("納期が過ぎています");

    const publishText = get("publishAt");
    const publishAt = parseCsvDateTime(publishText);
    if (publishAt === undefined)
      problems.push(`入稿日・投稿日・印刷日「${publishText}」を日付として読めません`);

    const printerText = get("requiresPrinterSubmission");
    const requiresPrinterSubmission = parseCsvBoolean(printerText);
    if (requiresPrinterSubmission === undefined)
      problems.push(`入稿の有無「${printerText}」が分かりません（Yes / No）`);

    const quantityText = get("printQuantity");
    const printQuantity = parseNonNegativeInteger(quantityText);
    if (printQuantity === undefined)
      problems.push(`印刷する部数/枚数/個数「${quantityText}」を数として読めません`);
    const daysText = get("productionDays");
    const productionDays = parseNonNegativeInteger(daysText);
    if (productionDays === undefined) problems.push(`制作日数「${daysText}」を数として読めません`);

    const sizeOrLength = get("sizeOrLength");
    if (Array.from(sizeOrLength).length > WORK_SIZE_MAX)
      problems.push(`サイズ・尺は ${WORK_SIZE_MAX} 文字までです`);

    let tags: string[] = [];
    try {
      tags = normalizeWorkTags(splitList(get("tags")));
    } catch {
      problems.push("タグが多すぎるか、長すぎます（20 個・各 30 文字まで）");
    }

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

    const ownerTeams = splitList(get("ownerTeam"));
    if (ownerTeams.length > 1) problems.push("担当（主管担当）は 1 つだけ書いてください");
    const productionTeams = splitList(get("productionTeams"));
    if (productionTeams.length > maxProduction)
      problems.push(
        maxProduction === 1
          ? "制作担当は 1 つだけ書いてください（あとから変えられます）"
          : `制作担当は ${maxProduction} つまでです`,
      );

    rows.push({
      line: i + 1,
      title,
      year,
      purpose: get("purpose"),
      category,
      mediaType,
      genre,
      subGenre,
      creators,
      managers: splitList(get("managers")),
      stakeholders,
      approvers,
      approvalQuorum: approvalQuorum ?? null,
      deadlineAt: deadline ?? null,
      publishAt: publishAt ?? null,
      requiresPrinterSubmission: requiresPrinterSubmission ?? null,
      printQuantity: printQuantity ?? null,
      sizeOrLength,
      productionDays: productionDays ?? null,
      tags,
      legacyId: get("legacyId"),
      confidentiality: confidentiality ?? "normal",
      notationCategories: splitList(get("notation")),
      ownerTeam: ownerTeams[0] ?? null,
      productionTeams,
      relatedTeams: splitList(get("relatedTeams")),
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
  genre?: WorkGenre;
  subGenre?: WorkSubGenre;
  creatorIds: string[];
  managerIds: string[];
  stakeholderIds?: string[];
  /** 校了者（1 人以上） */
  approverIds: string[];
  /** 校了とみなす人数（省略は 1） */
  approvalQuorum?: number;
  deadlineAt?: Instant;
  publishAt?: Instant;
  requiresPrinterSubmission?: boolean;
  printQuantity?: number;
  sizeOrLength?: string;
  productionDays?: number;
  tags?: string[];
  legacyId?: string;
  confidentiality: Confidentiality;
  notationCategories: string[];
  /** 主管担当（組織の ID） */
  ownerTeamId?: string;
  /** 制作担当（組織の ID） */
  productionTeamIds: string[];
  /** 関係担当（組織の ID） */
  relatedTeamIds?: string[];
}

/** CSV に書かれた局・担当と、その照合の結果 */
export interface TeamRefMatch {
  key: string;
  match: TeamMatch;
}

export interface WorkImportRow {
  row: WorkCsvRow;
  creators: PersonMatch[];
  managers: PersonMatch[];
  stakeholders: PersonMatch[];
  approvers: PersonMatch[];
  /** 主管担当の照合（列が空なら null） */
  ownerTeam: TeamRefMatch | null;
  /** 制作担当の照合 */
  productionTeams: TeamRefMatch[];
  /** 関係担当の照合 */
  relatedTeams: TeamRefMatch[];
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

function describeTeamMiss(label: string, m: TeamRefMatch): string | null {
  if (m.match.kind === "ok") return null;
  return m.match.kind === "ambiguous"
    ? `${label}「${m.key}」に当たる担当が ${m.match.candidates.length} つあります。「局 › 担当」の形で書いてください`
    : `${label}「${m.key}」が見つかりません（管理画面の組織に登録した局・担当を「局 › 担当」の形で書いてください）`;
}

const teamIdOf = (m: TeamRefMatch) => (m.match.kind === "ok" ? m.match.team.id : "");

/**
 * 解析結果と利用者の一覧・組織（局 › 担当）から、取り込みの確認表を作る。
 * 制作物 ID（旧ID）が CSV の中や既存の制作物と重なる行は、二重登録を避けるため取り込まない。
 */
export function resolveWorkImport(
  parsed: WorkCsvParseResult,
  directory: readonly DirectoryUser[],
  opts: { existingLegacyIds?: Iterable<string> } = {},
  teams: readonly Team[] = [],
): WorkImportPreview {
  const existing = new Set(Array.from(opts.existingLegacyIds ?? [], (s) => s.trim()));
  const seenLegacy = new Set<string>();
  const rows = parsed.rows.map((row): WorkImportRow => {
    const creators = row.creators.map((k) => matchPerson(k, directory));
    const managers = row.managers.map((k) => matchPerson(k, directory));
    const stakeholders = row.stakeholders.map((k) => matchPerson(k, directory));
    const approvers = row.approvers.map((k) => matchPerson(k, directory));
    const ownerTeam: TeamRefMatch | null = row.ownerTeam
      ? { key: row.ownerTeam, match: matchTeam(row.ownerTeam, teams) }
      : null;
    const refs = (keys: string[]) =>
      keys.map((key): TeamRefMatch => ({ key, match: matchTeam(key, teams) }));
    const productionTeams = refs(row.productionTeams);
    const relatedTeams = refs(row.relatedTeams);
    const problems = [...row.problems];
    for (const [label, list] of [
      ["制作者", creators],
      ["主管", managers],
      ["関係者", stakeholders],
      ["校了者", approvers],
    ] as const)
      for (const m of list) {
        const p = describeMiss(label, m);
        if (p) problems.push(p);
      }
    // 制作者は校了者になれない（利用者決定 2026-10-18）。照合できた人どうしで重なりを見る
    const creatorUserIds = creators.flatMap((m) => (m.user ? [m.user.id] : []));
    for (const m of approvers) {
      if (m.user && creatorUserIds.includes(m.user.id))
        problems.push(
          `校了者「${m.key}」は制作者でもあります。制作者は校了者にできません（別の人を校了者にしてください）`,
        );
    }
    if (ownerTeam) {
      const p = describeTeamMiss("担当（主管担当）", ownerTeam);
      if (p) problems.push(p);
    }
    for (const [label, list] of [
      ["制作担当", productionTeams],
      ["関係担当", relatedTeams],
    ] as const)
      for (const m of list) {
        const p = describeTeamMiss(label, m);
        if (p) problems.push(p);
      }
    if (row.legacyId) {
      if (existing.has(row.legacyId))
        problems.push(`制作物 ID「${row.legacyId}」の制作物がすでにあります`);
      else if (seenLegacy.has(row.legacyId))
        problems.push(`制作物 ID「${row.legacyId}」が CSV の中で重なっています`);
      seenLegacy.add(row.legacyId);
    }
    const ok = problems.length === 0 && parsed.errors.length === 0 && row.mediaType !== null;
    const ids = (list: PersonMatch[]) => Array.from(new Set(list.map((m) => m.user!.id)));
    const input: WorkImportInput | null = ok
      ? {
          title: row.title,
          year: row.year,
          purpose: row.purpose,
          category: row.category,
          mediaType: row.mediaType!,
          ...(row.genre ? { genre: row.genre } : {}),
          ...(row.subGenre ? { subGenre: row.subGenre } : {}),
          creatorIds: ids(creators),
          managerIds: ids(managers),
          stakeholderIds: ids(stakeholders),
          approverIds: ids(approvers),
          ...(row.approvalQuorum !== null ? { approvalQuorum: row.approvalQuorum } : {}),
          ...(row.deadlineAt !== null ? { deadlineAt: row.deadlineAt } : {}),
          ...(row.publishAt !== null ? { publishAt: row.publishAt } : {}),
          ...(row.requiresPrinterSubmission !== null
            ? { requiresPrinterSubmission: row.requiresPrinterSubmission }
            : {}),
          ...(row.printQuantity !== null ? { printQuantity: row.printQuantity } : {}),
          ...(row.sizeOrLength ? { sizeOrLength: row.sizeOrLength } : {}),
          ...(row.productionDays !== null ? { productionDays: row.productionDays } : {}),
          tags: row.tags,
          ...(row.legacyId ? { legacyId: row.legacyId } : {}),
          confidentiality: row.confidentiality,
          notationCategories: row.notationCategories,
          ...(ownerTeam ? { ownerTeamId: teamIdOf(ownerTeam) } : {}),
          productionTeamIds: Array.from(new Set(productionTeams.map(teamIdOf))),
          relatedTeamIds: Array.from(new Set(relatedTeams.map(teamIdOf))),
        }
      : null;
    return {
      row,
      creators,
      managers,
      stakeholders,
      approvers,
      ownerTeam,
      productionTeams,
      relatedTeams,
      problems,
      input,
    };
  });
  return { rows, errors: parsed.errors, ready: rows.filter((r) => r.input).length };
}

function csvCell(value: string): string {
  return /[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/**
 * 雛形（委員会の制作物 DB の項目名の見出しと記入例 1 行。納期の例は 30 日後）。
 * Excel で文字化けしないよう先頭に BOM を付けるのは書き出す側
 */
export function workCsvTemplate(now: Instant = Date.now()): string {
  const header = workCsvTemplateColumns.map((c) => c.header);
  const example: Record<(typeof workCsvTemplateColumns)[number]["key"], string> = {
    title: "MF100 公式パンフレット",
    legacyId: "PR-001",
    genre: "グラフィック",
    subGenre: "印刷物（冊子）",
    category: "",
    mediaType: "",
    purpose: "来場者向け総合案内",
    ownerTeam: "PR › デザイン担当",
    productionTeams: "PR › デザイン担当",
    relatedTeams: "JIM",
    creators: "mock-creator@example.invalid",
    stakeholders: "",
    managers: "五月 主管",
    approver: "mock-approver@example.invalid",
    approvalQuorum: "",
    deadline: toJstDate(now + 30 * 86_400_000),
    publishAt: toJstDate(now + 37 * 86_400_000),
    requiresPrinterSubmission: "Yes",
    printQuantity: "3000",
    sizeOrLength: "A5・32 ページ",
    productionDays: "20",
    tags: "公式パンフ;マスター",
    confidentiality: "通常",
    notation: "A1;A2",
    year: "100",
  };
  const row = workCsvTemplateColumns.map((c) => example[c.key]);
  return `${[header, row].map((r) => r.map(csvCell).join(",")).join("\r\n")}\r\n`;
}
