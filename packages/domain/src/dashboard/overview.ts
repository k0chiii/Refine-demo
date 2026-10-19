import type { Resolution } from "../comment/CommentThread.ts";
import type { Team } from "../org/team.ts";
import type { Instant } from "../shared/time.ts";
import type { WorkLifecycle } from "../work/Work.ts";

/**
 * ホームの「制作物の状況」（全体の数字と表）の集計に使う純粋な規則。
 * 画面の文言は持たない（段階の ID と数だけ）。閾値は呼び出し側（application のポリシー値）から渡す。
 */

/** 制作物の段階（校正の進み方。ライフサイクルと受付中の版から決まる） */
export const workStages = ["unsubmitted", "reviewing", "lapsed", "on_hold", "finalized"] as const;
export type WorkStage = (typeof workStages)[number];

/**
 * 段階を決める。下書き・取消は数えない（null）。
 * - 進行中で受付中の版がある → reviewing
 * - 進行中で版はあるが受付が終わっている（期限到来など）→ lapsed（次の版か校了を待っている）
 * - 進行中で版がまだない → unsubmitted
 */
export function workStageOf(input: {
  lifecycle: WorkLifecycle;
  /** 受付中の版があるか */
  accepting: boolean;
  /** 無効でない版が 1 つでもあるか */
  hasRevision: boolean;
}): WorkStage | null {
  switch (input.lifecycle) {
    case "draft":
    case "cancelled":
      return null;
    case "finalized":
      return "finalized";
    case "on_hold":
      return "on_hold";
    case "active":
      if (input.accepting) return "reviewing";
      return input.hasRevision ? "lapsed" : "unsubmitted";
  }
}

/** 段階ごとの制作物の数（全部の段階を 0 から数える） */
export function tallyStages(stages: Iterable<WorkStage>): Record<WorkStage, number> {
  const out = Object.fromEntries(workStages.map((s) => [s, 0])) as Record<WorkStage, number>;
  for (const s of stages) out[s]++;
  return out;
}

/** 指摘がまだ片付いていないか（未対応・確認済み・採用済み未反映。反映済み・不採用・持越は片付いた扱い） */
export function isUnresolvedResolution(resolution: Resolution): boolean {
  return resolution === "open" || resolution === "acknowledged" || resolution === "accepted";
}

/** 指摘の数: 未解決と、片付いたもの */
export function tallyResolutions(resolutions: Iterable<Resolution>): {
  open: number;
  done: number;
} {
  let open = 0;
  let done = 0;
  for (const r of resolutions) {
    if (isUnresolvedResolution(r)) open++;
    else done++;
  }
  return { open, done };
}

/** 注意の度合い: 期限超過 > 期限が近い > 手を付けるものがある > 落ち着いている */
export type WorkUrgency = "overdue" | "soon" | "open" | "calm";

/** 表の 1 行（制作物 1 件） */
export interface WorkOverviewRow {
  workId: string;
  title: string;
  stage: WorkStage;
  /** 受付中の版（無ければ最新の版） */
  revisionId: string | null;
  revisionLabel: string | null;
  /** 受付中の版の校正期限（受付中でなければ null） */
  reviewDeadlineAt: Instant | null;
  /** 制作物の納期 */
  deliveryAt: Instant | null;
  /** 受付中の版の未解決の指摘 */
  unresolved: number;
  /** 受付中の版の指摘の合計 */
  threads: number;
  /** 受付中の版に割り当てた校正者の数と、確認を終えた数（免除を含む） */
  reviewersTotal: number;
  reviewersDone: number;
  /** 受付中の版の未完了の専門確認 */
  checksPending: number;
  /** 主管担当の局の名前（未設定は ""） */
  bureau: string;
  /** 自分が制作者の制作物か（制作ページの「進行中」に出す） */
  isCreator: boolean;
  /** 校了の進み（宣言の済んだ人数 / 校了とみなす人数）。宣言の数は受付中で校了者が 2 人以上のときだけ数える（それ以外は 0） */
  approvalDeclared: number;
  approvalQuorum: number;
  /** 次の締切（{@link nextDeadlineOf}） */
  nextDeadlineAt: Instant | null;
  /** 注意の度合い（{@link workUrgency}） */
  urgency: WorkUrgency;
}

