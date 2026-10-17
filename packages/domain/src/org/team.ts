import { parseCsv } from "../notation/importer.ts";
import { DomainError } from "../shared/DomainError.ts";
import type { UserId } from "../shared/ids.ts";
import type { Instant } from "../shared/time.ts";
import { splitCsvList } from "../shared/csvValues.ts";

/**
 * 局のコード（Notion の担当 DB「局」の multi_select の選択肢。利用者決定 2026-10-17）。
 * 局の正式な名前（日本語）は Notion に無いので、コードだけをポリシー値として持ち、名前は管理画面で付ける。
 */
export const bureauCodes = ["JIM", "ZAI", "SSK", "EVE", "PR", "SYS", "WG", "CAP"] as const;
export type BureauCode = (typeof bureauCodes)[number];

/** 局のコードとして読めるか（大文字小文字・全角を無視） */
export function parseBureauCode(text: string): BureauCode | null {
  const key = text.normalize("NFKC").trim().toUpperCase();
  return (bureauCodes as readonly string[]).includes(key) ? (key as BureauCode) : null;
}

/** 絵文字（Notion の担当 DB「絵文字」）の長さの上限（文字の見た目の数ではなくコードポイント） */
export const TEAM_EMOJI_MAX = 8;

/**
 * 組織（局 › 担当 の 2 階層）。利用者決定 2026-10-15「組織は管理画面で管理する（Nogiku との同期は後で）」。
 * 制作物の主管担当（ownerTeamId）・制作担当（productionTeamIds）はここの ID を指す。
 * 局は親を持たず、担当は必ずどこかの局に属する。制作物は担当だけでなく局そのもの（局の直下）にも割り当てられる。
 */
export type TeamKind = "bureau" | "team"; // 局 | 担当

export interface Team {
  id: string;
  name: string;
  kind: TeamKind;
  /** 担当の属する局の ID（局は持たない） */
  parentId?: string;
  /** 同じ親の中での並び順（小さいほど上。Notion の「付番」） */
  order: number;
  // ---- Notion の担当 DB に揃えた項目（任意。docs/NOTION_ALIGNMENT.md）
  /** 局のコード（局だけ。JIM・ZAI・SSK・EVE・PR・SYS・WG・CAP） */
  code?: BureauCode;
  /** 絵文字 */
  emoji?: string;
  /**
   * 所属する人（Notion の「ユーザ」）。所属する人は、その担当が主管担当・制作担当・関係担当の制作物を
   * （非公開・取扱注意でも）見られる（利用者決定 2026-10-17。acl/authorize.ts の isInvolvedInWork）
   */
  memberIds?: UserId[];
  updatedAt: Instant;
  updatedBy: UserId;
}

export interface TeamInput {
  name: string;
  kind: TeamKind;
  parentId?: string | undefined;
  /** 省略すると同じ親の中で最後 */
  order?: number | undefined;
  /** 局のコード（局だけ）。null・空で外す */
  code?: string | null | undefined;
  emoji?: string | null | undefined;
  memberIds?: readonly string[] | null | undefined;
}

export type TeamMetadata = Pick<Team, "code" | "emoji" | "memberIds">;

/** 登録できる局・担当の数の上限（ポリシー値） */
export const TEAM_MAX = 300;
/** 名前の長さの上限（文字数） */
export const TEAM_NAME_MAX = 40;
/** 「局 › 担当」の区切り（表示・CSV の書き方の両方） */
export const TEAM_PATH_SEPARATOR = " › ";

/** 名前の照合用（全角英数・空白のゆれ・大文字小文字を無視） */
export function teamNameKey(value: string): string {
  return value.normalize("NFKC").replace(/\s+/g, " ").trim().toLowerCase();
}

const invalid = (field: string, reason: string) =>
  new DomainError("team_invalid", { field, reason });

/**
 * 入力を確かめて整える。名前は前後の空白を除く。
 * - 名前が空・長すぎる、担当に局が無い（親が無い・親が局でない）、局に親がある → team_invalid
 * - 同じ親の中に同じ名前がある（自分は除く） → team_duplicate
 * - 並び順を省略すると、同じ親の中で最後（いちばん大きい順 + 1）
 */
