import { describe, expect, it } from "vite-plus/test";
import { deleteThread } from "../usecases/comments.ts";
import { resolveMigratedFeedbackThread } from "../usecases/feedbackMigration.ts";
import { listMyNotifications, notify } from "../usecases/notifications.ts";
import { createInMemoryContext, type InMemoryContext } from "../testing/inMemory.ts";
import { HOUR, principals, seedWork, submitRevision } from "../testing/scenario.ts";

const { creator, stranger } = principals;

async function setup() {
  const ctx = createInMemoryContext();
  const work = await seedWork(ctx, { title: "EVE 企画ポスター" });
  await submitRevision(ctx, work.id);
  ctx.clock.advance(HOUR);
  const rev2 = await submitRevision(ctx, work.id);
  return { ctx, work, rev2 };
}

/** 旧 FB から移したコメントを直接作る（FB の機能と移行は廃止したので、移行済みのデータの再現） */
function addMigrated(ctx: InMemoryContext, feedbackThreadId: string, revisionId: string) {
  return ctx.state.threads.insert({
    revisionId,
    authorId: creator.userId,
    body: "配色の意図です",
    kind: "correction",
    severity: "major",
    resolution: "open",
    createdAt: 1_000,
    migratedFromFeedbackThreadId: feedbackThreadId,
  });
}

describe("旧 FB の URL からの行き先", () => {
  it("移したスレッドは移し先のコメントへ。移していない・削除した・見られない制作物は null", async () => {
    const { ctx, rev2 } = await setup();
    const secret = await seedWork(ctx, { title: "極秘" });
    const secretRev = await submitRevision(ctx, secret.id);
    const t = { id: "fb-moved" };
    const hidden = { id: "fb-hidden" };
    const pending = { id: "fb-pending" };
    const moved = await addMigrated(ctx, t.id, rev2.id);
    await addMigrated(ctx, hidden.id, secretRev.id);

    expect(await resolveMigratedFeedbackThread(ctx, stranger, t.id)).toEqual({
      revisionId: rev2.id,
      threadId: moved.id,
    });
    expect(await resolveMigratedFeedbackThread(ctx, stranger, pending.id)).toBeNull();
    expect(await resolveMigratedFeedbackThread(ctx, stranger, "no-such")).toBeNull();
    expect(await resolveMigratedFeedbackThread(ctx, stranger, hidden.id)).toEqual({
      revisionId: expect.any(String),
      threadId: expect.any(String),
    });
    await deleteThread(ctx, creator, { threadId: moved.id });
    expect(await resolveMigratedFeedbackThread(ctx, stranger, t.id)).toBeNull();
  });
});

describe("FB の通知の行き先", () => {
  it("移したスレッドの通知は移し先のコメントへ、移していない通知は行き先を持たない。見られない制作物は伏せる", async () => {
    const { ctx, work, rev2 } = await setup();
    const secret = await seedWork(ctx, { title: "極秘ポスター" });
    const t = { id: "fb-moved" };
    const other = { id: "fb-other" };
    const hidden = { id: "fb-hidden" };
    for (const [thread, w] of [
      [t, work],
      [other, work],
      [hidden, secret],
    ] as const)
      await notify(ctx, [stranger.userId], creator.userId, {
        kind: "feedback_posted",
        title: "新しい投稿",
        body: `「${w.title}」のスレッド`,
        workId: w.id,
        threadId: thread.id,
      });
    const migrated = await addMigrated(ctx, t.id, rev2.id);

    const list = await listMyNotifications(ctx, stranger);
    const find = (text: string) => list.find((n) => n.body.includes(text));
    const moved = list.find((n) => n.threadId === migrated.id)!;
    expect(moved).toMatchObject({ kind: "feedback_posted", revisionId: rev2.id, workId: work.id });
    const unmoved = list.find(
      (n) => n.kind === "feedback_posted" && !n.threadId && n.body.includes("EVE"),
    );
    expect(unmoved).toBeDefined();
    expect(unmoved).not.toHaveProperty("revisionId");
    expect(unmoved).not.toHaveProperty("workId");
    expect(find("極秘ポスター")).toBeDefined();
    expect(list.filter((n) => n.title === "閲覧できない制作物の通知です")).toHaveLength(0);
  });
});
