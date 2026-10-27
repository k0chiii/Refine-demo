import {
  approvalProgressOf,
  approvalSetupOf,
  bureauNameOf,
  canViewWork,
  checkStateOfAssignment,
  compareWorkRows,
  declarationsOf,
  effectivePermission,
  focusRevisionIdOf,
  isAllowed,
  nextDeadlineOf,
  permissionIncludes,
  revisionHeadsOf,
  rolesOf,
  summarizeByBureau,
  tallyStages,
  threadTallyOf,
  workStageOf,
  workUrgency,
  type ApprovalEvent,
  type AuthorizationContext,
  type BureauSummary,
  type CheckKind,
  type CheckProgress,
  type Instant,
  type MediaType,
  type Principal,
  type RequiredCheck,
  type ReviewAssignment,
  type Revision,
  type RevisionGlance,
  type SubmitRoute,
  type SubmitTargetPolicy,
  type Team,
  type ThreadTally,
  type Work,
  type WorkOverviewRow,
  type WorkPermissionGrant,
  type WorkRoles,
  type WorkStage,
  type WorkSummary,
} from "@mf100/domain";
import { canView } from "../shared.ts";
import type { AppContext, NotificationKind } from "../ports.ts";
import { listSubmitTargets, submitTargetPolicy, type DashboardRole } from "./home.ts";

/** ダッシュボードの 1 行。押すとエディタの該当版へ行ける情報だけを持つ。 */
export interface DashboardItem {
  workId: string;
  workTitle: string;
  revisionId: string | null;
  revisionLabel: string | null;
  /** 校正期限（版）または納期（制作物）。並び替えと表示に使う */
  deadlineAt: number | null;
  /** 未対応のコメント数など、行の右に出す数 */
  count: number;
  /** 行の補足（専門確認の名前・通知の本文など） */
  note?: string;
  /** 「提出する」: 提出の入口（添付は版提出ダイアログ、文章・SNS はエディタ） */
  route?: SubmitRoute;
  mediaType?: MediaType;
  /** 「次の締切」: 校正の締切か制作物の納期か */
  deadlineKind?: "review" | "delivery";
  /** 「自分宛てのコメント」: 通知とコメント */
  notificationId?: string;
  threadId?: string;
  unread?: boolean;
  /** 「自分宛てのコメント」・「最近開いた制作物」: 時刻 */
  at?: number;
  /** 校正の仕事（校正する・専門確認・校了）の種類と進み具合。校正ページの未着手・確認中・完了に使う */
  task?: CheckKind;
  taskState?: CheckProgress;
  /** 進み具合の数: 校正は 校正者の完了 m/n、校了は 宣言 d/q（校了者が 2 人以上のときだけ） */
  progress?: { done: number; total: number };
}

