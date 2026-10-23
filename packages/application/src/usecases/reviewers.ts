import {
  DomainError,
  formatDeadlineUntil,
  isEmptySync,
  mayAssignReviewers,
  normalizeReviewerIds,
  planAssignmentSync,
  type Principal,
  reviewerRosterOf,
  type Revision,
  revisionLabel,
  type UserId,
  type Work,
  type AssignmentSync,
} from "@mf100/domain";
import type { AppContext } from "../ports.ts";
import { loadAuthorizedWork } from "../shared.ts";
import { about, excerpt, notify, personName } from "./notifications.ts";

export interface SetWorkReviewersInput {
  workId: string;
  reviewerIds: string[];
}

export interface SetWorkReviewersResult {
  work: Work;
  /** 受付中の版が無いときは null。差が空でもオブジェクトは返す。 */
  applied: { revisionId: string; sync: AssignmentSync } | null;
}

/**
 * 校正者の名簿を置き換える。登録後の書き手。Work.version は変えない。
 * 受付中の版だけ、未完了の割当を名簿に揃える。完了した割当は残す。
 */
export async function setWorkReviewers(
  ctx: AppContext,
  principal: Principal,
  input: SetWorkReviewersInput,
): Promise<SetWorkReviewersResult> {
  const { work, grants } = await loadAuthorizedWork(ctx, principal, input.workId, "work.view");
  if (!mayAssignReviewers({ work, grants, principal }))
    throw new DomainError("forbidden", { action: "review.assign" });
  if (work.lifecycle === "finalized" || work.lifecycle === "cancelled")
    throw new DomainError("work_not_editable", { workId: work.id, lifecycle: work.lifecycle });

  const ids = normalizeReviewerIds(input.reviewerIds);
  const roster = reviewerRosterOf(work);
  const known = new Set(roster.kind === "set" ? roster.ids : []);
  const fresh = ids.filter((id) => !known.has(id));
  if (fresh.length > 0) {
    const found = new Set((await ctx.people.profiles(fresh)).map((p) => p.id));
    const missing = fresh.filter((id) => !found.has(id));
    if (missing.length > 0)
      throw new DomainError("work_invalid", {
        field: "reviewerIds",
        reason: "unknown_user",
        userIds: missing,
      });
  }

  const same = roster.kind === "set" && sameOrdered(roster.ids, ids);
  const next: Work = same ? work : { ...work, reviewerIds: ids };
  if (!same) {
    await ctx.works.update(next);
    await ctx.audit.record({
      entityType: "work",
      entityId: work.id,
      operation: "reviewers:set",
      actorId: principal.userId,
      before: roster.kind === "set" ? [...roster.ids] : null,
      after: ids,
      at: ctx.clock.now(),
    });
  }

  const accepting = acceptingRevision(await ctx.revisions.listByWork(work.id));
  const applied = accepting
    ? {
        revisionId: accepting.id,
        sync: await syncRevisionToRoster(ctx, next, accepting, ids, principal.userId),
      }
    : null;
  return { work: next, applied };
}

export async function syncRevisionToRoster(
  ctx: AppContext,
  work: Work,
  revision: Revision,
  rosterIds: readonly UserId[],
  actorId: UserId,
): Promise<AssignmentSync> {
  const current = await ctx.assignments.listByRevision(revision.id);
  const sync = planAssignmentSync(rosterIds, current, revision.id);
  if (isEmptySync(sync)) return sync;
  for (const a of sync.add) await ctx.assignments.upsert(a);
  for (const a of sync.remove) await ctx.assignments.delete(a.revisionId, a.reviewerId);
  const now = ctx.clock.now();
  await ctx.audit.record({
    entityType: "reviewAssignment",
    entityId: revision.id,
    operation: "roster_sync",
    actorId,
    after: {
      add: sync.add.map((a) => a.reviewerId),
      remove: sync.remove.map((a) => a.reviewerId),
    },
    at: now,
  });
  const who = await personName(ctx, actorId);
  await notify(
    ctx,
    sync.add.map((a) => a.reviewerId),
    actorId,
    {
      kind: "review_assigned",
      title: "校正を割り当てられました",
      body: `${about(work.title, revisionLabel(revision), who ? `${who}から` : null)}。締切は ${formatDeadlineUntil(revision.deadlineAt, now)}。${
        revision.focusNotes?.trim()
          ? `見てほしい観点: ${excerpt(revision.focusNotes, 80)}`
          : "校正画面で内容を確かめ、終わったら「校正を完了」を押してください。"
      }`,
      workId: work.id,
      revisionId: revision.id,
    },
  );
  return sync;
}

function acceptingRevision(revisions: readonly Revision[]): Revision | null {
  let found: Revision | null = null;
  for (const revision of revisions) {
    if (revision.reviewState !== "open") continue;
    if (!found || revision.sequence > found.sequence) found = revision;
  }
  return found;
}

function sameOrdered(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((id, i) => id === b[i]);
}
