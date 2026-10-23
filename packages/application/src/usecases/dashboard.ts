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
  type BureauSummary,
  type CheckKind,
  type CheckProgress,
  type Instant,
  type MediaType,
  type Principal,
  type Revision,
  type RevisionGlance,
  type SubmitRoute,
  type SubmitTargetPolicy,
  type ThreadTally,
  type Work,
  type WorkOverviewRow,
  type WorkStage,
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

/**
 * ダッシュボード（U-00）。`works` は呼び出し側が「自分が関わる制作物」（職責または ACL）に絞って渡す。
 * 閲覧権限はここで最終判定し、見えない制作物は出さない。
 */
export async function buildDashboard(
  ctx: AppContext,
  principal: Principal,
  works: Work[],
  opts: { submitPolicy?: SubmitTargetPolicy } = {},
): Promise<Dashboard> {
  const now = ctx.clock.now();
  const out: Omit<Dashboard, "summary" | "overview"> = {
    mine: { submit: [], review: [], respond: [], checks: [], finalize: [], assign: [] },
    done: [],
    upcoming: [],
    mentions: [],
    pinned: [],
    backlog: { overdue: [], unassigned: [], stale: [], dueSoon: [] },
    roles: { creator: 0, reviewer: 0, checker: 0, approver: 0, manager: 0 },
    nextDeadline: null,
  };
  const visible: Work[] = [];
  const deadlines: DashboardItem[] = [];
  // 全体の状況（表・内訳）。下書き・取消は数えない
  const teams = await ctx.teams.list();
  const rows: WorkOverviewRow[] = [];
  const threadTotals = { open: 0, done: 0 };
  const countThreads = (t: ThreadTally) => {
    threadTotals.open += t.unresolved;
    threadTotals.done += t.total - t.unresolved;
  };
  const reviewers = { total: 0, done: 0 };
  let checksPending = 0;
  const overviewRow = (
    work: Work,
    stage: WorkStage,
    part: Partial<WorkOverviewRow> & Pick<WorkOverviewRow, "reviewDeadlineAt">,
  ): WorkOverviewRow => {
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
      bureau: bureauNameOf(work.ownerTeamId, teams),
      isCreator: work.creatorIds.includes(principal.userId),
      approvalDeclared: 0,
      approvalQuorum: approvalSetupOf(work).quorum,
      ...part,
    };
    const nextDeadlineAt = nextDeadlineOf(base);
    return {
      ...base,
      nextDeadlineAt,
      urgency: workUrgency(base, now, dashboardPolicy.upcomingWithinMs),
    };
  };
  for (const work of works) {
    // 進行中でない制作物（完了・保留・取消）は表の 1 行に数えるだけ。ACL は「見られるか」の判定にだけ要るので、
    // ACL を見ずに見られると分かる（通常の制作物）なら読まない。ホームの購読が読む範囲が狭まり、ACL の書込みで再実行されなくなる
    const viewableWithoutGrants =
      work.lifecycle !== "active" && canViewWork({ work, grants: [], principal });
    const grants = viewableWithoutGrants ? [] : await ctx.acl.listByWork(work.id);
    const authz = { work, grants, principal };
    if (!viewableWithoutGrants && !(await canView(ctx, principal, work, grants))) continue;
    visible.push(work);
    if (work.lifecycle !== "active") {
      const stage = workStageOf({
        lifecycle: work.lifecycle,
        accepting: false,
        hasRevision: false,
      });
      if (stage) rows.push(overviewRow(work, stage, { reviewDeadlineAt: null }));
      continue;
    }
    const roles = rolesOf(work, principal);
    const level = effectivePermission(grants, principal);
    if (roles.isCreator) out.roles.creator++;
    if (roles.isApprover) out.roles.approver++;
    if (roles.isManager) out.roles.manager++;
    // 要約が揃っていれば版の全件もスレッドも読まない。揃っていない制作物だけ、全件から同じ値を数え直す
    const summary = await ctx.workSummaries.findByWork(work.id);
    let revisions: Revision[] | null = null;
    const revisionsOf = async () => (revisions ??= await ctx.revisions.listByWork(work.id));
    const heads = summary ?? revisionHeadsOf(await revisionsOf());
    const { accepting, latest } = heads;
    const focusId = focusRevisionIdOf(heads);
    const tally =
      summary?.threads ?? threadTallyOf(focusId ? await ctx.threads.listByRevision(focusId) : []);
    const item = (
      r: RevisionGlance | null,
      deadlineAt: number | null,
      count = 0,
    ): DashboardItem => ({
      workId: work.id,
      workTitle: work.title,
      revisionId: r?.id ?? null,
      revisionLabel: r?.label ?? null,
      deadlineAt,
      count,
    });
    const roleHolder = roles.isCreator || roles.isApprover || roles.isManager;
    // 全体の状況の 1 行に足す、版ごとの数
    const detail: Partial<WorkOverviewRow> = {};

    let lastActivity = latest?.submittedAt ?? null;
    let reviewing = level !== null && permissionIncludes(level, "review") && !roleHolder;
    if (accepting) {
      // 校了の宣言の履歴は、校了者が 2 人以上のときだけ、必要な人（制作者・校了する人）のために 1 回だけ読む
      const quorum = approvalSetupOf(work).quorum;
      let approvalEvents: ApprovalEvent[] | null = null;
      const approvalsOf = async () => (approvalEvents ??= await ctx.approvals.listByWork(work.id));
      const { unresolved } = tally;
      const assignments = await ctx.assignments.listByRevision(accepting.id);
      const checks = await ctx.checks.listByRevision(accepting.id);
      const pendingChecks = checks.filter((c) => c.state === "pending");
      const reviewersDone = assignments.filter(
        (a) => a.state === "responded" || a.state === "excused",
      ).length;
      countThreads(tally);
      reviewers.total += assignments.length;
      reviewers.done += reviewersDone;
      checksPending += pendingChecks.length;
      Object.assign(detail, {
        revisionId: accepting.id,
        revisionLabel: accepting.label,
        reviewDeadlineAt: accepting.deadlineAt,
        unresolved,
        threads: tally.total,
        reviewersTotal: assignments.length,
        reviewersDone,
        checksPending: pendingChecks.length,
        ...(roles.isCreator && quorum > 1
          ? {
              approvalDeclared:
                summary?.declared ??
                approvalProgressOf(work, await approvalsOf(), await revisionsOf()).declaredIds
                  .length,
            }
          : {}),
      });
      if (tally.lastCreatedAt !== null)
        lastActivity = Math.max(lastActivity ?? 0, tally.lastCreatedAt);

      const mine = assignments.find((a) => a.reviewerId === principal.userId);
      if (mine) reviewing = true;
      const reviewPending = mine && (mine.state === "pending" || mine.state === "viewed");
      if (reviewPending)
        out.mine.review.push({
          ...item(accepting, accepting.deadlineAt, unresolved),
          task: "review",
          taskState: checkStateOfAssignment(mine.state),
          progress: { done: reviewersDone, total: assignments.length },
        });
      else if (mine)
        out.done.push({
          ...item(accepting, accepting.deadlineAt),
          task: "review",
          taskState: "done",
          progress: { done: reviewersDone, total: assignments.length },
        });
      if (unresolved > 0 && isAllowed("comment.decide", authz))
        out.mine.respond.push(item(accepting, accepting.deadlineAt, unresolved));
      for (const c of pendingChecks.filter((c) => c.assigneeId === principal.userId)) {
        out.roles.checker++;
        out.mine.checks.push({
          ...item(accepting, accepting.deadlineAt),
          note: c.label,
          task: "check",
          taskState: "pending",
        });
      }
      for (const c of checks.filter(
        (c) => c.state !== "pending" && c.assigneeId === principal.userId,
      ))
        out.done.push({
          ...item(accepting, accepting.deadlineAt),
          note: c.label,
          task: "check",
          taskState: "done",
        });
      if (
        accepting.kind === "standard" &&
        unresolved === 0 &&
        pendingChecks.length === 0 &&
        isAllowed("work.finalize", authz)
      ) {
        // 校了者が複数で、すでに自分が宣言した版は「校了待ち」に出さない（履歴を読むのは人数が 2 以上のときだけ）
        const declarations = quorum > 1 ? declarationsOf(await approvalsOf(), accepting.id) : [];
        const declaredByMe = declarations.some((d) => d.actorId === principal.userId);
        const task = { task: "finalize", taskState: declaredByMe ? "done" : "pending" } as const;
        (declaredByMe ? out.done : out.mine.finalize).push({
          ...item(accepting, accepting.deadlineAt),
          ...task,
          ...(quorum > 1 ? { progress: { done: declarations.length, total: quorum } } : {}),
        });
      }
      if (assignments.length === 0 && isAllowed("review.assign", authz))
        out.mine.assign.push(item(accepting, accepting.deadlineAt));
      if (assignments.length === 0)
        out.backlog.unassigned.push(item(accepting, accepting.deadlineAt));
      // 校正の締切: 自分が校正する版、または職責のある制作物の受付中の版
      if (reviewPending || roleHolder)
        deadlines.push({
          ...item(accepting, accepting.deadlineAt, unresolved),
          deadlineKind: "review",
        });
    } else if (latest?.lapsed) {
      out.backlog.overdue.push(item(latest, latest.deadlineAt, tally.unresolved));
      countThreads(tally);
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
      accepting: accepting !== null,
      hasRevision: latest !== null,
    });
    if (stage) rows.push(overviewRow(work, stage, { reviewDeadlineAt: null, ...detail }));
    if (reviewing) out.roles.reviewer++;
    if (lastActivity !== null && now - lastActivity >= dashboardPolicy.staleAfterMs)
      out.backlog.stale.push(item(latest, lastActivity));
    if (work.deadlineAt !== undefined && work.deadlineAt - now <= dashboardPolicy.dueSoonWithinMs)
      out.backlog.dueSoon.push(item(accepting ?? latest, work.deadlineAt));
    if (work.deadlineAt !== undefined && roleHolder)
      deadlines.push({ ...item(accepting ?? latest, work.deadlineAt), deadlineKind: "delivery" });
  }

  // 提出する（FAB「版を提出」と同じ判定。提出の権限は listSubmitTargets が確かめる）
  for (const t of await listSubmitTargets(
    ctx,
    principal,
    visible,
    opts.submitPolicy ?? submitTargetPolicy,
  ))
    out.mine.submit.push({
      workId: t.workId,
      workTitle: t.workTitle,
      revisionId: null,
      revisionLabel: t.latestLabel,
      deadlineAt: t.deadlineAt,
      count: 0,
      route: t.route,
      mediaType: t.mediaType,
      ...(t.acceptingLabel ? { note: `${t.acceptingLabel}が受付中` } : {}),
    });

  // 次の締切（期限内のものだけ、近い順）
  const future = deadlines
    .filter((d) => d.deadlineAt !== null && d.deadlineAt > now)
    .sort(byDeadline);
  out.upcoming = future.filter((d) => d.deadlineAt! - now <= dashboardPolicy.upcomingWithinMs);
  out.nextDeadline = future[0] ?? null;

  // 自分宛てのコメント（通知から）
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
    if (out.mentions.length >= dashboardPolicy.mentionsMax) break;
    if (!dashboardPolicy.mentionKinds.includes(n.kind)) continue;
    if (now - n.createdAt > dashboardPolicy.mentionsWithinMs) continue;
    if (!n.workId || !titles.has(n.workId)) continue;
    // 削除されたコメントへの通知は出さない（本文を伏せ、飛び先も無い）
    if (await isCommentGone(n)) continue;
    out.mentions.push({
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

  // ピン留め（見られなくなった制作物は出さない）
  const summarize = async (workId: string, at: number): Promise<DashboardItem | null> => {
    const work = await ctx.works.findById(workId);
    if (!work) return null;
    const grants = await ctx.acl.listByWork(work.id);
    if (!(await canView(ctx, principal, work, grants))) return null;
    const { accepting, latest } =
      (await ctx.workSummaries.findByWork(work.id)) ??
      revisionHeadsOf(await ctx.revisions.listByWork(work.id));
    return {
      workId: work.id,
      workTitle: work.title,
      revisionId: (accepting ?? latest)?.id ?? null,
      revisionLabel: latest?.label ?? null,
      deadlineAt: accepting?.deadlineAt ?? work.deadlineAt ?? null,
      deadlineKind: accepting ? "review" : "delivery",
      count: 0,
      at,
    };
  };
  for (const p of await ctx.home.listPins(principal.userId)) {
    const i = await summarize(p.workId, p.pinnedAt);
    if (i) out.pinned.push(i);
  }

  for (const list of [...Object.values(out.mine), ...Object.values(out.backlog)])
    list.sort(byDeadline);

  const overview: DashboardOverview = {
    asOf: now,
    total: rows.length,
    stages: tallyStages(rows.map((r) => r.stage)),
    threads: threadTotals,
    reviewers,
    checksPending,
    works: rows.filter((r) => r.stage !== "finalized").sort(compareWorkRows),
    bureaus: summarizeByBureau(rows),
  };
  const summary: DashboardSummary = {
    todo: Object.values(out.mine).reduce((n, list) => n + list.length, 0),
    dueSoon: out.upcoming.length,
    overdue: out.backlog.overdue.length,
    unread: out.mentions.filter((m) => m.unread).length,
  };

  return { ...out, summary, overview };
}