export interface Dashboard {
  /** あなたの担当（役割ごとに自動で出る） */
  mine: {
    /** 提出する: 自分が制作者で版を提出できる進行中の制作物（L-15。FAB「版を提出」と同じ判定） */
    submit: DashboardItem[];
    /** 校正する: 自分に割り当てられ、まだ校正を完了していない受付中の版 */
    review: DashboardItem[];
    /** 返事をする: 採否判断ができる制作物で、受付中の版に未対応のコメントがある */
    respond: DashboardItem[];
    /** 専門確認をする: 受付中の版の専門確認で、自分が担当の未完了のもの */
    checks: DashboardItem[];
    /** 校了する: 校了権限があり、受付中の通常版に未対応のコメントも未完了の専門確認もない */
    finalize: DashboardItem[];
    /** 割り当てる: 割当権限があり、受付中の版に校正者がいない */
    assign: DashboardItem[];
  };
  /**
   * 校正の仕事のうち、自分の分が終わったもの（校正を完了した割当・完了した専門確認・宣言済みの校了）。受付中の版だけ。
   * `mine` には入れない（「やること」の数に数えない）
   */
  done: DashboardItem[];
  /** 次の締切（{@link dashboardPolicy.upcomingWithinMs} 以内。自分が担当の校正の締切と、職責のある制作物の納期） */
  upcoming: DashboardItem[];
  /** 自分宛てのコメント（通知から: メンション・担当・新しいコメント・判断） */
  mentions: DashboardItem[];
  /** ピン留めした制作物（制作物のページの「ピン留め」で絞る） */
  pinned: DashboardItem[];
  /** 滞っている制作物（自分が関わる制作物だけ） */
  backlog: {
    /** 期限到来で受付が終わり、そのまま次の版が出ていない */
    overdue: DashboardItem[];
    /** 受付中なのに校正者がいない */
    unassigned: DashboardItem[];
    /** 一定期間、提出もコメントもない */
    stale: DashboardItem[];
    /** 納期が近い */
    dueSoon: DashboardItem[];
  };
  /** 役割ごとの件数（制作物の数。専門確認は未完了の件数）。全部が空のときの理由に使う（要件 U-01） */
  roles: Record<DashboardRole, number>;
  /** いちばん近い締切（期間に関係なく）。全部が空のときの理由に使う */
  nextDeadline: DashboardItem | null;
  /** 自分の数字（制作物のページの上段のカード） */
  summary: DashboardSummary;
  /** 自分が関わる制作物の全体の状況（数字・表） */
  overview: DashboardOverview;
}

/** 自分の数字 */
export interface DashboardSummary {
  /** やること: 「提出する」から「割り当てる」までの行の合計 */
  todo: number;
  /** 期限が近い（{@link dashboardPolicy.upcomingWithinMs} 以内）校正の締切・納期 */
  dueSoon: number;
  /** 期限超過で受付が終わったまま次の版が出ていない制作物 */
  overdue: number;
  /** 自分宛てのコメントのうち未読 */
  unread: number;
}

/** 自分が関わる制作物の全体の状況 */
export interface DashboardOverview {
  /** この数字を作った時刻 */
  asOf: Instant;
  /** 数えた制作物（下書き・取消を除く） */
  total: number;
  stages: Record<WorkStage, number>;
  /** 受付中の版（受付が終わった最新の版を含む）の指摘: 未解決と、片付いたもの */
  threads: { open: number; done: number };
  /** 受付中の版の校正者: 割り当てた数と、確認を終えた数 */
  reviewers: { total: number; done: number };
  /** 受付中の版の未完了の専門確認 */
  checksPending: number;
  /** 校了していない制作物（注意が要る順） */
  works: WorkOverviewRow[];
  /** 主管担当の局ごと */
  bureaus: BureauSummary[];
}

interface CheckTasks {
  mine: Pick<Dashboard["mine"], "review" | "checks" | "finalize" | "assign">;
  done: DashboardItem[];
}

/** 校正の入口（と `/` の振り分け）が読む節 */
export interface CheckDashboard extends CheckTasks {
  /** ピン留めした制作物のうち、上の行（校正・専門確認・校了・割り当て・完了）に無いもの。並びはピン留めの新しい順 */
  pinned: DashboardItem[];
}

/** 制作の入口が読む節 */
export interface MakeDashboard {
  submit: DashboardItem[];
  /** 返事をする（自分が制作者の制作物だけ） */
  respond: DashboardItem[];
  /** 自分が制作者の、校了していない制作物（注意が要る順） */
  works: WorkOverviewRow[];
  mentions: DashboardItem[];
}

/** 制作物の一覧の先頭（制作物の状況）とピン留めの絞り込みが読む節 */
export interface WorksDashboard extends Pick<
  Dashboard,
  "pinned" | "backlog" | "nextDeadline" | "overview"
> {
  summary: Pick<DashboardSummary, "dueSoon" | "overdue">;
}