/** 次の締切: 校正期限（受付中のとき）と納期の早いほう */
export function nextDeadlineOf(
  row: Pick<WorkOverviewRow, "reviewDeadlineAt" | "deliveryAt">,
): Instant | null {
  const list = [row.reviewDeadlineAt, row.deliveryAt].filter((t): t is Instant => t !== null);
  return list.length ? Math.min(...list) : null;
}

/**
 * 注意の度合い。
 * - 校了・保留は落ち着いている扱い
 * - 受付が終わって次の版を待っている、または次の締切を過ぎた → overdue
 * - 次の締切が `soonWithinMs` 以内 → soon
 * - 未解決の指摘・未完了の専門確認がある、または受付中なのに校正者がいない → open
 */
export function workUrgency(
  row: Pick<
    WorkOverviewRow,
    "stage" | "reviewDeadlineAt" | "deliveryAt" | "unresolved" | "reviewersTotal" | "checksPending"
  >,
  now: Instant,
  soonWithinMs: number,
): WorkUrgency {
  if (row.stage === "finalized" || row.stage === "on_hold") return "calm";
  const next = nextDeadlineOf(row);
  if (row.stage === "lapsed" || (next !== null && next <= now)) return "overdue";
  if (next !== null && next - now <= soonWithinMs) return "soon";
  if (
    row.unresolved > 0 ||
    row.checksPending > 0 ||
    (row.stage === "reviewing" && row.reviewersTotal === 0)
  )
    return "open";
  return "calm";
}

const urgencyRank: Record<WorkUrgency, number> = { overdue: 0, soon: 1, open: 2, calm: 3 };
const stageRank: Record<WorkStage, number> = {
  unsubmitted: 0,
  reviewing: 0,
  lapsed: 0,
  on_hold: 1,
  finalized: 2,
};

/**
 * 注意が要る順: 期限超過 → 期限が近い → 手を付けるもの → 落ち着いているもの。保留・校了は最後。
 * 同じなら締切の早い順、未解決の多い順、題名順。
 */
export function compareWorkRows(
  a: Pick<WorkOverviewRow, "stage" | "title" | "unresolved" | "nextDeadlineAt" | "urgency">,
  b: Pick<WorkOverviewRow, "stage" | "title" | "unresolved" | "nextDeadlineAt" | "urgency">,
): number {
  return (
    stageRank[a.stage] - stageRank[b.stage] ||
    urgencyRank[a.urgency] - urgencyRank[b.urgency] ||
    (a.nextDeadlineAt ?? Infinity) - (b.nextDeadlineAt ?? Infinity) ||
    b.unresolved - a.unresolved ||
    a.title.localeCompare(b.title, "ja")
  );
}

/** 制作物の主管担当が属する局の名前（担当なら親の局。局そのものならその名前。未設定・見つからなければ ""） */
export function bureauNameOf(teamId: string | undefined, teams: readonly Team[]): string {
  if (teamId === undefined) return "";
  const team = teams.find((t) => t.id === teamId);
  if (!team) return "";
  if (team.kind === "bureau" || team.parentId === undefined) return team.name;
  return teams.find((t) => t.id === team.parentId)?.name ?? "";
}

/** 局ごとの集計の 1 行 */
export interface BureauSummary {
  /** 局の名前（主管担当が未設定のものは ""） */
  bureau: string;
  works: number;
  reviewing: number;
  unresolved: number;
  finalized: number;
}

/** 局ごとに数える。並びは制作物の多い順（同じなら名前順。未設定は最後） */
export function summarizeByBureau(
  rows: ReadonlyArray<Pick<WorkOverviewRow, "bureau" | "stage" | "unresolved">>,
): BureauSummary[] {
  const map = new Map<string, BureauSummary>();
  for (const r of rows) {
    const s = map.get(r.bureau) ?? {
      bureau: r.bureau,
      works: 0,
      reviewing: 0,
      unresolved: 0,
      finalized: 0,
    };
    s.works++;
    if (r.stage === "reviewing") s.reviewing++;
    if (r.stage === "finalized") s.finalized++;
    s.unresolved += r.unresolved;
    map.set(r.bureau, s);
  }
  return [...map.values()].sort(
    (a, b) =>
      Number(a.bureau === "") - Number(b.bureau === "") ||
      b.works - a.works ||
      a.bureau.localeCompare(b.bureau, "ja"),
  );
}