export function validateTeam(
  input: TeamInput,
  existing: readonly Team[],
  selfId?: string,
): { name: string; kind: TeamKind; parentId?: string; order: number } & TeamMetadata {
  const name = input.name.trim();
  if (name === "") throw invalid("name", "required");
  if (Array.from(name).length > TEAM_NAME_MAX) throw invalid("name", "too_long");
  const others = existing.filter((t) => t.id !== selfId);
  const parentId = input.parentId?.trim() || undefined;
  const meta: TeamMetadata = {};
  if (input.kind === "bureau") {
    if (parentId !== undefined) throw invalid("parentId", "bureau_has_parent");
    const codeText = input.code?.trim() ?? "";
    if (codeText !== "") {
      const code = parseBureauCode(codeText);
      if (!code) throw invalid("code", "unknown");
      // 同じコードの局は 1 つ
      if (others.some((t) => t.kind === "bureau" && t.code === code))
        throw new DomainError("team_duplicate", { code, name, parentId: null });
      meta.code = code;
    }
  } else if (input.kind === "team") {
    if (input.code) throw invalid("code", "team_has_code");
    if (parentId === undefined) throw invalid("parentId", "required");
    const parent = others.find((t) => t.id === parentId);
    if (!parent || parent.kind !== "bureau") throw invalid("parentId", "not_bureau");
  } else {
    throw invalid("kind", "unknown");
  }
  const siblings = others.filter((t) => t.kind === input.kind && t.parentId === parentId);
  const key = teamNameKey(name);
  if (siblings.some((t) => teamNameKey(t.name) === key))
    throw new DomainError("team_duplicate", { name, parentId: parentId ?? null });
  let order: number;
  if (input.order !== undefined) {
    if (!Number.isInteger(input.order) || Math.abs(input.order) > 1_000_000)
      throw invalid("order", "not_integer");
    order = input.order;
  } else {
    order = siblings.reduce((max, t) => Math.max(max, t.order), 0) + 1;
  }
  const emoji = input.emoji?.trim() ?? "";
  if (emoji !== "") {
    if (Array.from(emoji).length > TEAM_EMOJI_MAX || /\s/.test(emoji))
      throw invalid("emoji", "too_long");
    meta.emoji = emoji;
  }
  if (input.memberIds) {
    const ids: string[] = [];
    for (const raw of input.memberIds) {
      const id = raw.trim();
      if (id === "") throw invalid("memberIds", "blank_id");
      if (!ids.includes(id)) ids.push(id);
    }
    if (ids.length > 0) meta.memberIds = ids;
  }
  return {
    name,
    kind: input.kind,
    ...(parentId !== undefined ? { parentId } : {}),
    order,
    ...meta,
  };
}

/** 局をコードで引く（CSV の「局」にコードが書かれたとき） */
export function findBureauByCode(code: string, teams: readonly Team[]): Team | null {
  const c = parseBureauCode(code);
  if (!c) return null;
  return teams.find((t) => t.kind === "bureau" && t.code === c) ?? null;
}

/** その人が所属する局・担当の ID（Principal.teamIds を組むとき・通知の受信者の所属を添えるときに使う） */
export function memberTeamIds(
  teams: readonly Pick<Team, "id" | "memberIds">[],
  userId: UserId,
): string[] {
  return teams.filter((t) => t.memberIds?.includes(userId)).map((t) => t.id);
}

/** 局の表示名「PR 広報局」（絵文字があれば先頭に）。担当は名前だけ */
export function teamDisplayName(team: Pick<Team, "name" | "code" | "emoji">): string {
  return [team.emoji, team.code, team.name].filter(Boolean).join(" ");
}

const byOrderThenName = (a: Team, b: Team) =>
  a.order - b.order || a.name.localeCompare(b.name, "ja");

/**
 * 表示の順に並べる: 局を（並び順 → 名前）の順に、それぞれの直後にその局の担当を（並び順 → 名前）の順に。
 * 親の局が見つからない担当（壊れたデータ）は最後にまとめる。
 */