/** 閾値。制度ではなく表示の判断なので変更しやすいよう外に出す。 */
export const dashboardPolicy = {
  staleAfterMs: 14 * 86_400_000,
  dueSoonWithinMs: 14 * 86_400_000,
  /** 「次の締切」に出す範囲 */
  upcomingWithinMs: 7 * 86_400_000,
  /** 「自分宛てのコメント」に出す通知の種類 */
  mentionKinds: [
    "mentioned",
    "comment_assigned",
    "comment_posted",
    "comment_decided",
  ] as readonly NotificationKind[],
  /** 「自分宛てのコメント」に出す期間と件数（既読も出し、未読は印を付ける） */
  mentionsWithinMs: 14 * 86_400_000,
  mentionsMax: 30,
};

function byDeadline(a: DashboardItem, b: DashboardItem): number {
  return (
    (a.deadlineAt ?? Infinity) - (b.deadlineAt ?? Infinity) ||
    a.workTitle.localeCompare(b.workTitle, "ja")
  );
}

function itemOf(
  work: Work,
  r: RevisionGlance | null,
  deadlineAt: number | null,
  count = 0,
): DashboardItem {
  return {
    workId: work.id,
    workTitle: work.title,
    revisionId: r?.id ?? null,
    revisionLabel: r?.label ?? null,
    deadlineAt,
    count,
  };
}

function isReviewPending(a: ReviewAssignment | undefined): a is ReviewAssignment {
  return a?.state === "pending" || a?.state === "viewed";
}

/** 見られる制作物なら、その ACL。見られなければ null */
async function visibleGrants(
  ctx: AppContext,
  principal: Principal,
  work: Work,
): Promise<readonly WorkPermissionGrant[] | null> {
  // 進行中でない制作物（完了・保留・取消）は表の 1 行に数えるだけ。ACL は「見られるか」の判定にだけ要るので、
  // ACL を見ずに見られると分かる（通常の制作物）なら読まない。ホームの購読が読む範囲が狭まり、ACL の書込みで再実行されなくなる
  if (work.lifecycle !== "active" && canViewWork({ work, grants: [], principal })) return [];
  const grants = await ctx.acl.listByWork(work.id);
  return (await canView(ctx, principal, work, grants)) ? grants : null;
}

/** 見られる進行中の制作物 1 件の材料。どの節もここから自分の行を作る */
interface WorkGlance {
  work: Work;
  authz: AuthorizationContext;
  roles: WorkRoles;
  summary: WorkSummary | null;
  latest: RevisionGlance | null;
  tally: ThreadTally;
  /** 受付中の版と、その割当・専門確認 */
  open: {
    revision: RevisionGlance;
    assignments: ReviewAssignment[];
    checks: RequiredCheck[];
    pendingChecks: RequiredCheck[];
    reviewersDone: number;
    mine: ReviewAssignment | undefined;
  } | null;
  revisionsOf: () => Promise<Revision[]>;
  approvalsOf: () => Promise<ApprovalEvent[]>;
}

async function glanceWork(
  ctx: AppContext,
  principal: Principal,
  work: Work,
  grants: readonly WorkPermissionGrant[],
): Promise<WorkGlance> {
  // 要約が揃っていれば版の全件もスレッドも読まない。揃っていない制作物だけ、全件から同じ値を数え直す
  const summary = await ctx.workSummaries.findByWork(work.id);
  let revisions: Revision[] | null = null;
  const revisionsOf = async () => (revisions ??= await ctx.revisions.listByWork(work.id));
  // 校了の宣言の履歴は、校了者が 2 人以上のときだけ、必要な人（制作者・校了する人）のために 1 回だけ読む
  let approvals: ApprovalEvent[] | null = null;
  const approvalsOf = async () => (approvals ??= await ctx.approvals.listByWork(work.id));
  const heads = summary ?? revisionHeadsOf(await revisionsOf());
  const focusId = focusRevisionIdOf(heads);
  const tally =
    summary?.threads ?? threadTallyOf(focusId ? await ctx.threads.listByRevision(focusId) : []);
  let open: WorkGlance["open"] = null;
  if (heads.accepting) {
    const assignments = await ctx.assignments.listByRevision(heads.accepting.id);
    const checks = await ctx.checks.listByRevision(heads.accepting.id);
    open = {
      revision: heads.accepting,
      assignments,
      checks,
      pendingChecks: checks.filter((c) => c.state === "pending"),
      reviewersDone: assignments.filter((a) => a.state === "responded" || a.state === "excused")
        .length,
      mine: assignments.find((a) => a.reviewerId === principal.userId),
    };
  }
  return {
    work,
    authz: { work, grants, principal },
    roles: rolesOf(work, principal),
    summary,
    latest: heads.latest,
    tally,
    open,
    revisionsOf,
    approvalsOf,
  };
}

