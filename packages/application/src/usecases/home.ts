import {
  dashboardWidgetIds,
  defaultSubmitTargetPolicy,
  isAccepting,
  isAllowed,
  isSubmitTarget,
  normalizeDashboardLayout,
  revisionLabel,
  submitRouteFor,
  type DashboardLimit,
  type DashboardWidgetId,
  type DashboardWidgetPref,
  type MediaType,
  type Principal,
  type SubmitRoute,
  type SubmitTargetPolicy,
  type Work,
} from "@mf100/domain";
import type { AppContext } from "../ports.ts";
import { loadAuthorizedWork } from "../shared.ts";

/**
 * 「版を提出する制作物」の現在の条件（L-15）。制度の判断なので値として外に出す（domain の既定をそのまま使う）。
 * - creatorOnly: 自分が制作者の制作物だけ（edit 委任を含めるなら false）
 * - includeAccepting: 受付中の版がある制作物も出す（新しい版で受付中の版は閉じる）
 */
export const submitTargetPolicy: SubmitTargetPolicy = defaultSubmitTargetPolicy;

/** ダッシュボードの役割（既定の構成を作る単位） */
export type DashboardRole = "creator" | "reviewer" | "checker" | "approver" | "manager";

/**
 * 既定の構成（W-26。利用者決定 2026-10-15「役割で自動に組む」）。保存した構成が無い人はこれで組む。
 * 制度ではなく表示の判断だが、役割と節の対応は運用で変えたくなるので値として外に出す。
 */
export const dashboardLayoutPolicy: {
  /** 役割の並び（先の役割の節を上に出す） */
  roleOrder: readonly DashboardRole[];
  /** 役割ごとの「やること」の節 */
  roleWidgets: Record<DashboardRole, readonly DashboardWidgetId[]>;
  /** 役割に関係なく出す補助の節（この順で末尾に） */
  commonWidgets: readonly DashboardWidgetId[];
  /** 持っていない役割の節を既定で隠すか。空の節はどのみち出さないので既定は false（役割が増えたときに自然に出る） */
  hideWidgetsOfOtherRoles: boolean;
  defaultLimit: DashboardLimit;
} = {
  roleOrder: ["creator", "reviewer", "checker", "approver", "manager"],
  roleWidgets: {
    creator: ["submit", "respond"],
    reviewer: ["review"],
    checker: ["checks"],
    approver: ["finalize"],
    manager: ["assign"],
  },
  commonWidgets: ["deadlines", "mentions", "pinned", "recent", "backlog"],
  hideWidgetsOfOtherRoles: false,
  defaultLimit: 5,
};

/** ピン留め・最近開いた制作物の上限（古いものから消す） */
export const homeListPolicy = { maxPins: 20, keepRecent: 20 };

/** 持っている役割から既定の構成を作る。すべての節を並べ、持っている役割の節を先にする */
export function defaultDashboardLayout(
  roles: ReadonlySet<DashboardRole>,
  policy = dashboardLayoutPolicy,
): DashboardWidgetPref[] {
  const order: DashboardWidgetId[] = [];
  const mine = new Set<DashboardWidgetId>();
  for (const role of policy.roleOrder)
    if (roles.has(role))
      for (const id of policy.roleWidgets[role])
        if (!order.includes(id)) {
          order.push(id);
          mine.add(id);
        }
  const todo = policy.roleOrder.flatMap((r) => policy.roleWidgets[r]);
  for (const id of todo) if (!order.includes(id)) order.push(id);
  for (const id of policy.commonWidgets) if (!order.includes(id)) order.push(id);
  for (const id of dashboardWidgetIds) if (!order.includes(id)) order.push(id);
  return order.map((id) => ({
    id,
    visible: !policy.hideWidgetsOfOtherRoles || mine.has(id) || policy.commonWidgets.includes(id),
    limit: policy.defaultLimit,
  }));
}

/** 保存した構成（あれば）と役割の既定から、いまの構成 */
export async function loadDashboardLayout(
  ctx: AppContext,
  principal: Principal,
  roles: ReadonlySet<DashboardRole>,
): Promise<{ widgets: DashboardWidgetPref[]; customized: boolean }> {
  const saved = await ctx.home.findLayout(principal.userId);
  return {
    widgets: normalizeDashboardLayout(saved?.widgets ?? null, defaultDashboardLayout(roles)),
    customized: saved !== null,
  };
}

