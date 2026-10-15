import type { ApprovalEvent } from "../approval/ApprovalPolicy.ts";
import type { CommentEvent, CommentThread } from "../comment/CommentThread.ts";
import { teamPath, type Team } from "../org/team.ts";
import { revisionLabel, type Revision } from "../revision/Revision.ts";
import { toJstDate } from "../shared/deadline.ts";
import type { Instant } from "../shared/time.ts";
import type { Work, WorkLifecycle } from "./Work.ts";

/**
 * 制作物ごとの集計（A-4: 管理者の CSV 書き出し）。校正の進み方を年度の振り返りに使う。
 * 数え方:
 * - 版の数は void でない通常版（0版は数えない）。初回提出は void でない最初の版（0版を含む）の提出時刻。
 * - 校了日は、今校了している制作物の最後の校了（例外校了を含む）の時刻。再開中・未校了は null。
 * - コメントは人の投稿だけ（自動校正の指摘・持ち越しで作られた写しは数えない）。void の版のコメントも数えない。
 * - 不採用・持ち越しの数は今の採否。理由は最後の採否記録の理由を「 / 」でつなぐ。
 */
export interface WorkStatsRow {
  workId: string;
  title: string;
  /** 主管担当（局 › 担当）。未設定は "" */
  ownerTeam: string;
  /** 制作担当（「、」区切り） */
  productionTeams: string;
  lifecycle: WorkLifecycle;
  revisionCount: number;
  firstSubmittedAt: Instant | null;
  finalizedAt: Instant | null;
  /** 初回提出から校了までの日数（小数 1 桁） */
  daysToFinalize: number | null;
  commentCount: number;
  /** 「第1版 5・第2版 2」 */
  commentsPerRevision: string;
  rejectedCount: number;
  deferredCount: number;
  decisionReasons: string;
  feedbackThreadCount: number;
  feedbackPostCount: number;
}

export interface WorkStatsInput {
  work: Work;
  teams: readonly Team[];
  revisions: readonly Revision[];
  /** この制作物の全ての版のコメント（スレッド）と、それぞれの記録（採否の理由を引く） */
  threads: ReadonlyArray<{ thread: CommentThread; events: readonly CommentEvent[] }>;
  approvals: readonly ApprovalEvent[];
  feedback: { threadCount: number; postCount: number };
}

const DAY = 86_400_000;

/** 人の投稿か（自動校正の指摘・システムの投稿は除く） */
export function isHumanComment(thread: Pick<CommentThread, "authorId" | "origin">): boolean {
  return thread.origin?.kind !== "bot" && !thread.authorId.startsWith("bot:");
}

/**
 * 局・担当で絞る: 局を選んだらその局と配下の担当を主管・制作担当にしている制作物、
 * 担当を選んだらその担当を主管・制作担当にしている制作物。
 */
export function workMatchesTeam(
  work: Pick<Work, "ownerTeamId" | "productionTeamIds">,
  teamId: string,
  teams: readonly Team[],
): boolean {
  const team = teams.find((t) => t.id === teamId);
  const ids = new Set<string>([teamId]);
  if (team?.kind === "bureau")
    for (const t of teams) if (t.kind === "team" && t.parentId === teamId) ids.add(t.id);
  if (work.ownerTeamId !== undefined && ids.has(work.ownerTeamId)) return true;
  return work.productionTeamIds.some((id) => ids.has(id));
}