function emptyCheckTasks(): CheckTasks {
  return { mine: { review: [], checks: [], finalize: [], assign: [] }, done: [] };
}

/** 校正の仕事（校正する・専門確認・校了）と割り当てるを、受付中の版から足す */
async function addCheckTasks(out: CheckTasks, g: WorkGlance): Promise<void> {
  const { work, open, authz } = g;
  if (!open) return;
  const { revision: accepting, assignments, checks, pendingChecks, reviewersDone, mine } = open;
  const me = authz.principal.userId;
  const { unresolved } = g.tally;
  const item = (count = 0) => itemOf(work, accepting, accepting.deadlineAt, count);
  const progress = () => ({ done: reviewersDone, total: assignments.length });
  if (isReviewPending(mine))
    out.mine.review.push({
      ...item(unresolved),
      task: "review",
      taskState: checkStateOfAssignment(mine.state),
      progress: progress(),
    });
  else if (mine)
    out.done.push({ ...item(), task: "review", taskState: "done", progress: progress() });
  for (const c of pendingChecks.filter((c) => c.assigneeId === me))
    out.mine.checks.push({ ...item(), note: c.label, task: "check", taskState: "pending" });
  for (const c of checks.filter((c) => c.state !== "pending" && c.assigneeId === me))
    out.done.push({ ...item(), note: c.label, task: "check", taskState: "done" });
  if (
    accepting.kind === "standard" &&
    unresolved === 0 &&
    pendingChecks.length === 0 &&
    isAllowed("work.finalize", authz)
  ) {
    const quorum = approvalSetupOf(work).quorum;
    // 校了者が複数で、すでに自分が宣言した版は「校了待ち」に出さない（履歴を読むのは人数が 2 以上のときだけ）
    const declarations = quorum > 1 ? declarationsOf(await g.approvalsOf(), accepting.id) : [];
    const declaredByMe = declarations.some((d) => d.actorId === me);
    (declaredByMe ? out.done : out.mine.finalize).push({
      ...item(),
      task: "finalize",
      taskState: declaredByMe ? "done" : "pending",
      ...(quorum > 1 ? { progress: { done: declarations.length, total: quorum } } : {}),
    });
  }
  if (assignments.length === 0 && isAllowed("review.assign", authz)) out.mine.assign.push(item());
}

/** 返事をする: 採否判断ができ、受付中の版に未対応のコメントがある */
function respondItem(g: WorkGlance): DashboardItem | null {
  const { open, tally } = g;
  if (!open || tally.unresolved === 0 || !isAllowed("comment.decide", g.authz)) return null;
  return itemOf(g.work, open.revision, open.revision.deadlineAt, tally.unresolved);
}

/** 全体の状況・滞っている制作物・締切の候補を、制作物ごとに足していく入れ物 */
interface OverviewParts {
  principal: Principal;
  teams: readonly Team[];
  now: Instant;
  rows: WorkOverviewRow[];
  threads: { open: number; done: number };
  reviewers: { total: number; done: number };
  checksPending: number;
  backlog: Dashboard["backlog"];
  /** 期限を過ぎたものも含む。{@link deadlinesAhead} で絞る */
  deadlines: DashboardItem[];
}

function emptyOverviewParts(
  principal: Principal,
  teams: readonly Team[],
  now: Instant,
): OverviewParts {
  return {
    principal,
    teams,
    now,
    rows: [],
    threads: { open: 0, done: 0 },
    reviewers: { total: 0, done: 0 },
    checksPending: 0,
    backlog: { overdue: [], unassigned: [], stale: [], dueSoon: [] },
    deadlines: [],
  };
}

