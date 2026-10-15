import {
  effectivePermission,
  isAccepting,
  isAllowed,
  permissionIncludes,
  revisionLabel,
  rolesOf,
  type DashboardWidgetPref,
  type MediaType,
  type Principal,
  type Revision,
  type SubmitRoute,
  type SubmitTargetPolicy,
  type Work,
} from "@mf100/domain";
import type { AppContext, NotificationKind } from "../ports.ts";
import {
  listSubmitTargets,
  loadDashboardLayout,
  submitTargetPolicy,
  type DashboardRole,
} from "./home.ts";

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
}

export interface Dashboard {
  /** あなたの担当（役割ごとに自動で出る） */
  mine: {
    /** 提出する: 自分が制作者で版を提出できる進行中の制作物（L-15。FAB「版を提出」と同じ判定） */
    submit: DashboardItem[];
    /** 校正する: 自分に割り当てられ、まだ確認を完了していない受付中の版 */
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
  /** 次の締切（{@link dashboardPolicy.upcomingWithinMs} 以内。自分が担当の校正の締切と、職責のある制作物の納期） */
  upcoming: DashboardItem[];
  /** 自分宛てのコメント（通知から: メンション・担当・新しいコメント・判断） */
  mentions: DashboardItem[];
  /** ホームにピン留めした制作物 */
  pinned: DashboardItem[];
  /** 最近開いた制作物 */
  recent: DashboardItem[];
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
  /** 節の並び・表示・件数（保存した構成、無ければ役割から自動） */
  layout: DashboardWidgetPref[];
  /** 自分で構成を変えたか（「既定に戻す」を出す） */
  customized: boolean;
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

const openResolutions = new Set(["open", "acknowledged", "accepted"]);

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
  const out: Omit<Dashboard, "layout" | "customized"> = {
    mine: { submit: [], review: [], respond: [], checks: [], finalize: [], assign: [] },
    upcoming: [],
    mentions: [],
    pinned: [],
    recent: [],
    backlog: { overdue: [], unassigned: [], stale: [], dueSoon: [] },
    roles: { creator: 0, reviewer: 0, checker: 0, approver: 0, manager: 0 },
    nextDeadline: null,
  };
  const visible: Work[] = [];
  const deadlines: DashboardItem[] = [];
  for (const work of works) {
    const grants = await ctx.acl.listByWork(work.id);
    const authz = { work, grants, principal };
    if (!isAllowed("work.view", authz)) continue;
    visible.push(work);
    if (work.lifecycle !== "active") continue;
    const roles = rolesOf(work, principal);
    const level = effectivePermission(grants, principal);
    if (roles.isCreator) out.roles.creator++;
    if (roles.isApprover) out.roles.approver++;
    if (roles.isManager) out.roles.manager++;
    const revisions = (await ctx.revisions.listByWork(work.id)).filter(
      (r) => r.reviewState !== "void",
    );
    const accepting = revisions.find(isAccepting) ?? null;
    const latest = revisions.sort((a, b) => b.submittedAt - a.submittedAt)[0] ?? null;
    const item = (r: Revision | null, deadlineAt: number | null, count = 0): DashboardItem => ({
      workId: work.id,
      workTitle: work.title,
      revisionId: r?.id ?? null,
      revisionLabel: r ? revisionLabel(r) : null,
      deadlineAt,
      count,
    });
    const roleHolder = roles.isCreator || roles.isApprover || roles.isManager;

    let lastActivity = latest?.submittedAt ?? null;
    let reviewing = level !== null && permissionIncludes(level, "review") && !roleHolder;
    if (accepting) {
      const threads = await ctx.threads.listByRevision(accepting.id);
      const unresolved = threads.filter((t) => openResolutions.has(t.resolution)).length;
      const assignments = await ctx.assignments.listByRevision(accepting.id);
      const checks = await ctx.checks.listByRevision(accepting.id);
      const pendingChecks = checks.filter((c) => c.state === "pending");
      for (const t of threads) lastActivity = Math.max(lastActivity ?? 0, t.createdAt);

      const mine = assignments.find((a) => a.reviewerId === principal.userId);
      if (mine) reviewing = true;
      const reviewPending = mine && (mine.state === "pending" || mine.state === "viewed");
      if (reviewPending) out.mine.review.push(item(accepting, accepting.deadlineAt, unresolved));
      if (unresolved > 0 && isAllowed("comment.decide", authz))
        out.mine.respond.push(item(accepting, accepting.deadlineAt, unresolved));
      for (const c of pendingChecks.filter((c) => c.assigneeId === principal.userId)) {
        out.roles.checker++;
        out.mine.checks.push({ ...item(accepting, accepting.deadlineAt), note: c.label });
      }
      if (
        accepting.kind === "standard" &&
        unresolved === 0 &&
        pendingChecks.length === 0 &&
        isAllowed("work.finalize", authz)
      )
        out.mine.finalize.push(item(accepting, accepting.deadlineAt));
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
    } else if (
      latest &&
      latest.reviewState === "closed" &&
      latest.reviewClosedReason === "deadline"
    ) {
      const unresolved = (await ctx.threads.listByRevision(latest.id)).filter((t) =>
        openResolutions.has(t.resolution),
      ).length;
      out.backlog.overdue.push(item(latest, latest.deadlineAt, unresolved));
    }
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
  for (const n of await ctx.notifications.listForUser(principal.userId, 100)) {
    if (out.mentions.length >= dashboardPolicy.mentionsMax) break;
    if (!dashboardPolicy.mentionKinds.includes(n.kind)) continue;
    if (now - n.createdAt > dashboardPolicy.mentionsWithinMs) continue;
    if (!n.workId || !titles.has(n.workId)) continue;
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

  // ピン留め・最近開いた制作物（見られなくなった制作物は出さない）
  const summarize = async (workId: string, at: number): Promise<DashboardItem | null> => {
    const work = await ctx.works.findById(workId);
    if (!work) return null;
    const grants = await ctx.acl.listByWork(work.id);
    if (!isAllowed("work.view", { work, grants, principal })) return null;
    const revisions = (await ctx.revisions.listByWork(work.id)).filter(
      (r) => r.reviewState !== "void",
    );
    const accepting = revisions.find(isAccepting) ?? null;
    const latest = revisions.sort((a, b) => b.submittedAt - a.submittedAt)[0] ?? null;
    return {
      workId: work.id,
      workTitle: work.title,
      revisionId: (accepting ?? latest)?.id ?? null,
      revisionLabel: latest ? revisionLabel(latest) : null,
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
  for (const r of await ctx.home.listRecent(principal.userId)) {
    const i = await summarize(r.workId, r.openedAt);
    if (i) out.recent.push(i);
  }

  for (const list of [...Object.values(out.mine), ...Object.values(out.backlog)])
    list.sort(byDeadline);

  const held = new Set<DashboardRole>(
    (Object.keys(out.roles) as DashboardRole[]).filter((r) => out.roles[r] > 0),
  );
  const { widgets, customized } = await loadDashboardLayout(ctx, principal, held);
  return { ...out, layout: widgets, customized };
}