/** 構成を保存する。知らない ID は捨て、足りない節は既定で末尾に足す */
export async function saveDashboardLayout(
  ctx: AppContext,
  principal: Principal,
  widgets: ReadonlyArray<{ id: string; visible: boolean; limit: number | null }>,
): Promise<DashboardWidgetPref[]> {
  const normalized = normalizeDashboardLayout(widgets, defaultDashboardLayout(new Set()));
  await ctx.home.saveLayout({
    userId: principal.userId,
    widgets: normalized.map((w) => ({ id: w.id, visible: w.visible, limit: w.limit })),
    updatedAt: ctx.clock.now(),
  });
  return normalized;
}

/** 既定（役割で自動）の構成に戻す */
export async function resetDashboardLayout(ctx: AppContext, principal: Principal): Promise<void> {
  await ctx.home.removeLayout(principal.userId);
}

/** ホームにピン留め／外す。見られる制作物だけ */
export async function setWorkPinned(
  ctx: AppContext,
  principal: Principal,
  input: { workId: string; pinned: boolean },
): Promise<boolean> {
  if (!input.pinned) {
    await ctx.home.removePin(principal.userId, input.workId);
    return false;
  }
  await loadAuthorizedWork(ctx, principal, input.workId, "work.view");
  const pins = await ctx.home.listPins(principal.userId);
  if (pins.some((p) => p.workId === input.workId)) return true;
  // 上限を超えたら古いピンから外す
  for (const old of pins.slice(homeListPolicy.maxPins - 1))
    await ctx.home.removePin(principal.userId, old.workId);
  await ctx.home.addPin({
    userId: principal.userId,
    workId: input.workId,
    pinnedAt: ctx.clock.now(),
  });
  return true;
}

export async function isWorkPinned(
  ctx: AppContext,
  principal: Principal,
  workId: string,
): Promise<boolean> {
  return (await ctx.home.listPins(principal.userId)).some((p) => p.workId === workId);
}

/** エディタを開いたら「最近開いた制作物」に記録する（見られる制作物だけ。古いものから消す） */
export async function recordWorkOpened(
  ctx: AppContext,
  principal: Principal,
  workId: string,
): Promise<void> {
  await loadAuthorizedWork(ctx, principal, workId, "work.view");
  await ctx.home.putRecent({ userId: principal.userId, workId, openedAt: ctx.clock.now() });
  const rows = await ctx.home.listRecent(principal.userId);
  for (const old of rows.slice(homeListPolicy.keepRecent))
    await ctx.home.removeRecent(principal.userId, old.workId);
}

/** 版を提出する制作物の候補（FAB「版を提出」・ダッシュボードの「提出する」） */
export interface SubmitTarget {
  workId: string;
  workTitle: string;
  mediaType: MediaType;
  route: SubmitRoute;
  /** 制作物の納期（締切順の並びに使う） */
  deadlineAt: number | null;
  /** 最新の版（無効化を除く）。未提出なら null */
  latestLabel: string | null;
  /** 受付中の版 */
  acceptingLabel: string | null;
}

/**
 * 自分が版を提出できる制作物を締切（納期）順に。`works` は呼び出し側が「自分が関わる制作物」に絞って渡す。
 * 閲覧と提出の権限はここで必ず確かめる（{@link isSubmitTarget} が `revision.submit` を見る）。
 */
export async function listSubmitTargets(
  ctx: AppContext,
  principal: Principal,
  works: readonly Work[],
  policy: SubmitTargetPolicy = submitTargetPolicy,
): Promise<SubmitTarget[]> {
  const out: SubmitTarget[] = [];
  for (const work of works) {
    const grants = await ctx.acl.listByWork(work.id);
    const authz = { work, grants, principal };
    if (!isAllowed("work.view", authz)) continue;
    const revisions = await ctx.revisions.listByWork(work.id);
    if (!isSubmitTarget(authz, revisions, policy)) continue;
    const live = revisions
      .filter((r) => r.reviewState !== "void")
      .sort((a, b) => b.submittedAt - a.submittedAt);
    const accepting = live.find(isAccepting) ?? null;
    out.push({
      workId: work.id,
      workTitle: work.title,
      mediaType: work.mediaType,
      route: submitRouteFor(work.mediaType),
      deadlineAt: work.deadlineAt ?? null,
      latestLabel: live[0] ? revisionLabel(live[0]) : null,
      acceptingLabel: accepting ? revisionLabel(accepting) : null,
    });
  }
  return out.sort(
    (a, b) =>
      (a.deadlineAt ?? Infinity) - (b.deadlineAt ?? Infinity) ||
      a.workTitle.localeCompare(b.workTitle, "ja"),
  );
}