export function computeWorkStats(input: WorkStatsInput): WorkStatsRow {
  const { work, teams } = input;
  const live = input.revisions.filter((r) => r.reviewState !== "void");
  const standard = live.filter((r) => r.kind === "standard");
  const firstSubmittedAt = live.length ? Math.min(...live.map((r) => r.submittedAt)) : null;
  const finalizations = input.approvals
    .filter((a) => a.action === "finalized" || a.action === "exception_finalized")
    .map((a) => a.createdAt);
  const finalizedAt =
    work.lifecycle === "finalized" && finalizations.length ? Math.max(...finalizations) : null;
  const daysToFinalize =
    finalizedAt !== null && firstSubmittedAt !== null
      ? Math.round(((finalizedAt - firstSubmittedAt) / DAY) * 10) / 10
      : null;

  const liveIds = new Set(live.map((r) => r.id));
  const human = input.threads.filter(
    ({ thread }) =>
      liveIds.has(thread.revisionId) &&
      isHumanComment(thread) &&
      thread.carriedFromThreadId === undefined,
  );
  const perRevision = [...live]
    .sort((a, b) => (a.kind === b.kind ? a.sequence - b.sequence : a.kind === "rough" ? -1 : 1))
    .map((r) => {
      const n = human.filter(({ thread }) => thread.revisionId === r.id).length;
      return `${revisionLabel(r)} ${n}`;
    });
  const reasons: string[] = [];
  let rejectedCount = 0;
  let deferredCount = 0;
  for (const { thread, events } of human) {
    if (thread.resolution !== "rejected" && thread.resolution !== "deferred") continue;
    if (thread.resolution === "rejected") rejectedCount++;
    else deferredCount++;
    const decided = [...events]
      .filter((e) => e.eventType === "decided" && e.payload?.["to"] === thread.resolution)
      .sort((a, b) => b.createdAt - a.createdAt)[0];
    const reason = decided?.reason?.replace(/\s+/g, " ").trim();
    if (reason) reasons.push(reason);
  }

  return {
    workId: work.id,
    title: work.title,
    ownerTeam: work.ownerTeamId ? (teamPath(work.ownerTeamId, teams) ?? "") : "",
    productionTeams: work.productionTeamIds
      .map((id) => teamPath(id, teams))
      .filter((p): p is string => p !== null)
      .join("、"),
    lifecycle: work.lifecycle,
    revisionCount: standard.length,
    firstSubmittedAt,
    finalizedAt,
    daysToFinalize,
    commentCount: human.length,
    commentsPerRevision: perRevision.join("・"),
    rejectedCount,
    deferredCount,
    decisionReasons: reasons.join(" / "),
    feedbackThreadCount: input.feedback.threadCount,
    feedbackPostCount: input.feedback.postCount,
  };
}

const lifecycleLabels: Record<WorkLifecycle, string> = {
  draft: "下書き",
  active: "進行中",
  on_hold: "保留",
  finalized: "校了",
  cancelled: "中止",
};

const statsColumns: ReadonlyArray<[string, (r: WorkStatsRow) => string]> = [
  ["制作物ID", (r) => r.workId],
  ["制作物名", (r) => r.title],
  ["主管担当", (r) => r.ownerTeam],
  ["制作担当", (r) => r.productionTeams],
  ["状態", (r) => lifecycleLabels[r.lifecycle]],
  ["版の数", (r) => String(r.revisionCount)],
  ["初回提出日", (r) => (r.firstSubmittedAt === null ? "" : toJstDate(r.firstSubmittedAt))],
  ["校了日", (r) => (r.finalizedAt === null ? "" : toJstDate(r.finalizedAt))],
  ["校了までの日数", (r) => (r.daysToFinalize === null ? "" : String(r.daysToFinalize))],
  ["コメント数", (r) => String(r.commentCount)],
  ["版ごとのコメント数", (r) => r.commentsPerRevision],
  ["不採用", (r) => String(r.rejectedCount)],
  ["持ち越し", (r) => String(r.deferredCount)],
  ["不採用・持ち越しの理由", (r) => r.decisionReasons],
  ["フィードバックのスレッド数", (r) => String(r.feedbackThreadCount)],
  ["フィードバックの投稿数", (r) => String(r.feedbackPostCount)],
];

function csvCell(value: string): string {
  return /[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/** 集計の CSV（見出しは日本語、日付は JST の暦日）。Excel で文字化けしないよう先頭に BOM を付けるのは書き出す側 */
export function workStatsToCsv(rows: readonly WorkStatsRow[]): string {
  const lines = [
    statsColumns.map(([h]) => h),
    ...rows.map((r) => statsColumns.map(([, get]) => get(r))),
  ];
  return `${lines.map((l) => l.map(csvCell).join(",")).join("\r\n")}\r\n`;
}
