import { describe, expect, it } from "vite-plus/test";
import { grantWorkPermission } from "../usecases/acl.ts";
import {
  decideThread,
  listMentionCandidates,
  postComment,
  replyToThread,
} from "../usecases/comments.ts";
import { assignReviewers, closeExpiredReviews, completeMyReview } from "../usecases/reviews.ts";
import { createInMemoryContext } from "../testing/inMemory.ts";
import { HOUR, principals, seedWork, submitRevision } from "../testing/scenario.ts";

const code = (c: string) => expect.objectContaining({ code: c });

async function setup() {
  const ctx = createInMemoryContext();
  const work = await seedWork(ctx);
  const revision = await submitRevision(ctx, work.id, { deadlineInHours: 24 });
  await grantWorkPermission(ctx, principals.sysadmin, {
    workId: work.id,
    principalType: "user",
    principalId: principals.reviewer.userId,
    permission: "review",
  });
  await assignReviewers(ctx, principals.manager, {
    revisionId: revision.id,
    reviewerIds: [principals.reviewer.userId],
    reviewType: "general",
  });
  return { ctx, work, revision };
}

describe("指摘の投稿（A-04, A-05, A-06）", () => {
  it("A-04: 期限の1秒前は成功、ちょうど・1秒後はサーバーで拒否", async () => {
    const { ctx, revision } = await setup();
    const post = () =>
      postComment(ctx, principals.reviewer, {
        revisionId: revision.id,
        body: "誤字",
        kind: "correction",
        severity: "minor",
      });
    ctx.clock.current = revision.deadlineAt - 1000;
    await expect(post()).resolves.toBeTruthy();
    ctx.clock.current = revision.deadlineAt;
    await expect(post()).rejects.toThrow(code("revision_deadline_passed"));
    ctx.clock.current = revision.deadlineAt + 1000;
    await expect(post()).rejects.toThrow(code("revision_deadline_passed"));
  });

  it("A-05: 期限到来ジョブは受付だけを閉じ、未読・指摘・校了状態は変えない", async () => {
    const { ctx, work, revision } = await setup();
    const thread = await postComment(ctx, principals.reviewer, {
      revisionId: revision.id,
      body: "要修正",
      kind: "correction",
      severity: "major",
    });
    ctx.clock.current = revision.deadlineAt;
    const closed = await closeExpiredReviews(ctx);
    expect(closed.map((r) => r.id)).toEqual([revision.id]);
    expect((await ctx.revisions.findById(revision.id))?.reviewClosedReason).toBe("deadline");
    expect((await ctx.assignments.find(revision.id, principals.reviewer.userId))?.state).toBe(
      "viewed",
    ); // 投稿で viewed にはなるが responded にはならない
    expect((await ctx.threads.findById(thread.id))?.resolution).toBe("open");
    expect((await ctx.works.findById(work.id))?.lifecycle).toBe("active");
    // 二度目の実行は何も閉じない（冪等）
    expect(await closeExpiredReviews(ctx)).toEqual([]);
  });

  it("A-06: コメント投稿だけでは確認済み・解決済み・校了に遷移しない。明示操作で確認済みになる", async () => {
    const { ctx, work, revision } = await setup();
    await postComment(ctx, principals.reviewer, {
      revisionId: revision.id,
      body: "確認",
      kind: "question",
      severity: "info",
    });
    expect((await ctx.assignments.find(revision.id, principals.reviewer.userId))?.state).toBe(
      "viewed",
    );
    expect((await ctx.works.findById(work.id))?.lifecycle).toBe("active");
    const a = await completeMyReview(ctx, principals.reviewer, revision.id);
    expect(a.state).toBe("responded");
  });

  it("view 権限のみのユーザーと無関係者は投稿できない", async () => {
    const { ctx, work, revision } = await setup();
    await grantWorkPermission(ctx, principals.sysadmin, {
      workId: work.id,
      principalType: "user",
      principalId: "u_viewer",
      permission: "view",
    });
    const viewer = {
      userId: "u_viewer",
      isSystemAdmin: false,
      groupIds: [],
      orgPermissions: ["*"],
    };
    await expect(
      postComment(ctx, viewer, {
        revisionId: revision.id,
        body: "x",
        kind: "question",
        severity: "info",
      }),
    ).rejects.toThrow(code("forbidden"));
    await expect(
      postComment(ctx, principals.stranger, {
        revisionId: revision.id,
        body: "x",
        kind: "question",
        severity: "info",
      }),
    ).rejects.toThrow(code("forbidden"));
  });

  it("アンカーは対象版のファイルを指していなければならない", async () => {
    const { ctx, revision } = await setup();
    await expect(
      postComment(ctx, principals.reviewer, {
        revisionId: revision.id,
        body: "x",
        kind: "correction",
        severity: "minor",
        anchor: {
          type: "pdf_rect",
          artifactId: "art_999",
          page: 1,
          rect: { x: 0.1, y: 0.1, w: 0.2, h: 0.2 },
        },
      }),
    ).rejects.toThrow(code("anchor_artifact_mismatch"));
    const [artifact] = await ctx.artifacts.listByRevision(revision.id);
    const t = await postComment(ctx, principals.reviewer, {
      revisionId: revision.id,
      body: "x",
      kind: "correction",
      severity: "minor",
      anchor: {
        type: "pdf_rect",
        artifactId: artifact!.id,
        page: 1,
        rect: { x: 0.1, y: 0.1, w: 0.2, h: 0.2 },
      },
    });
    expect(t.artifactId).toBe(artifact!.id);
  });

  it("動画の位置（時点・範囲・画面の矩形）を付けられ、壊れた時刻は拒否する", async () => {
    const { ctx, revision } = await setup();
    const [artifact] = await ctx.artifacts.listByRevision(revision.id);
    const t = await postComment(ctx, principals.reviewer, {
      revisionId: revision.id,
      body: "テロップの表記",
      kind: "correction",
      severity: "minor",
      anchor: {
        type: "video_time",
        artifactId: artifact!.id,
        start: 3.2,
        end: 6,
        rect: { x: 0.1, y: 0.7, w: 0.8, h: 0.2 },
      },
    });
    expect(t.anchor).toMatchObject({ type: "video_time", start: 3.2, end: 6 });
    await expect(
      postComment(ctx, principals.reviewer, {
        revisionId: revision.id,
        body: "x",
        kind: "correction",
        severity: "minor",
        anchor: { type: "video_time", artifactId: artifact!.id, start: 6, end: 3 },
      }),
    ).rejects.toThrow(code("anchor_invalid"));
  });

  it("A-10: 同じ requestId の投稿再送は二重投稿にならない", async () => {
    const { ctx, revision } = await setup();
    const a = await postComment(ctx, principals.reviewer, {
      revisionId: revision.id,
      body: "x",
      kind: "correction",
      severity: "minor",
      requestId: "r1",
    });
    const b = await postComment(ctx, principals.reviewer, {
      revisionId: revision.id,
      body: "x",
      kind: "correction",
      severity: "minor",
      requestId: "r1",
    });
    expect(b.id).toBe(a.id);
    expect((await ctx.threads.listByRevision(revision.id)).length).toBe(1);
  });
});