function overviewRow(
  parts: OverviewParts,
  work: Work,
  stage: WorkStage,
  part: Partial<WorkOverviewRow> & Pick<WorkOverviewRow, "reviewDeadlineAt">,
): WorkOverviewRow {
  const base = {
    workId: work.id,
    title: work.title,
    stage,
    revisionId: null,
    revisionLabel: null,
    deliveryAt: work.deadlineAt ?? null,
    unresolved: 0,
    threads: 0,
    reviewersTotal: 0,
    reviewersDone: 0,
    checksPending: 0,
    bureau: bureauNameOf(work.ownerTeamId, parts.teams),
    isCreator: work.creatorIds.includes(parts.principal.userId),
    approvalDeclared: 0,
    approvalQuorum: approvalSetupOf(work).quorum,
    ...part,
  };
  return {
    ...base,
    nextDeadlineAt: nextDeadlineOf(base),
    urgency: workUrgency(base, parts.now, dashboardPolicy.upcomingWithinMs),
  };
}

/** 進行中でない制作物（完了・保留・取消）は表の 1 行に数えるだけ */
function addInactiveRow(parts: OverviewParts, work: Work): void {
  const stage = workStageOf({ lifecycle: work.lifecycle, accepting: false, hasRevision: false });
  if (stage) parts.rows.push(overviewRow(parts, work, stage, { reviewDeadlineAt: null }));
}

async function addOverview(parts: OverviewParts, g: WorkGlance): Promise<void> {
  const { work, roles, latest, tally, open } = g;
  const { now, backlog, deadlines } = parts;
  const roleHolder = roles.isCreator || roles.isApprover || roles.isManager;
  const countThreads = () => {
    parts.threads.open += tally.unresolved;
    parts.threads.done += tally.total - tally.unresolved;
  };
  // 全体の状況の 1 行に足す、版ごとの数
  const detail: Partial<WorkOverviewRow> = {};
  let lastActivity = latest?.submittedAt ?? null;
  if (open) {
    const { revision: accepting, assignments, pendingChecks, reviewersDone } = open;
    const quorum = approvalSetupOf(work).quorum;
    countThreads();
    parts.reviewers.total += assignments.length;
    parts.reviewers.done += reviewersDone;
    parts.checksPending += pendingChecks.length;
    Object.assign(detail, {
      revisionId: accepting.id,
      revisionLabel: accepting.label,
      reviewDeadlineAt: accepting.deadlineAt,
      unresolved: tally.unresolved,
      threads: tally.total,
      reviewersTotal: assignments.length,
      reviewersDone,
      checksPending: pendingChecks.length,
      ...(roles.isCreator && quorum > 1
        ? {
            approvalDeclared:
              g.summary?.declared ??
              approvalProgressOf(work, await g.approvalsOf(), await g.revisionsOf()).declaredIds
                .length,
          }
        : {}),
    });
    if (tally.lastCreatedAt !== null)
      lastActivity = Math.max(lastActivity ?? 0, tally.lastCreatedAt);
    if (assignments.length === 0)
      backlog.unassigned.push(itemOf(work, accepting, accepting.deadlineAt));
    // 校正の締切: 自分が校正する版、または職責のある制作物の受付中の版
    if (isReviewPending(open.mine) || roleHolder)
      deadlines.push({
        ...itemOf(work, accepting, accepting.deadlineAt, tally.unresolved),
        deadlineKind: "review",
      });
  } else if (latest?.lapsed) {
    backlog.overdue.push(itemOf(work, latest, latest.deadlineAt, tally.unresolved));
    countThreads();
    Object.assign(detail, {
      revisionId: latest.id,
      revisionLabel: latest.label,
      reviewDeadlineAt: latest.deadlineAt,
      unresolved: tally.unresolved,
      threads: tally.total,
    });
  }
  const stage = workStageOf({
    lifecycle: work.lifecycle,
    accepting: open !== null,
    hasRevision: latest !== null,
  });
  if (stage)
    parts.rows.push(overviewRow(parts, work, stage, { reviewDeadlineAt: null, ...detail }));
  const shown = open?.revision ?? latest;
  if (lastActivity !== null && now - lastActivity >= dashboardPolicy.staleAfterMs)
    backlog.stale.push(itemOf(work, latest, lastActivity));
  if (work.deadlineAt !== undefined && work.deadlineAt - now <= dashboardPolicy.dueSoonWithinMs)
    backlog.dueSoon.push(itemOf(work, shown, work.deadlineAt));
  if (work.deadlineAt !== undefined && roleHolder)
    deadlines.push({ ...itemOf(work, shown, work.deadlineAt), deadlineKind: "delivery" });
}

