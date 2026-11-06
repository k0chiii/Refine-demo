/**
 * 入口を仕事で分ける（利用者決定 2026-10-19「ホームいらなくね？制作（ホーム）/校正（ホーム）でいいのかな」）。
 * 制作 = 自分が作るもの、校正 = 自分が確かめるもの。ここは行の分類・並び・最初に開く入口を決める純粋な規則だけを持つ
 * （画面の文言は持たない。ID と数だけ）。
 */

/** 入口（ホームの代わり） */
export const workspaces = ["make", "check"] as const;
export type Workspace = (typeof workspaces)[number];

export function isWorkspace(value: unknown): value is Workspace {
  return typeof value === "string" && (workspaces as readonly string[]).includes(value);
}

/** 最初の入口を決める材料（校正のやり残し） */
export interface LandingFacts {
  /** 割り当てられたが、まだ校正を完了していない版 */
  reviewsUnfinished: number;
  /** 自分が担当の未完了の専門確認 */
  checksPending: number;
  /** 自分が校了する版（コメントも専門確認も片付いている） */
  finalizeReady: number;
}

/** 校正のやり残しがあれば校正、無ければ制作 */
export function defaultWorkspace(facts: LandingFacts): Workspace {
  return facts.reviewsUnfinished + facts.checksPending + facts.finalizeReady > 0 ? "check" : "make";
}

/**
 * 開く入口。端末で最後に使った入口（保存値。形は信用しない）があればそれ、無ければ既定。
 * 既定を決める材料がまだ無いとき（読み込み中）は null。
 */
export function landingWorkspace(
  remembered: unknown,
  facts: LandingFacts | undefined,
): Workspace | null {
  if (isWorkspace(remembered)) return remembered;
  return facts ? defaultWorkspace(facts) : null;
}

// ---------- 制作 ----------

/** 進行中の分け方: 要対応（自分の手が要る）／校正中（待っている） */
export type MakeGroup = "turn" | "waiting";
/** 行の次の操作: 対応する／版を提出／見る */
export type MakeAction = "respond" | "submit" | "view";

/** 制作者の制作物 1 件の状況 */
export interface MakeFacts {
  /** 受付中の版がある */
  accepting: boolean;
  /** 自分が判断できる未対応のコメント（受付中の版） */
  toRespond: number;
  /** 自分が版を提出できる */
  canSubmit: boolean;
}

/**
 * 進行中の制作物を「要対応」と「校正中」に分け、次の操作を 1 つ決める。
 * - 未対応のコメントがある → 要対応・対応する
 * - 受付中の版が無く、版を出せる（まだ出していない・受付が終わった）→ 要対応・版を提出
 * - それ以外 → 校正中（待っている）・見る
 */
export function classifyMakeRow(f: MakeFacts): { group: MakeGroup; action: MakeAction } {
  if (f.toRespond > 0) return { group: "turn", action: "respond" };
  if (!f.accepting && f.canSubmit) return { group: "turn", action: "submit" };
  return { group: "waiting", action: "view" };
}

/** 制作ページの 3 つの切り替え */
export const makeTabs = ["active", "draft", "done"] as const;
export type MakeTab = (typeof makeTabs)[number];
export const isMakeTab = (v: unknown): v is MakeTab =>
  typeof v === "string" && (makeTabs as readonly string[]).includes(v);

// ---------- 校正 ----------

/** 校正の仕事の種類: 校正する（割当）／確認する（専門確認）／校了する */
export type CheckKind = "review" | "check" | "finalize";
/** 仕事の進み具合: 未着手／確認中／完了 */
export type CheckProgress = "pending" | "viewed" | "done";
export const checkTabs = ["todo", "doing", "done"] as const;
export type CheckTab = (typeof checkTabs)[number];
export const isCheckTab = (v: unknown): v is CheckTab =>
  typeof v === "string" && (checkTabs as readonly string[]).includes(v);

/** 割当の状態から仕事の進み具合（pending=未着手、viewed=確認中、responded・excused=完了） */
export function checkStateOfAssignment(
  state: "pending" | "viewed" | "responded" | "excused",
): CheckProgress {
  return state === "pending" ? "pending" : state === "viewed" ? "viewed" : "done";
}

const tabOfState: Record<CheckProgress, CheckTab> = {
  pending: "todo",
  viewed: "doing",
  done: "done",
};

export interface CheckEntryLike {
  /** 仕事の種類。校了する行は一覧の先頭に固める（無ければ締切順だけ） */
  kind?: CheckKind;
  state: CheckProgress;
  /** 校正の締切（無ければ null） */
  deadlineAt: number | null;
  title: string;
}

/**
 * 校了する行を先頭に（校了は締切の手前の最後の 1 手）、次に締切の早い順（締切の無いものは後ろ）。同じなら題名順
 */
export function compareCheckEntries(a: CheckEntryLike, b: CheckEntryLike): number {
  return (
    Number(b.kind === "finalize") - Number(a.kind === "finalize") ||
    (a.deadlineAt ?? Infinity) - (b.deadlineAt ?? Infinity) ||
    a.title.localeCompare(b.title, "ja")
  );
}

/** 仕事を 3 つの切り替えに分け、それぞれ締切順に並べる */
export function groupCheckEntries<T extends CheckEntryLike>(
  entries: readonly T[],
): Record<CheckTab, T[]> {
  const out: Record<CheckTab, T[]> = { todo: [], doing: [], done: [] };
  for (const e of entries) out[tabOfState[e.state]].push(e);
  for (const tab of checkTabs) out[tab].sort(compareCheckEntries);
  return out;
}
