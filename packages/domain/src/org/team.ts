import { parseCsv } from "../notation/importer.ts";
import { DomainError } from "../shared/DomainError.ts";
import type { UserId } from "../shared/ids.ts";
import type { Instant } from "../shared/time.ts";

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
  /** 同じ親の中での並び順（小さいほど上） */
  order: number;
  updatedAt: Instant;
  updatedBy: UserId;
}

export interface TeamInput {
  name: string;
  kind: TeamKind;
  parentId?: string | undefined;
  /** 省略すると同じ親の中で最後 */
  order?: number | undefined;
}

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
): { name: string; kind: TeamKind; parentId?: string; order: number } {
  const name = input.name.trim();
  if (name === "") throw invalid("name", "required");
  if (Array.from(name).length > TEAM_NAME_MAX) throw invalid("name", "too_long");
  const others = existing.filter((t) => t.id !== selfId);
  const parentId = input.parentId?.trim() || undefined;
  if (input.kind === "bureau") {
    if (parentId !== undefined) throw invalid("parentId", "bureau_has_parent");
  } else if (input.kind === "team") {
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
  return { name, kind: input.kind, ...(parentId !== undefined ? { parentId } : {}), order };
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
  // 名前そのもの（区切りの文字を含む名前もここで当たる）
  const whole = teams.filter((t) => teamNameKey(t.name) === key);
  if (whole.length) return oneOf(whole);
  const parts = key.split(PATH_SPLIT).filter((p) => p !== "");
  if (parts.length !== 2) return { kind: "not_found" };
  const [bureauKey, childKey] = parts as [string, string];
  const bureaus = teams.filter((t) => t.kind === "bureau" && teamNameKey(t.name) === bureauKey);
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

export interface WorkTeamGroup<W> {
  /** null = 担当未設定（担当が無い、またはもう無い ID を指している） */
  bureau: Team | null;
  /** team が null = 局そのもの（局の直下）に割り当てた制作物。未設定のまとまりでは {team: null} が 1 つだけ */
  teams: { team: Team | null; works: W[] }[];
  /** このまとまりの制作物の数（同じ制作物は 1 つと数える） */
  count: number;
}

/**
 * 制作物を局 › 担当で入れ子にまとめる（制作物一覧の「担当別」表示）。
 * - 局は sortTeams の順、局の中は「局の直下」→ 担当（並び順）の順。制作物の無いまとまりは出さない。未設定は最後
 * - axis "owner": 主管担当（ownerTeamId）で。制作物はどこか 1 か所に出る
 * - axis "production": 制作担当（productionTeamIds）で。複数の担当の制作物はそれぞれに出る。1 つも無ければ未設定
 * - 担当の中の並びは入力の順のまま
 */
export function groupWorksByTeam<
  W extends { ownerTeamId?: string | null; productionTeamIds: readonly string[] },
>(works: readonly W[], teams: readonly Team[], axis: WorkTeamAxis): WorkTeamGroup<W>[] {
  const byId = new Map(teams.map((t) => [t.id, t]));
  /** 局の ID → （担当の ID か局の直下 "" → 制作物） */
  const buckets = new Map<string, Map<string, W[]>>();
  const unassigned: W[] = [];
  const put = (bureauId: string, slot: string, work: W) => {
    let slots = buckets.get(bureauId);
    if (!slots) buckets.set(bureauId, (slots = new Map()));
    const list = slots.get(slot) ?? [];
    if (!list.includes(work)) list.push(work);
    slots.set(slot, list);
  };
  for (const work of works) {
    const ids =
      axis === "owner"
        ? work.ownerTeamId
          ? [work.ownerTeamId]
          : []
        : Array.from(new Set(work.productionTeamIds));
    let placed = false;
    for (const id of ids) {
      const team = byId.get(id);
      if (!team) continue;
      if (team.kind === "bureau") {
        put(team.id, "", work);
        placed = true;
      } else if (team.parentId !== undefined && byId.get(team.parentId)?.kind === "bureau") {
        put(team.parentId, team.id, work);
        placed = true;
      }
    }
    if (!placed) unassigned.push(work);
  }
  const out: WorkTeamGroup<W>[] = [];
  for (const bureau of sortTeams(teams)) {
    if (bureau.kind !== "bureau") continue;
    const slots = buckets.get(bureau.id);
    if (!slots) continue;
    const entries: { team: Team | null; works: W[] }[] = [];
    const direct = slots.get("");
    if (direct?.length) entries.push({ team: null, works: direct });
    for (const team of sortTeams(teams)) {
      if (team.kind !== "team" || team.parentId !== bureau.id) continue;
      const list = slots.get(team.id);
      if (list?.length) entries.push({ team, works: list });
    }
    if (!entries.length) continue;
    out.push({ bureau, teams: entries, count: new Set(entries.flatMap((e) => e.works)).size });
  }
  if (unassigned.length)
    out.push({
      bureau: null,
      teams: [{ team: null, works: unassigned }],
      count: unassigned.length,
    });
  return out;
}

// ---- CSV での取り込み ----

export interface TeamCsvRow {
  /** CSV の行番号（1 始まり。見出しの行を含む） */
  line: number;
  bureau: string;
  /** null = 局だけを定める行 */
  team: string | null;
  order?: number;
}

export interface TeamCsvParseResult {
  rows: TeamCsvRow[];
  /** 行の問題（line 0 はファイル全体の問題）。問題のある行は rows に入れない */
  errors: { line: number; message: string }[];
}

const teamCsvColumns = {
  bureau: ["局", "局名", "bureau"],
  team: ["担当", "担当名", "team"],
  order: ["順", "順番", "並び順", "order"],
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
 * 組織の CSV を読む。列は見出しの名前で探す: 局（必須。局名・bureau でも可）・担当（担当名・team）・順（整数）。
 * 担当が空の行は局だけを定める。空の行・見出しより前の行は読まない。
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
    const bureau = get("bureau");
    const team = get("team");
    const orderText = get("order").normalize("NFKC");
    const problems: string[] = [];
    if (bureau === "") problems.push("局がありません");
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
    if (problems.length) {
      errors.push({ line, message: problems.join("。") });
      continue;
    }
    rows.push({
      line,
      bureau,
      team: team === "" ? null : team,
      ...(order !== undefined ? { order } : {}),
    });
  }
  if (rows.length > TEAM_MAX)
    errors.push({ line: 0, message: `1 回に取り込めるのは ${TEAM_MAX} 行までです` });
  if (rows.length === 0 && errors.length === 0)
    errors.push({ line: 0, message: "取り込む行がありません" });
  return { rows, errors };
}

export interface TeamImportPlan {
  /** 新しく作る局・担当（局だけの行は team: null）。局は担当より前に並ぶとは限らない（作る側で局を先に作る） */
  create: { bureau: string; team: string | null; order?: number }[];
  /** すでにある（名前が一致した）行の数 */
  existing: number;
}

/**
 * 取り込みの計画: 行ごとに、局・担当がもうあるか（名前で照合）、新しく作るか。
 * 担当の行の局が無ければ、その局も作る。同じ CSV を何度取り込んでも二重にはならない（冪等）。
 */
export function planTeamImport(
  rows: readonly TeamCsvRow[],
  existing: readonly Team[],
): TeamImportPlan {
  const bureauIdByKey = new Map<string, string>();
  for (const t of existing) if (t.kind === "bureau") bureauIdByKey.set(teamNameKey(t.name), t.id);
  const existingTeams = new Set(
    existing
      .filter((t) => t.kind === "team" && t.parentId !== undefined)
      .map((t) => `${t.parentId}\u0000${teamNameKey(t.name)}`),
  );
  const create: TeamImportPlan["create"] = [];
  const plannedBureaus = new Map<string, TeamImportPlan["create"][number]>();
  const plannedTeams = new Set<string>();
  let existingCount = 0;
  for (const row of rows) {
    const bKey = teamNameKey(row.bureau);
    const bureauId = bureauIdByKey.get(bKey);
    if (row.team === null) {
      if (bureauId !== undefined) existingCount++;
      else {
        const planned = plannedBureaus.get(bKey);
        if (planned) {
          if (planned.order === undefined && row.order !== undefined) planned.order = row.order;
        } else {
          const entry = {
            bureau: row.bureau,
            team: null,
            ...(row.order !== undefined ? { order: row.order } : {}),
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
      const entry = { bureau: row.bureau, team: null };
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
    });
  }
  return { create, existing: existingCount };
}

/** 組織の CSV の雛形（見出しと記入例 3 行）。Excel で文字化けしないよう先頭に BOM を付けるのは書き出す側 */
export function teamCsvTemplate(): string {
  return ["局,担当,順", "広報局,デザイン担当,1", "広報局,SNS担当,2", "総務局,渉外担当,1"]
    .map((l) => `${l}\r\n`)
    .join("");
}