/** 校了していない制作物（注意が要る順） */
function openRows(rows: readonly WorkOverviewRow[]): WorkOverviewRow[] {
  return rows.filter((r) => r.stage !== "finalized").sort(compareWorkRows);
}

function overviewOf(parts: OverviewParts): DashboardOverview {
  return {
    asOf: parts.now,
    total: parts.rows.length,
    stages: tallyStages(parts.rows.map((r) => r.stage)),
    threads: parts.threads,
    reviewers: parts.reviewers,
    checksPending: parts.checksPending,
    works: openRows(parts.rows),
    bureaus: summarizeByBureau(parts.rows),
  };
}

function sortBacklog(backlog: Dashboard["backlog"]): void {
  for (const list of Object.values(backlog)) list.sort(byDeadline);
}

/** 次の締切（期限内のものだけ、近い順）と、期間に関係なくいちばん近い締切 */
function deadlinesAhead(deadlines: readonly DashboardItem[], now: Instant) {
  const future = deadlines
    .filter((d) => d.deadlineAt !== null && d.deadlineAt > now)
    .sort(byDeadline);
  return {
    upcoming: future.filter((d) => d.deadlineAt! - now <= dashboardPolicy.upcomingWithinMs),
    nextDeadline: future[0] ?? null,
  };
}

/** 提出する（FAB「版を提出」と同じ判定。提出の権限は listSubmitTargets が確かめる） */
async function submitItems(
  ctx: AppContext,
  principal: Principal,
  visible: readonly Work[],
  policy: SubmitTargetPolicy,
): Promise<DashboardItem[]> {
  return (await listSubmitTargets(ctx, principal, visible, policy)).map((t) => ({
    workId: t.workId,
    workTitle: t.workTitle,
    revisionId: null,
    revisionLabel: t.latestLabel,
    deadlineAt: t.deadlineAt,
    count: 0,
    route: t.route,
    mediaType: t.mediaType,
    ...(t.acceptingLabel ? { note: `${t.acceptingLabel}が受付中` } : {}),
  }));
}

/** 自分宛てのコメント（通知から。見られる制作物のものだけ） */
async function mentionItems(
  ctx: AppContext,
  principal: Principal,
  visible: readonly Work[],
  now: Instant,
): Promise<DashboardItem[]> {
  const out: DashboardItem[] = [];
  const titles = new Map(visible.map((w) => [w.id, w.title]));
  const goneThreads = new Map<string, boolean>();
  const isCommentGone = async (n: { threadId?: string }): Promise<boolean> => {
    if (n.threadId === undefined) return false;
    let gone = goneThreads.get(n.threadId);
    if (gone === undefined) {
      const t = await ctx.threads.findById(n.threadId).catch(() => null);
      gone = t?.deletedAt !== undefined;
      goneThreads.set(n.threadId, gone);
    }
    return gone;
  };
  for (const n of await ctx.notifications.listForUser(principal.userId, 100)) {
    if (out.length >= dashboardPolicy.mentionsMax) break;
    if (!dashboardPolicy.mentionKinds.includes(n.kind)) continue;
    if (now - n.createdAt > dashboardPolicy.mentionsWithinMs) continue;
    if (!n.workId || !titles.has(n.workId)) continue;
    // 削除されたコメントへの通知は出さない（本文を伏せ、飛び先も無い）
    if (await isCommentGone(n)) continue;
    out.push({
      workId: n.workId,
      workTitle: titles.get(n.workId)!,
      revisionId: n.revisionId ?? null,
      revisionLabel: null,
      deadlineAt: null,
      count: 0,
      note: n.title,
      notificationId: n.id,
      ...(n.threadId ? { threadId: n.threadId } : {}),
      unread: n.readAt === undefined,
      at: n.createdAt,
    });
  }
  return out;
}