export function sortTeams(teams: readonly Team[]): Team[] {
  const bureaus = teams.filter((t) => t.kind === "bureau").sort(byOrderThenName);
  const bureauIds = new Set(bureaus.map((b) => b.id));
  const out: Team[] = [];
  for (const b of bureaus) {
    out.push(b);
    out.push(
      ...teams.filter((t) => t.kind === "team" && t.parentId === b.id).sort(byOrderThenName),
    );
  }
  out.push(
    ...teams
      .filter((t) => t.kind === "team" && (t.parentId === undefined || !bureauIds.has(t.parentId)))
      .sort(byOrderThenName),
  );
  return out;
}

/** 「広報局 › デザイン担当」（担当）・「広報局」（局）。知らない ID は null */
export function teamPath(id: string, teams: readonly Team[]): string | null {
  const team = teams.find((t) => t.id === id);
  if (!team) return null;
  if (team.kind === "bureau" || team.parentId === undefined) return team.name;
  const parent = teams.find((t) => t.id === team.parentId);
  return parent ? `${parent.name}${TEAM_PATH_SEPARATOR}${team.name}` : team.name;
}

export type TeamMatch =
  | { kind: "ok"; team: Team }
  | { kind: "not_found" }
  | { kind: "ambiguous"; candidates: Team[] };

/** 「›」「/」「／」「>」「＞」で局と担当を区切る（NFKC で全角はそろえる） */
const PATH_SPLIT = /\s*[›/>]\s*/;

function oneOf(candidates: Team[]): TeamMatch {
  if (candidates.length === 1) return { kind: "ok", team: candidates[0]! };
  if (candidates.length === 0) return { kind: "not_found" };
  return { kind: "ambiguous", candidates: sortTeams(candidates) };
}

/**
 * CSV や入力に書かれた局・担当を引く。
 * 書き方: 「局 › 担当」「局/担当」「局／担当」「局>担当」、担当の名前だけ（同じ名前の担当が 1 つのとき）、局の名前だけ。
 * 名前は全角英数・空白のゆれ・大文字小文字を無視して完全一致で比べる。
 */
export function matchTeam(ref: string, teams: readonly Team[]): TeamMatch {
  const key = teamNameKey(ref);
  if (key === "") return { kind: "not_found" };
  // 名前そのもの（区切りの文字を含む名前もここで当たる）。局はコード（PR など）でも引ける
  const whole = teams.filter((t) => teamNameKey(t.name) === key);
  if (whole.length) return oneOf(whole);
  const byCode = findBureauByCode(ref, teams);
  if (byCode) return { kind: "ok", team: byCode };
  const parts = key.split(PATH_SPLIT).filter((p) => p !== "");
  if (parts.length !== 2) return { kind: "not_found" };
  const [bureauKey, childKey] = parts as [string, string];
  const bureaus = teams.filter(
    (t) =>
      t.kind === "bureau" &&
      (teamNameKey(t.name) === bureauKey || (t.code && teamNameKey(t.code) === bureauKey)),
  );
  const bureauIds = new Set(bureaus.map((b) => b.id));
  return oneOf(
    teams.filter(
      (t) =>
        t.kind === "team" &&
        t.parentId !== undefined &&
        bureauIds.has(t.parentId) &&
        teamNameKey(t.name) === childKey,
    ),
  );
}

export type WorkTeamAxis = "owner" | "production";

interface WorkTeams {
  ownerTeamId?: string | null;
  productionTeamIds: readonly string[];
}

/** 制作物の主管担当（1 つ）か制作担当（複数）の ID。重なりは除く */
export function workTeamIds(work: WorkTeams, axis: WorkTeamAxis): string[] {
  return axis === "owner"
    ? work.ownerTeamId
      ? [work.ownerTeamId]
      : []
    : Array.from(new Set(work.productionTeamIds));
}

