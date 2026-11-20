import {
  isAllowed,
  workProgressOf,
  type Principal,
  type WorkAction,
  type WorkPermissionGrant,
} from "@mf100/domain";
import { describe, expect, it } from "vite-plus/test";
import { grantWorkPermission } from "../usecases/acl.ts";
import { deleteThread, postComment } from "../usecases/comments.ts";
import { completeMyReview } from "../usecases/reviews.ts";
import { DELETED_COMMENT_NOTIFICATION, listMyNotifications } from "../usecases/notifications.ts";
import { setWorkReviewers } from "../usecases/reviewers.ts";
import { isAllowedLazily, loadAuthorizedWorkOwnGrants, loadAuthorizedWork } from "../shared.ts";
import { buildWorksDashboard, NO_TEAM } from "../usecases/dashboard.ts";
import { createInMemoryContext } from "../testing/inMemory.ts";
import { principals, seedWork, submitRevision } from "../testing/scenario.ts";

const workActions: readonly WorkAction[] = [
  "work.view",
  "work.edit",
  "revision.submit",
  "comment.post",
  "comment.reply",
  "review.participate",
  "comment.decide",
  "comment.resolve",
  "review.assign",
  "work.finalize",
  "work.reopen",
  "work.cancel",
  "approval.confirm",
  "acl.manage",
  "audit.view",
];

/** 読む量を減らした経路（許可は本人の分だけ・削除済みは索引で・進み具合は行から）が、広く読む経路と同じ結果になること */

async function seed() {
  const ctx = createInMemoryContext();
  const work = await seedWork(ctx, { title: "A" });
  const revision = await submitRevision(ctx, work.id, { deadlineInHours: 48 });
  return { ctx, work, revision };
}

describe("許可は本人に当たる分だけ読む", () => {
  it("他の人への許可は、この人の判定に効かない（負の確認）", async () => {
    const { ctx, work } = await seed();
    await grantWorkPermission(ctx, principals.sysadmin, {
      workId: work.id,
      userIds: [principals.reviewer.userId],
      permission: "manage",
    });
    // 他の人に manage があっても、職責も許可も無い人は work.edit できない
    await expect(
      loadAuthorizedWorkOwnGrants(ctx, principals.stranger, work.id, "work.edit"),
    ).rejects.toMatchObject({ code: "forbidden" });
    await expect(
      loadAuthorizedWork(ctx, principals.stranger, work.id, "work.edit"),
    ).rejects.toMatchObject({ code: "forbidden" });
    // 本人に manage があれば通り、返る許可は本人の分だけ
    await grantWorkPermission(ctx, principals.sysadmin, {
      workId: work.id,
      userIds: [principals.stranger.userId],
      permission: "manage",
    });
    const loaded = await loadAuthorizedWorkOwnGrants(
      ctx,
      principals.stranger,
      work.id,
      "work.edit",
    );
    expect(loaded.grants.map((g) => g.principalId)).toEqual([principals.stranger.userId]);
  });

  it("存在しない制作物は forbidden（存在を漏らさない）", async () => {
    const { ctx } = await seed();
    await expect(
      loadAuthorizedWorkOwnGrants(ctx, principals.creator, "nope", "work.view"),
    ).rejects.toMatchObject({ code: "forbidden" });
  });

  it("許可を後から読む判定は、許可を全部渡した判定と、全操作・全主体で同じ", async () => {
    const { ctx, work } = await seed();
    const levels = ["review", "edit", "manage"] as const;
    const who: Principal[] = [
      principals.creator,
      principals.manager,
      principals.reviewer,
      principals.approver,
      principals.stranger,
      principals.sysadmin,
    ];
    for (const level of levels)
      await grantWorkPermission(ctx, principals.sysadmin, {
        workId: work.id,
        userIds: [who[levels.indexOf(level) + 2]!.userId],
        permission: level,
      });
    const stored = (await ctx.works.findById(work.id))!;
    const all: WorkPermissionGrant[] = await ctx.acl.listByWork(work.id);
    for (const p of who)
      for (const action of workActions) {
        const own = await ctx.acl.listForPrincipalOnWork(work.id, p);
        let reads = 0;
        const lazy = await isAllowedLazily(action, stored, p, async () => {
          reads++;
          return own;
        });
        expect(lazy, `${p.userId} ${action}`).toBe(
          isAllowed(action, { work: stored, grants: all, principal: p }),
        );
        // 許可なしで許されるときは読まない
        if (isAllowed(action, { work: stored, grants: [], principal: p })) expect(reads).toBe(0);
      }
  });
});