/** ピン留め（見られなくなった制作物は出さない） */
async function pinnedItems(ctx: AppContext, principal: Principal): Promise<DashboardItem[]> {
  const out: DashboardItem[] = [];
  for (const p of await ctx.home.listPins(principal.userId)) {
    const work = await ctx.works.findById(p.workId);
    if (!work) continue;
    const grants = await ctx.acl.listByWork(work.id);
    if (!(await canView(ctx, principal, work, grants))) continue;
    const { accepting, latest } =
      (await ctx.workSummaries.findByWork(work.id)) ??
      revisionHeadsOf(await ctx.revisions.listByWork(work.id));
    out.push({
      workId: work.id,
      workTitle: work.title,
      revisionId: (accepting ?? latest)?.id ?? null,
      revisionLabel: latest?.label ?? null,
      deadlineAt: accepting?.deadlineAt ?? work.deadlineAt ?? null,
      deadlineKind: accepting ? "review" : "delivery",
      count: 0,
      at: p.pinnedAt,
    });
  }
  return out;
}

/**
 * ダッシュボード（U-00）の全部の節。`works` は呼び出し側が「自分が関わる制作物」（職責または ACL）に絞って渡す。
 * 閲覧権限はここで最終判定し、見えない制作物は出さない。画面は節ごとの build*Dashboard を読む（読む範囲が狭いほど、
 * 関係のない書込みで購読が再実行されない）。節ごとの結果は、ここの同じ節と一致させる
 */
export async function buildDashboard(
  ctx: AppContext,
  principal: Principal,
  works: Work[],
  opts: { submitPolicy?: SubmitTargetPolicy } = {},
): Promise<Dashboard> {
  const now = ctx.clock.now();
  const parts = emptyOverviewParts(principal, await ctx.teams.list(), now);
  const tasks = emptyCheckTasks();
  const respond: DashboardItem[] = [];
  const roles: Record<DashboardRole, number> = {
    creator: 0,
    reviewer: 0,
    checker: 0,
    approver: 0,
    manager: 0,
  };
  const visible: Work[] = [];
  for (const work of works) {
    const grants = await visibleGrants(ctx, principal, work);
    if (grants === null) continue;
    visible.push(work);
    if (work.lifecycle !== "active") {
      addInactiveRow(parts, work);
      continue;
    }
    const g = await glanceWork(ctx, principal, work, grants);
    const level = effectivePermission(grants, principal);
    const roleHolder = g.roles.isCreator || g.roles.isApprover || g.roles.isManager;
    if (g.roles.isCreator) roles.creator++;
    if (g.roles.isApprover) roles.approver++;
    if (g.roles.isManager) roles.manager++;
    roles.checker +=
      g.open?.pendingChecks.filter((c) => c.assigneeId === principal.userId).length ?? 0;
    if (g.open?.mine || (level !== null && permissionIncludes(level, "review") && !roleHolder))
      roles.reviewer++;
    await addCheckTasks(tasks, g);
    const r = respondItem(g);
    if (r) respond.push(r);
    await addOverview(parts, g);
  }

  const mine: Dashboard["mine"] = {
    ...tasks.mine,
    submit: await submitItems(ctx, principal, visible, opts.submitPolicy ?? submitTargetPolicy),
    respond,
  };
  for (const list of Object.values(mine)) list.sort(byDeadline);
  sortBacklog(parts.backlog);
  const { upcoming, nextDeadline } = deadlinesAhead(parts.deadlines, now);
  const mentions = await mentionItems(ctx, principal, visible, now);
  return {
    mine,
    done: tasks.done,
    upcoming,
    mentions,
    pinned: await pinnedItems(ctx, principal),
    backlog: parts.backlog,
    roles,
    nextDeadline,
    summary: {
      todo: Object.values(mine).reduce((n, list) => n + list.length, 0),
      dueSoon: upcoming.length,
      overdue: parts.backlog.overdue.length,
      unread: mentions.filter((m) => m.unread).length,
    },
    overview: overviewOf(parts),
  };
}