describe("採否判断（A-07, D5）", () => {
  it("A-07: 不採用には理由・判断者・日時・元コメントが残る", async () => {
    const { ctx, revision } = await setup();
    const thread = await postComment(ctx, principals.reviewer, {
      revisionId: revision.id,
      body: "色を変えて",
      kind: "correction",
      severity: "minor",
    });
    ctx.clock.advance(HOUR);
    const decided = await decideThread(ctx, principals.creator, {
      threadId: thread.id,
      action: "rejected",
      reason: "ブランドガイドに従うため",
    });
    expect(decided.resolution).toBe("rejected");
    expect(decided.body).toBe("色を変えて"); // 原文は不変
    const events = await ctx.threads.listEvents(thread.id);
    expect(events.at(-1)).toMatchObject({
      eventType: "decided",
      actorId: principals.creator.userId,
      reason: "ブランドガイドに従うため",
      createdAt: ctx.clock.now(),
    });
  });
  it("校正者は採否を決められない", async () => {
    const { ctx, revision } = await setup();
    const thread = await postComment(ctx, principals.reviewer, {
      revisionId: revision.id,
      body: "x",
      kind: "correction",
      severity: "minor",
    });
    await expect(
      decideThread(ctx, principals.reviewer, { threadId: thread.id, action: "accepted" }),
    ).rejects.toThrow(code("forbidden"));
  });
  it("受付終了後も制作者の処置記録は可能。校正者の返信は不可（D5 暫定）", async () => {
    const { ctx, revision } = await setup();
    const thread = await postComment(ctx, principals.reviewer, {
      revisionId: revision.id,
      body: "x",
      kind: "correction",
      severity: "minor",
    });
    ctx.clock.current = revision.deadlineAt + 1;
    await closeExpiredReviews(ctx);
    await expect(
      decideThread(ctx, principals.creator, { threadId: thread.id, action: "accepted" }),
    ).resolves.toMatchObject({ resolution: "accepted" });
    await expect(
      replyToThread(ctx, principals.creator, { threadId: thread.id, body: "次版で反映" }),
    ).resolves.toBeUndefined();
    await expect(
      replyToThread(ctx, principals.reviewer, { threadId: thread.id, body: "追加で" }),
    ).rejects.toThrow(code("comment_reply_not_allowed"));
  });
});