/**
 * 制作物一覧の担当での絞り込み（利用者決定 2026-10-16: 一覧は入れ子にせずに並べ、絞り込み・並べ替えで担当を使う）。
 * 担当を選ぶとその担当の制作物、局を選ぶとその局そのもの（局の直下）とその局の担当の制作物。
 * 主管担当は 1 つ、制作担当はどれか 1 つが当たればよい。知らない ID を選んだら何も当たらない。
 */
export function workBelongsToTeam(
  work: WorkTeams,
  teams: readonly Team[],
  axis: WorkTeamAxis,
  teamId: string,
): boolean {
  const byId = new Map(teams.map((t) => [t.id, t]));
  const picked = byId.get(teamId);
  if (!picked) return false;
  return workTeamIds(work, axis).some((id) => {
    if (id === teamId) return true;
    return picked.kind === "bureau" && byId.get(id)?.parentId === teamId;
  });
}

/** 制作物一覧の並べ替え: 校正の締切・納期（近い順。無いものは後ろ）・題名・主管担当・制作担当（組織の並び順。未設定は後ろ） */
export type WorkSortKey = "accepting" | "deadline" | "title" | "owner" | "production";

/**
 * 制作物一覧を並べ替える（新しい配列を返す）。同じ順位のものは 校正の締切 → 題名 の順。
 * 担当での並べ替えは sortTeams の順（局 → その局の担当）。制作担当が複数あれば、いちばん上の担当の位置で並べる。
 */
export function sortWorks<
  W extends WorkTeams & {
    title: string;
    acceptingDeadlineAt?: number | null;
    deadlineAt?: number | null;
  },
>(works: readonly W[], teams: readonly Team[], key: WorkSortKey): W[] {
  const rank = new Map(sortTeams(teams).map((t, i) => [t.id, i]));
  const teamRank = (w: W, axis: WorkTeamAxis) =>
    Math.min(Infinity, ...workTeamIds(w, axis).map((id) => rank.get(id) ?? Infinity));
  const near = (a?: number | null, b?: number | null) => (a ?? Infinity) - (b ?? Infinity) || 0;
  const tie = (a: W, b: W) =>
    near(a.acceptingDeadlineAt, b.acceptingDeadlineAt) || a.title.localeCompare(b.title, "ja");
  const primary = (a: W, b: W): number => {
    switch (key) {
      case "deadline":
        return near(a.deadlineAt, b.deadlineAt);
      case "title":
        return a.title.localeCompare(b.title, "ja");
      case "owner":
      case "production":
        return teamRank(a, key) - teamRank(b, key) || 0;
      default:
        return 0;
    }
  };
  return [...works].sort((a, b) => primary(a, b) || tie(a, b));
}

// ---- CSV での取り込み ----

export interface TeamCsvRow {
  /** CSV の行番号（1 始まり。見出しの行を含む） */
  line: number;
  /** 局（名前かコード）。1 行に 1 つ */
  bureau: string;
  /** null = 局だけを定める行 */
  team: string | null;
  /** 並び順（Notion の「付番」） */
  order?: number;
  /** 絵文字（Notion の「絵文字」） */
  emoji?: string;
  /** 所属する人の書き方のまま（メールアドレスかユーザー名。照合は取り込む側） */
  members: string[];
}

export interface TeamCsvParseResult {
  rows: TeamCsvRow[];
  /** 行の問題（line 0 はファイル全体の問題）。問題のある行は rows に入れない */
  errors: { line: number; message: string }[];
}

/** 列の見出し（委員会の担当 DB と同じ列名: 局・担当名・付番・絵文字・ユーザ。以前の列名も読む） */
export const teamCsvColumns = {
  bureau: ["局", "局名", "bureau"],
  team: ["担当", "担当名", "team"],
  order: ["順", "順番", "並び順", "付番", "order"],
  emoji: ["絵文字", "emoji"],
  members: ["ユーザ", "ユーザー", "メンバー", "所属", "members"],
} as const;
type TeamColumn = keyof typeof teamCsvColumns;