/**
 * 校正の入口と `/` の振り分けの節。進行中の制作物の受付中の版と、ピン留めした制作物を読む。通知・担当の一覧は読まない
 * （コメントの通知の書込みで、この購読は再実行されない）。ピン留めは制作物の購読を兼ねるので、自分の行が無い
 * 制作物もここに出す（利用者決定 2026-10-27）
 */
export async function buildCheckDashboard(
  ctx: AppContext,
  principal: Principal,
  works: Work[],
): Promise<CheckDashboard> {
  const out = emptyCheckTasks();
  for (const work of works) {
    if (work.lifecycle !== "active") continue;
    const grants = await visibleGrants(ctx, principal, work);
    if (grants === null) continue;
    await addCheckTasks(out, await glanceWork(ctx, principal, work, grants));
  }
  for (const list of Object.values(out.mine)) list.sort(byDeadline);
  const shown = new Set([...Object.values(out.mine).flat(), ...out.done].map((i) => i.workId));
  const pinned = (await pinnedItems(ctx, principal)).filter((i) => !shown.has(i.workId));
  return { ...out, pinned };
}

/**
 * 制作の入口の節。版・割当・専門確認を読むのは自分が制作者の制作物だけ。ほかの制作物は、通知の飛び先を
 * 見られるかの判定にだけ使う
 */
export async function buildMakeDashboard(
  ctx: AppContext,
  principal: Principal,
  works: Work[],
  opts: { submitPolicy?: SubmitTargetPolicy } = {},
): Promise<MakeDashboard> {
  const now = ctx.clock.now();
  const parts = emptyOverviewParts(principal, await ctx.teams.list(), now);
  const respond: DashboardItem[] = [];
  const visible: Work[] = [];
  for (const work of works) {
    const grants = await visibleGrants(ctx, principal, work);
    if (grants === null) continue;
    visible.push(work);
    if (!rolesOf(work, principal).isCreator) continue;
    if (work.lifecycle !== "active") {
      addInactiveRow(parts, work);
      continue;
    }
    const g = await glanceWork(ctx, principal, work, grants);
    const r = respondItem(g);
    if (r) respond.push(r);
    await addOverview(parts, g);
  }
  return {
    submit: (
      await submitItems(ctx, principal, visible, opts.submitPolicy ?? submitTargetPolicy)
    ).sort(byDeadline),
    respond: respond.sort(byDeadline),
    works: openRows(parts.rows),
    mentions: await mentionItems(ctx, principal, visible, now),
  };
}

/** 制作物の一覧の先頭（制作物の状況）とピン留めの節。通知と提出先の候補は読まない */
export async function buildWorksDashboard(
  ctx: AppContext,
  principal: Principal,
  works: Work[],
): Promise<WorksDashboard> {
  const now = ctx.clock.now();
  const parts = emptyOverviewParts(principal, await ctx.teams.list(), now);
  for (const work of works) {
    const grants = await visibleGrants(ctx, principal, work);
    if (grants === null) continue;
    if (work.lifecycle !== "active") addInactiveRow(parts, work);
    else await addOverview(parts, await glanceWork(ctx, principal, work, grants));
  }
  sortBacklog(parts.backlog);
  const { upcoming, nextDeadline } = deadlinesAhead(parts.deadlines, now);
  return {
    pinned: await pinnedItems(ctx, principal),
    backlog: parts.backlog,
    nextDeadline,
    summary: { dueSoon: upcoming.length, overdue: parts.backlog.overdue.length },
    overview: overviewOf(parts),
  };
}