describe("メンション", () => {
  /** コメント（threadId つき）の通知だけを見る */
  const kinds = (ctx: Awaited<ReturnType<typeof setup>>["ctx"], userId: string) =>
    ctx.state.notifications
      .all()
      .filter((n) => n.recipientId === userId && n.threadId)
      .map((n) => n.kind);

  it("見られる人だけをメンションでき、メンションされた人に通知が届く（制作者は重ねて通知しない）", async () => {
    const { ctx, work, revision } = await setup();
    expect((await listMentionCandidates(ctx, principals.reviewer, work.id)).sort()).toEqual(
      [
        principals.approver.userId,
        principals.creator.userId,
        principals.manager.userId,
        principals.reviewer.userId,
      ].sort(),
    );
    await expect(listMentionCandidates(ctx, principals.stranger, work.id)).rejects.toThrow(
      code("forbidden"),
    );

    const thread = await postComment(ctx, principals.reviewer, {
      revisionId: revision.id,
      body: "@五月 めい ここ確認お願いします",
      kind: "correction",
      severity: "major",
      mentions: [principals.creator.userId, principals.approver.userId],
    });
    expect(thread.mentions).toEqual([principals.creator.userId, principals.approver.userId]);
    expect(kinds(ctx, principals.creator.userId)).toEqual(["mentioned"]);
    expect(kinds(ctx, principals.approver.userId)).toEqual(["mentioned"]);

    await expect(
      postComment(ctx, principals.reviewer, {
        revisionId: revision.id,
        body: "x",
        kind: "correction",
        severity: "minor",
        mentions: [principals.stranger.userId],
      }),
    ).rejects.toThrow(code("mention_not_allowed"));

    // 返信でのメンション（自分自身は通知しない）
    await replyToThread(ctx, principals.creator, {
      threadId: thread.id,
      body: "@本郷 校正 直しました",
      mentions: [principals.reviewer.userId, principals.creator.userId],
    });
    expect(kinds(ctx, principals.reviewer.userId)).toContain("mentioned");
    expect(kinds(ctx, principals.creator.userId)).toEqual(["mentioned"]);
    const replied = (await ctx.threads.listEvents(thread.id)).find(
      (e) => e.eventType === "replied",
    );
    expect(replied?.payload).toMatchObject({
      mentions: [principals.reviewer.userId, principals.creator.userId],
    });
    await expect(
      replyToThread(ctx, principals.creator, { threadId: thread.id, body: "  " }),
    ).rejects.toThrow(code("forbidden"));
  });

  it("同じ箇所に複数の人がそれぞれ指摘を立てられる", async () => {
    const { ctx, revision } = await setup();
    await grantWorkPermission(ctx, principals.sysadmin, {
      workId: revision.workId,
      principalType: "user",
      principalId: principals.manager.userId,
      permission: "review",
    });
    const at = { revisionId: revision.id, kind: "correction" as const, severity: "minor" as const };
    const a = await postComment(ctx, principals.reviewer, { ...at, body: "表記が違う" });
    const b = await postComment(ctx, principals.manager, { ...at, body: "私もそう思う" });
    expect(a.id).not.toBe(b.id);
  });
});
