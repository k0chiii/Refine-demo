import {
  defaultSubmitTargetPolicy,
  isSubmitTarget,
  revisionHeadsOf,
  rolesOf,
  submitRouteFor,
  type MediaType,
  type Principal,
  type SubmitRoute,
  type SubmitTargetPolicy,
  type Work,
} from "@mf100/domain";
import type { AppContext } from "../ports.ts";
import { canView, loadAuthorizedWork } from "../shared.ts";

/**
 * 「版を提出する制作物」の現在の条件（L-15）。制度の判断なので値として外に出す（domain の既定をそのまま使う）。
 * - creatorOnly: 自分が制作者の制作物だけ（edit 委任を含めるなら false）
 * - includeAccepting: 受付中の版がある制作物も出す（新しい版で受付中の版は閉じる）
 */
export const submitTargetPolicy: SubmitTargetPolicy = defaultSubmitTargetPolicy;

/** ダッシュボードの役割（制作物のページの件数・「役割ごとの件数」の単位） */
export type DashboardRole = "creator" | "reviewer" | "checker" | "approver" | "manager";

/** ピン留めの上限（古いものから外す） */
export const homeListPolicy = { maxPins: 20 };

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
    // 読む前に、制作物そのものだけで決まる除外をする（isSubmitTarget が必ず false にする条件と同じ）。
    // この問い合わせはシェルで常時購読されるので、候補にならない大多数の制作物の ACL・版を読まない
    // （読んだ分だけ、その制作物の版・ACL の書込みで全員の購読が再実行される）
    if (work.lifecycle !== "active") continue;
    if (policy.creatorOnly && !rolesOf(work, principal).isCreator) continue;
    const grants = await ctx.acl.listByWork(work.id);
    const authz = { work, grants, principal };
    // 版を読む前に、版に依らない条件（提出の権限）だけで落とす
    if (!isSubmitTarget(authz, { accepting: null }, { ...policy, includeAccepting: true }))
      continue;
    if (!(await canView(ctx, principal, work, grants))) continue;
    const heads =
      (await ctx.workSummaries.findByWork(work.id)) ??
      revisionHeadsOf(await ctx.revisions.listByWork(work.id));
    if (!isSubmitTarget(authz, heads, policy)) continue;
    out.push({
      workId: work.id,
      workTitle: work.title,
      mediaType: work.mediaType,
      route: submitRouteFor(work.mediaType),
      deadlineAt: work.deadlineAt ?? null,
      latestLabel: heads.latest?.label ?? null,
      acceptingLabel: heads.accepting?.label ?? null,
    });
  }
  return out.sort(
    (a, b) =>
      (a.deadlineAt ?? Infinity) - (b.deadlineAt ?? Infinity) ||
      a.workTitle.localeCompare(b.workTitle, "ja"),
  );
}
