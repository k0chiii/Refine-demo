import {
  isAccepting,
  isAllowed,
  revisionLabel,
  type Principal,
  type Revision,
  type Work,
} from "@mf100/domain";
import type { AppContext } from "../ports.ts";

/** ダッシュボードの 1 行。押すとエディタの該当版へ行ける情報だけを持つ。 */
export interface DashboardItem {
  workId: string;
  workTitle: string;
  revisionId: string | null;
  revisionLabel: string | null;
  /** 校正期限（版）または納期（制作物）。並び替えと表示に使う */
  deadlineAt: number | null;
  /** 未対応の指摘数など、行の右に出す数 */
  count: number;
}

export interface Dashboard {
  /** あなたの担当（役割ごとに自動で出る） */
  mine: {
    /** 校正する: 自分に割り当てられ、まだ確認を完了していない受付中の版 */
    review: DashboardItem[];
    /** 返事をする: 採否判断ができる制作物で、受付中の版に未対応の指摘がある */
    respond: DashboardItem[];
    /** 校了する: 校了権限があり、受付中の通常版に未対応の指摘も未完了の専門確認もない */
    finalize: DashboardItem[];
    /** 割り当てる: 割当権限があり、受付中の版に校正者がいない */
    assign: DashboardItem[];
  };
  /** 溜まっているもの（自分が関わる制作物だけ） */
  backlog: {
    /** 期限到来で受付が終わり、そのまま次の版が出ていない */
    overdue: DashboardItem[];
    /** 受付中なのに校正者がいない */
    unassigned: DashboardItem[];
    /** 一定期間、提出も指摘もない */
    stale: DashboardItem[];
    /** 納期が近い */
    dueSoon: DashboardItem[];
  };
}

/** 閾値。制度ではなく表示の判断なので変更しやすいよう外に出す。 */
export const dashboardPolicy = {
  staleAfterMs: 14 * 86_400_000,
  dueSoonWithinMs: 14 * 86_400_000,
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
): Promise<Dashboard> {
  const now = ctx.clock.now();
  const out: Dashboard = {
    mine: { review: [], respond: [], finalize: [], assign: [] },
    backlog: { overdue: [], unassigned: [], stale: [], dueSoon: [] },
  };
  for (const work of works) {
    const grants = await ctx.acl.listByWork(work.id);
    const authz = { work, grants, principal };
    if (!isAllowed("work.view", authz)) continue;
    if (work.lifecycle !== "active") continue;
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

    let lastActivity = latest?.submittedAt ?? null;
    if (accepting) {
      const threads = await ctx.threads.listByRevision(accepting.id);
      const unresolved = threads.filter((t) => openResolutions.has(t.resolution)).length;
      const assignments = await ctx.assignments.listByRevision(accepting.id);
      const pendingChecks = (await ctx.checks.listByRevision(accepting.id)).filter(
        (c) => c.state === "pending",
      ).length;
      for (const t of threads) lastActivity = Math.max(lastActivity ?? 0, t.createdAt);

      const mine = assignments.find((a) => a.reviewerId === principal.userId);
      if (mine && (mine.state === "pending" || mine.state === "viewed"))
        out.mine.review.push(item(accepting, accepting.deadlineAt, unresolved));
      if (unresolved > 0 && isAllowed("comment.decide", authz))
        out.mine.respond.push(item(accepting, accepting.deadlineAt, unresolved));
      if (
        accepting.kind === "standard" &&
        unresolved === 0 &&
        pendingChecks === 0 &&
        isAllowed("work.finalize", authz)
      )
        out.mine.finalize.push(item(accepting, accepting.deadlineAt));
      if (assignments.length === 0 && isAllowed("review.assign", authz))
        out.mine.assign.push(item(accepting, accepting.deadlineAt));
      if (assignments.length === 0)
        out.backlog.unassigned.push(item(accepting, accepting.deadlineAt));
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
    if (lastActivity !== null && now - lastActivity >= dashboardPolicy.staleAfterMs)
      out.backlog.stale.push(item(latest, lastActivity));
    if (work.deadlineAt !== undefined && work.deadlineAt - now <= dashboardPolicy.dueSoonWithinMs)
      out.backlog.dueSoon.push(item(accepting ?? latest, work.deadlineAt));
  }
  for (const list of [...Object.values(out.mine), ...Object.values(out.backlog)])
    list.sort(byDeadline);
  return out;
}
