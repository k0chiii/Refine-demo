import { describe, expect, it } from "vite-plus/test";
import { completeMyReview } from "../usecases/reviews.ts";
import { setWorkReviewers } from "../usecases/reviewers.ts";
import { updateWork } from "../usecases/works.ts";
import { createInMemoryContext } from "../testing/inMemory.ts";
import { principals, seedWork, submitRevision } from "../testing/scenario.ts";

const code = (c: string) => expect.objectContaining({ code: c });

describe("制作物の校正者名簿", () => {
  it("登録で渡した名簿から、版の確定が general の pending を作る", async () => {
    const ctx = createInMemoryContext();
    const work = await seedWork(ctx, {
      reviewerIds: [principals.reviewer.userId, principals.stranger.userId],
    });
    expect(work.reviewerIds).toEqual([principals.reviewer.userId, principals.stranger.userId]);
    expect(work.version).toBe(1);
    const revision = await submitRevision(ctx, work.id, { reviewType: "special" });
    const rows = await ctx.assignments.listByRevision(revision.id);
    expect(rows.map((a) => [a.reviewerId, a.reviewType, a.state])).toEqual([
      [principals.reviewer.userId, "general", "pending"],
      [principals.stranger.userId, "general", "pending"],
    ]);
    expect(revision.reviewType).toBe("special");
  });

  it("名簿を変えても版番号は動かず、同じ版番号で制作物を更新できる", async () => {
    const ctx = createInMemoryContext();
    const work = await seedWork(ctx);
    await submitRevision(ctx, work.id);
    const before = (await ctx.works.findById(work.id))!;
    const saved = await setWorkReviewers(ctx, principals.manager, {
      workId: work.id,
      reviewerIds: [principals.reviewer.userId],
    });
    expect(saved.work.version).toBe(before.version);
    const edited = await updateWork(ctx, principals.manager, {
      workId: work.id,
      expectedVersion: before.version,
      patch: { purpose: "差し替え" },
    });
    expect(edited.purpose).toBe("差し替え");
    expect(edited.reviewerIds).toEqual([principals.reviewer.userId]);
    expect(edited.version).toBe(before.version + 1);
  });

  it("未完了は消し、完了は残し、戻すと新しい pending になり、同じ名簿の再保存は通知しない", async () => {
    const ctx = createInMemoryContext();
    const work = await seedWork(ctx);
    const revision = await submitRevision(ctx, work.id);
    const versionAfterSubmit = (await ctx.works.findById(work.id))!.version;
    await setWorkReviewers(ctx, principals.creator, {
      workId: work.id,
      reviewerIds: [principals.reviewer.userId, principals.stranger.userId],
    });
    await completeMyReview(ctx, principals.reviewer, revision.id);
    const before = ctx.state.notifications.all().length;
    await setWorkReviewers(ctx, principals.manager, {
      workId: work.id,
      reviewerIds: [principals.reviewer.userId],
    });
    const left = await ctx.assignments.listByRevision(revision.id);
    expect(left.map((a) => [a.reviewerId, a.state])).toEqual([
      [principals.reviewer.userId, "responded"],
    ]);
    expect(left.some((a) => a.state === "excused")).toBe(false);
    await setWorkReviewers(ctx, principals.manager, {
      workId: work.id,
      reviewerIds: [principals.reviewer.userId, principals.stranger.userId],
    });
    const back = await ctx.assignments.listByRevision(revision.id);
    expect(back.find((a) => a.reviewerId === principals.stranger.userId)).toMatchObject({
      state: "pending",
      reviewType: "general",
    });
    expect(back.find((a) => a.reviewerId === principals.stranger.userId)?.viewedAt).toBeUndefined();
    const notes = ctx.state.notifications.all().length;
    await setWorkReviewers(ctx, principals.manager, {
      workId: work.id,
      reviewerIds: [principals.reviewer.userId, principals.stranger.userId],
    });
    expect(ctx.state.notifications.all().length).toBe(notes);
    expect(ctx.state.notifications.all().length).toBeGreaterThan(before);
    const stored = await ctx.works.findById(work.id);
    expect(stored?.version).toBe(versionAfterSubmit);
  });

  it("未設定の古い行は、次の版の確定で直前の校正者を名簿にする", async () => {
    const ctx = createInMemoryContext();
    const created = await seedWork(ctx);
    const first = await submitRevision(ctx, created.id);
    const stored = await ctx.works.findById(created.id);
    const { reviewerIds: _ids, ...legacy } = stored!;
    void _ids;
    await ctx.works.update(legacy);
    await ctx.assignments.upsert({
      revisionId: first.id,
      reviewerId: principals.reviewer.userId,
      reviewType: "general",
      state: "responded",
      respondedAt: ctx.clock.now(),
    });
    await ctx.assignments.upsert({
      revisionId: first.id,
      reviewerId: principals.stranger.userId,
      reviewType: "general",
      state: "excused",
    });
    const second = await submitRevision(ctx, created.id);
    expect((await ctx.works.findById(created.id))?.reviewerIds).toEqual([
      principals.reviewer.userId,
    ]);
    expect((await ctx.assignments.listByRevision(second.id)).map((a) => a.reviewerId)).toEqual([
      principals.reviewer.userId,
    ]);
    expect((await ctx.assignments.listByRevision(first.id)).map((a) => a.state).sort()).toEqual([
      "excused",
      "responded",
    ]);
  });

  it("校了・中止の制作物と、知らない人は名簿に入れない", async () => {
    const ctx = createInMemoryContext();
    const work = await seedWork(ctx);
    await ctx.works.update({ ...work, lifecycle: "finalized" });
    await expect(
      setWorkReviewers(ctx, principals.manager, {
        workId: work.id,
        reviewerIds: [principals.reviewer.userId],
      }),
    ).rejects.toThrow(code("work_not_editable"));
    await ctx.works.update({ ...work, lifecycle: "active" });
    await expect(
      setWorkReviewers(ctx, principals.manager, {
        workId: work.id,
        reviewerIds: ["missing-user"],
      }),
    ).rejects.toThrow(code("work_invalid"));
    expect((await ctx.works.findById(work.id))?.reviewerIds).toEqual([]);
  });

  it("受付中でない版の割当は名簿を変えても残る", async () => {
    const ctx = createInMemoryContext();
    const work = await seedWork(ctx, { reviewerIds: [principals.reviewer.userId] });
    const first = await submitRevision(ctx, work.id);
    const second = await submitRevision(ctx, work.id);
    await setWorkReviewers(ctx, principals.manager, {
      workId: work.id,
      reviewerIds: [],
    });
    expect((await ctx.assignments.listByRevision(first.id)).map((a) => a.reviewerId)).toEqual([
      principals.reviewer.userId,
    ]);
    expect(await ctx.assignments.listByRevision(second.id)).toEqual([]);
  });
});