function findTeamHeader(
  rows: string[][],
): { index: number; map: Partial<Record<TeamColumn, number>> } | null {
  for (let i = 0; i < Math.min(rows.length, 10); i++) {
    const map: Partial<Record<TeamColumn, number>> = {};
    rows[i]!.forEach((cell, k) => {
      const v = teamNameKey(cell);
      for (const col of Object.keys(teamCsvColumns) as TeamColumn[])
        if (map[col] === undefined && teamCsvColumns[col].some((a) => teamNameKey(a) === v))
          map[col] = k;
    });
    if (map.bureau !== undefined) return { index: i, map };
  }
  return null;
}

/**
 * 組織の CSV を読む。列は見出しの名前で探す: 局（必須。名前かコード。局名・bureau でも可）・担当（担当名・team）・
 * 順（付番。整数）・絵文字・ユーザ（所属する人。「;」「,」区切り）。
 * 担当が空の行は局だけを定める。空の行・見出しより前の行は読まない。
 * アプリの担当はちょうど 1 つの局に属するので、局が複数書かれた行は問題として返す（取り込まない）。
 */
export function parseTeamCsv(text: string): TeamCsvParseResult {
  const table = parseCsv(text);
  const header = findTeamHeader(table);
  if (!header)
    return {
      rows: [],
      errors: [
        {
          line: 0,
          message: "見出しの行が見つかりません。1 行目に「局」「担当」などの列名を書いてください",
        },
      ],
    };
  const rows: TeamCsvRow[] = [];
  const errors: TeamCsvParseResult["errors"] = [];
  for (let i = header.index + 1; i < table.length; i++) {
    const cells = table[i]!;
    if (cells.every((c) => c.trim() === "")) continue;
    const line = i + 1;
    const get = (col: TeamColumn) => {
      const k = header.map[col];
      return k === undefined ? "" : (cells[k] ?? "").trim();
    };
    const bureaus = splitCsvList(get("bureau"));
    const bureau = bureaus[0] ?? "";
    const team = get("team");
    const orderText = get("order").normalize("NFKC");
    const emoji = get("emoji");
    const problems: string[] = [];
    if (bureau === "") problems.push("局がありません");
    if (bureaus.length > 1)
      problems.push(
        `局が ${bureaus.length} つ書かれています。担当が属する局は 1 つだけ書いてください`,
      );
    for (const [label, name] of [
      ["局", bureau],
      ["担当", team],
    ] as const)
      if (Array.from(name).length > TEAM_NAME_MAX)
        problems.push(`${label}の名前は ${TEAM_NAME_MAX} 文字までです`);
    let order: number | undefined;
    if (orderText !== "") {
      const n = Number(orderText);
      if (Number.isInteger(n) && Math.abs(n) <= 1_000_000) order = n;
      else problems.push(`順「${orderText}」を整数として読めません`);
    }
    if (emoji !== "" && (Array.from(emoji).length > TEAM_EMOJI_MAX || /\s/.test(emoji)))
      problems.push(`絵文字「${emoji}」が長すぎます`);
    if (problems.length) {
      errors.push({ line, message: problems.join("。") });
      continue;
    }
    rows.push({
      line,
      bureau,
      team: team === "" ? null : team,
      ...(order !== undefined ? { order } : {}),
      ...(emoji !== "" ? { emoji } : {}),
      members: splitCsvList(get("members")),
    });
  }
  if (rows.length > TEAM_MAX)
    errors.push({ line: 0, message: `1 回に取り込めるのは ${TEAM_MAX} 行までです` });
  if (rows.length === 0 && errors.length === 0)
    errors.push({ line: 0, message: "取り込む行がありません" });
  return { rows, errors };
}

/** 取り込みで作る 1 件（局だけの行は team: null）。局の行で bureau がコードなら code にも入れる */
export interface TeamImportEntry {
  bureau: string;
  team: string | null;
  order?: number;
  code?: BureauCode;
  emoji?: string;
  /** 所属する人（照合済みの ID。取り込む側が入れる） */
  memberIds?: string[];
}

export interface TeamImportPlan {
  /** 新しく作る局・担当。局は担当より前に並ぶとは限らない（作る側で局を先に作る） */
  create: TeamImportEntry[];
  /** すでにある（名前が一致した）行の数 */
  existing: number;
}