describe("削除されたコメントの通知は、スレッドの文書を読まずに伏せる", () => {
  it("版の削除済みスレッドの索引で判定し、結果は文書を読んだときと同じ", async () => {
    const { ctx, revision } = await seed();
    const post = async () =>
      postComment(ctx, principals.reviewer, {
        revisionId: revision.id,
        body: "誤字",
        kind: "correction",
        severity: "info",
      });
    const gone = await post();
    const stays = await post();
    await deleteThread(ctx, principals.sysadmin, { threadId: gone.id });
    expect(await ctx.threads.listDeletedIdsByRevision(revision.id)).toEqual([gone.id]);
    const original = ctx.threads.findById;
    let documentReads = 0;
    ctx.threads.findById = async (id) => {
      documentReads++;
      return original(id);
    };
    const list = await listMyNotifications(ctx, principals.creator);
    expect(documentReads).toBe(0);
    expect(list.filter((n) => n.body === DELETED_COMMENT_NOTIFICATION.body)).toHaveLength(1);
    expect(list.some((n) => n.threadId === gone.id)).toBe(false);
    expect(list.some((n) => n.threadId === stays.id)).toBe(true);
  });
});

describe("受付中の版の進み具合は、割当・専門確認の今の状態と一致する", () => {
  it("割当・完了・専門確認・受付終了のあとも、数え直した値と同じ", async () => {
    const { ctx, work, revision } = await seed();
    const check = async () => {
      const w = (await ctx.works.findById(work.id))!;
      const summary = await ctx.workSummaries.findByWork(w.id);
      const accepting = summary?.accepting?.id ?? null;
      if (!accepting) return;
      expect(await ctx.workSummaries.findProgress(w.id, accepting)).toEqual(
        workProgressOf({
          assignments: await ctx.assignments.listByRevision(accepting),
          checks: await ctx.checks.listByRevision(accepting),
        }),
      );
    };
    await check();
    await grantWorkPermission(ctx, principals.sysadmin, {
      workId: work.id,
      userIds: [principals.reviewer.userId],
      permission: "review",
    });
    await setWorkReviewers(ctx, principals.manager, {
      workId: work.id,
      reviewerIds: [principals.reviewer.userId],
    });
    await check();
    await ctx.checks.insert({
      revisionId: revision.id,
      type: "photo",
      label: "写真",
      assigneeId: principals.reviewer.userId,
      state: "pending",
    });
    await check();
    expect(await ctx.workSummaries.findProgress(work.id, revision.id)).toEqual({
      reviewers: { total: 1, done: 0 },
      checks: { total: 1, pending: 1 },
    });
    await completeMyReview(ctx, principals.reviewer, revision.id);
    await check();
    expect((await ctx.workSummaries.findProgress(work.id, revision.id))?.reviewers.done).toBe(1);
  });
});

describe("全体の状況: 校了した制作物は数だけで足しても、全件を渡したときと同じ", () => {
  it("段階・局・全体の数が一致し、数の鍵は主管担当（担当は親の局に寄せる）", async () => {
    const ctx = createInMemoryContext();
    const bureau = await ctx.teams.insert({
      name: "制作局",
      kind: "bureau",
      order: 1,
      updatedAt: 0,
      updatedBy: "u_sysadmin",
    });
    const bureau2 = await ctx.teams.insert({
      name: "広報局",
      kind: "bureau",
      order: 2,
      updatedAt: 0,
      updatedBy: "u_sysadmin",
    });
    const team = await ctx.teams.insert({
      name: "デザイン担当",
      kind: "team",
      parentId: bureau.id,
      order: 1,
      updatedAt: 0,
      updatedBy: "u_sysadmin",
    });
    const make = async (title: string, ownerTeamId: string | undefined, final: boolean) => {
      const w = await seedWork(ctx, { title, ...(ownerTeamId ? { ownerTeamId } : {}) });
      const stored = (await ctx.works.findById(w.id))!;
      if (final) await ctx.works.update({ ...stored, lifecycle: "finalized" });
      return w.id;
    };
    await make("校了・局", bureau.id, true);
    await make("校了・担当（親は制作局）", team.id, true);
    await make("校了・広報局", bureau2.id, true);
    await make("校了・担当なし", undefined, true);
    const open = await make("進行中", bureau.id, false);
    await submitRevision(ctx, open, { deadlineInHours: 48 });
    const all = await ctx.works.list(100);
    const full = await buildWorksDashboard(ctx, principals.manager, all);
    const narrowed = await buildWorksDashboard(
      ctx,
      principals.manager,
      all.filter((w) => w.lifecycle !== "finalized"),
      { finalizedByTeam: { [bureau.id]: 1, [team.id]: 1, [bureau2.id]: 1, [NO_TEAM]: 1 } },
    );
    expect(narrowed).toEqual(full);
    expect(full.overview.stages.finalized).toBe(4);
    expect(full.overview.bureaus.find((b) => b.bureau === "制作局")).toMatchObject({
      works: 3,
      finalized: 2,
    });
  });
});