/** CSV の「局」（名前かコード）に当たる既存の局の ID */
function existingBureauId(ref: string, existing: readonly Team[]): string | undefined {
  const key = teamNameKey(ref);
  const byName = existing.find((t) => t.kind === "bureau" && teamNameKey(t.name) === key);
  return (byName ?? findBureauByCode(ref, existing) ?? undefined)?.id;
}

/**
 * 取り込みの計画: 行ごとに、局・担当がもうあるか（名前かコードで照合）、新しく作るか。
 * 担当の行の局が無ければ、その局も作る（「局」がコードなら名前もコードにし、code を付ける。名前は管理画面で直せる）。
 * 同じ CSV を何度取り込んでも二重にはならない（冪等）。
 * `memberIds` を渡すと（行番号 → 照合済みの ID）、作る担当にその人を入れる。
 */
export function planTeamImport(
  rows: readonly TeamCsvRow[],
  existing: readonly Team[],
  memberIds: ReadonlyMap<number, readonly string[]> = new Map(),
): TeamImportPlan {
  const existingTeams = new Set(
    existing
      .filter((t) => t.kind === "team" && t.parentId !== undefined)
      .map((t) => `${t.parentId}\u0000${teamNameKey(t.name)}`),
  );
  const create: TeamImportEntry[] = [];
  const plannedBureaus = new Map<string, TeamImportEntry>();
  const plannedTeams = new Set<string>();
  let existingCount = 0;
  const bureauEntry = (row: TeamCsvRow): TeamImportEntry => {
    const code = parseBureauCode(row.bureau);
    return { bureau: row.bureau, team: null, ...(code ? { code } : {}) };
  };
  const members = (row: TeamCsvRow) => {
    const ids = memberIds.get(row.line);
    return ids && ids.length > 0 ? { memberIds: [...ids] } : {};
  };
  for (const row of rows) {
    const bKey = teamNameKey(row.bureau);
    const bureauId = existingBureauId(row.bureau, existing);
    if (row.team === null) {
      if (bureauId !== undefined) existingCount++;
      else {
        const planned = plannedBureaus.get(bKey);
        if (planned) {
          if (planned.order === undefined && row.order !== undefined) planned.order = row.order;
        } else {
          const entry: TeamImportEntry = {
            ...bureauEntry(row),
            ...(row.order !== undefined ? { order: row.order } : {}),
            ...(row.emoji ? { emoji: row.emoji } : {}),
            ...members(row),
          };
          plannedBureaus.set(bKey, entry);
          create.push(entry);
        }
      }
      continue;
    }
    const tKey = teamNameKey(row.team);
    if (bureauId !== undefined && existingTeams.has(`${bureauId}\u0000${tKey}`)) {
      existingCount++;
      continue;
    }
    if (bureauId === undefined && !plannedBureaus.has(bKey)) {
      const entry = bureauEntry(row);
      plannedBureaus.set(bKey, entry);
      create.push(entry);
    }
    const plannedKey = `${bKey}\u0000${tKey}`;
    if (plannedTeams.has(plannedKey)) continue;
    plannedTeams.add(plannedKey);
    create.push({
      bureau: row.bureau,
      team: row.team,
      ...(row.order !== undefined ? { order: row.order } : {}),
      ...(row.emoji ? { emoji: row.emoji } : {}),
      ...members(row),
    });
  }
  return { create, existing: existingCount };
}

/**
 * 組織の CSV の雛形（見出しと記入例 3 行。委員会の担当 DB と同じ列名）。
 * Excel で文字化けしないよう先頭に BOM を付けるのは書き出す側
 */
export function teamCsvTemplate(): string {
  return [
    "局,担当名,付番,絵文字,ユーザ",
    "PR,デザイン担当,1,🎨,mock-creator@example.invalid",
    "PR,SNS担当,2,📣,",
    "JIM,渉外担当,1,,",
  ]
    .map((l) => `${l}\r\n`)
    .join("");
}
