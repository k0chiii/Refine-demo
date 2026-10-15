import { feedbackTemplate } from "@mf100/domain";
import { describe, expect, it } from "vite-plus/test";
import { grantWorkPermission } from "../usecases/acl.ts";
import { decideThread, postComment } from "../usecases/comments.ts";
import { finalizeWork } from "../usecases/approvals.ts";
import {
  authorizeFeedbackFile,
  createFeedbackThread,
  deleteFeedbackPost,
  editFeedbackPost,
  expireFeedbackFiles,
  exportWorkStats,
  feedbackFileForUpload,
  getFeedbackThread,
  listFeedbackMentionCandidates,
  listFeedbackThreads,
  listOrphanFeedbackObjects,
  markFeedbackFileFailed,
  markFeedbackFileVerified,
  markFeedbackObjectsPurged,
  markFeedbackRead,
  postFeedback,
  prepareFeedbackFiles,
  renameFeedbackThread,
  searchFeedbackPeople,
  toggleFeedbackReaction,
} from "../usecases/feedback.ts";
import { createInMemoryContext, type InMemoryContext } from "../testing/inMemory.ts";
import { HOUR, principals, seedWork, submitRevision } from "../testing/scenario.ts";

const code = (c: string) => expect.objectContaining({ code: c });
const { creator, reviewer, stranger, manager, sysadmin, approver } = principals;

async function setup() {
  const ctx = createInMemoryContext();
  for (const [p, name] of [
    [creator, "五月 めい"],
    [reviewer, "本郷 校正"],
    [stranger, "通りすがり"],
    [manager, "五月 主管"],
    [approver, "駒場 校了"],
  ] as const)
    ctx.state.names.set(p.userId, name);
  const work = await seedWork(ctx, { title: "EVE 企画ポスター" });
  return { ctx, work };
}

async function uploadVerified(ctx: InMemoryContext, workId: string, by = creator) {
  const [prepared] = await prepareFeedbackFiles(ctx, by, {
    workId,
    files: [{ fileName: "案A.pdf", mimeType: "application/pdf", size: 10 }],
  });
  await markFeedbackFileVerified(ctx, by, { fileId: prepared!.fileId, size: 10, sha256: "abc" });
  return prepared!.fileId;
}

describe("フィードバックのスレッドと投稿", () => {
  it("誰でもスレッドを立てて投稿でき、一覧は最後の投稿が新しい順・未読つき", async () => {
    const { ctx, work } = await setup();
    const t1 = await createFeedbackThread(ctx, creator, {
      workId: work.id,
      title: "  配色の方向性 ",
      body: feedbackTemplate("creator_first").body,
      template: "creator_first",
    });
    ctx.clock.advance(HOUR);
    const t2 = await createFeedbackThread(ctx, stranger, {
      workId: work.id,
      title: "書体",
      body: "見出しの書体について",
    });
    ctx.clock.advance(HOUR);
    await postFeedback(ctx, reviewer, {
      threadId: t1,
      body: "よく機能しています",
      template: "reviewer",
    });

    const list = await listFeedbackThreads(ctx, creator, {});
    expect(list.map((t) => t.id)).toEqual([t1, t2]);
    expect(list[0]).toMatchObject({
      title: "配色の方向性",
      workTitle: "EVE 企画ポスター",
      confidentiality: "normal",
      createdBy: { id: creator.userId, name: "五月 めい" },
      postCount: 2,
      lastPost: { authorName: "本郷 校正", excerpt: "よく機能しています" },
      unread: true,
    });
    await markFeedbackRead(ctx, creator, t1);
    expect((await listFeedbackThreads(ctx, creator, {}))[0]!.unread).toBe(false);
    // 自分の投稿では未読にならない
    expect((await listFeedbackThreads(ctx, reviewer, {})).find((t) => t.id === t1)!.unread).toBe(
      false,
    );
    expect((await listFeedbackThreads(ctx, stranger, { mine: true })).map((t) => t.id)).toEqual([
      t2,
    ]);
    expect((await listFeedbackThreads(ctx, stranger, { limit: 1 })).length).toBe(1);

    const view = await getFeedbackThread(ctx, stranger, t1);
    expect(view.thread.participants.map((p) => p.id)).toEqual([creator.userId, reviewer.userId]);
    expect(view.work).toMatchObject({ title: "EVE 企画ポスター", canOpen: false });
    expect(view.posts.map((p) => p.template)).toEqual(["creator_first", "reviewer"]);
    expect(view.can).toEqual({ post: true, editOwn: true, rename: false });
    expect((await getFeedbackThread(ctx, creator, t1)).work.canOpen).toBe(true);
  });

  it("restricted の制作物は、制作物を見られる人にしか見えない（一覧にも出ない）", async () => {
    const { ctx, work } = await setup();
    const secret = await seedWork(ctx, { title: "非公開", confidentiality: "restricted" });
    const t = await createFeedbackThread(ctx, creator, {
      workId: secret.id,
      title: "秘密",
      body: "相談",
    });
    await createFeedbackThread(ctx, creator, { workId: work.id, title: "公開", body: "相談" });
    expect((await listFeedbackThreads(ctx, stranger, {})).map((x) => x.title)).toEqual(["公開"]);
    await expect(getFeedbackThread(ctx, stranger, t)).rejects.toThrow(code("feedback_not_found"));
    await expect(getFeedbackThread(ctx, sysadmin, t)).rejects.toThrow(code("feedback_not_found"));
    await expect(postFeedback(ctx, stranger, { threadId: t, body: "x" })).rejects.toThrow(
      code("feedback_not_found"),
    );
    await expect(
      createFeedbackThread(ctx, stranger, { workId: secret.id, title: "x", body: "x" }),
    ).rejects.toThrow(code("forbidden"));
    await expect(listFeedbackThreads(ctx, stranger, { workId: secret.id })).rejects.toThrow(
      code("forbidden"),
    );
    await grantWorkPermission(ctx, sysadmin, {
      workId: secret.id,
      principalType: "user",
      principalId: reviewer.userId,
      permission: "view",
    });
    expect((await getFeedbackThread(ctx, reviewer, t)).thread.title).toBe("秘密");
  });

  it("訂正は本人だけ、削除は本人かシステム管理者。削除した投稿は「削除された投稿」として残る", async () => {
    const { ctx, work } = await setup();
    const t = await createFeedbackThread(ctx, creator, {
      workId: work.id,
      title: "配色",
      body: "a",
    });
    const p = await postFeedback(ctx, reviewer, { threadId: t, body: "誤字" });
    await expect(editFeedbackPost(ctx, creator, { postId: p, body: "x" })).rejects.toThrow(
      code("forbidden"),
    );
    ctx.clock.advance(1000);
    await editFeedbackPost(ctx, reviewer, { postId: p, body: "訂正しました" });
    let view = await getFeedbackThread(ctx, reviewer, t);
    expect(view.posts[1]).toMatchObject({
      body: "訂正しました",
      can: { edit: true, delete: true },
    });
    expect(view.posts[1]!.editedAt).toBe(ctx.clock.now());
    await expect(deleteFeedbackPost(ctx, stranger, { postId: p })).rejects.toThrow(
      code("forbidden"),
    );
    await deleteFeedbackPost(ctx, sysadmin, { postId: p });
    view = await getFeedbackThread(ctx, reviewer, t);
    expect(view.posts[1]).toMatchObject({
      body: "削除された投稿",
      deleted: true,
      files: [],
      can: { edit: false, delete: false },
    });
    expect(view.thread.postCount).toBe(1);
    expect(ctx.state.audit.some((a) => a.entityType === "feedbackPost")).toBe(true);
    await expect(toggleFeedbackReaction(ctx, creator, { postId: p, emoji: "👍" })).rejects.toThrow(
      code("feedback_not_found"),
    );
  });

  it("リアクション・題名の変更・本文の検査", async () => {
    const { ctx, work } = await setup();
    const t = await createFeedbackThread(ctx, creator, {
      workId: work.id,
      title: "配色",
      body: "a",
    });
    const [first] = (await getFeedbackThread(ctx, creator, t)).posts;
    expect(await toggleFeedbackReaction(ctx, reviewer, { postId: first!.id, emoji: "👍" })).toEqual(
      [{ emoji: "👍", count: 1, mine: true }],
    );
    await toggleFeedbackReaction(ctx, stranger, { postId: first!.id, emoji: "👍" });
    expect((await getFeedbackThread(ctx, creator, t)).posts[0]!.reactions).toEqual([
      { emoji: "👍", count: 2, mine: false },
    ]);
    await expect(
      toggleFeedbackReaction(ctx, creator, { postId: first!.id, emoji: "🤔" }),
    ).rejects.toThrow(code("feedback_invalid"));
    await expect(renameFeedbackThread(ctx, stranger, { threadId: t, title: "x" })).rejects.toThrow(
      code("forbidden"),
    );
    await renameFeedbackThread(ctx, creator, { threadId: t, title: "配色の方向性" });
    expect((await getFeedbackThread(ctx, creator, t)).thread.title).toBe("配色の方向性");
    await expect(postFeedback(ctx, creator, { threadId: t, body: "  " })).rejects.toThrow(
      code("feedback_invalid"),
    );
    await expect(
      createFeedbackThread(ctx, creator, { workId: work.id, title: "", body: "a" }),
    ).rejects.toThrow(code("feedback_invalid"));
  });
});

describe("メンションと通知", () => {
  it("参加者と制作者に「新しい投稿」、メンションされた人には「メンション」だけ。本人には送らない", async () => {
    const { ctx, work } = await setup();
    const t = await createFeedbackThread(ctx, reviewer, {
      workId: work.id,
      title: "配色",
      body: "相談です",
    });
    const forCreator = ctx.state.notifications
      .all()
      .filter((n) => n.recipientId === creator.userId);
    expect(forCreator).toEqual([
      expect.objectContaining({
        kind: "feedback_posted",
        title: "新しいフィードバック",
        body: "「EVE 企画ポスター」のスレッド「配色」・本郷 校正さん: 相談です",
        workId: work.id,
        threadId: t,
      }),
    ]);
    await postFeedback(ctx, stranger, {
      threadId: t,
      body: "@五月 めい ご確認を",
      mentions: [creator.userId, manager.userId],
    });
    const kinds = (userId: string) =>
      ctx.state.notifications
        .all()
        .filter((n) => n.recipientId === userId)
        .map((n) => n.kind);
    expect(kinds(creator.userId)).toEqual(["feedback_posted", "feedback_mentioned"]);
    expect(kinds(reviewer.userId)).toEqual(["feedback_posted"]);
    expect(kinds(manager.userId)).toEqual(["feedback_mentioned"]);
    expect(kinds(stranger.userId)).toEqual([]);
    await expect(
      postFeedback(ctx, stranger, { threadId: t, body: "x", mentions: ["u_unknown"] }),
    ).rejects.toThrow(code("mention_not_allowed"));
    await expect(
      postFeedback(ctx, stranger, {
        threadId: t,
        body: "x",
        mentions: Array.from({ length: 11 }, (_, i) => `u${i}`),
      }),
    ).rejects.toThrow(code("mention_too_many"));
  });

  it("メンションの候補: 通常は委員全員、restricted は制作物を見られる人。自分は除く", async () => {
    const { ctx, work } = await setup();
    expect(
      (await listFeedbackMentionCandidates(ctx, stranger, work.id)).map((p) => p.id).sort(),
    ).toEqual([creator, reviewer, manager, approver].map((p) => p.userId).sort());
    expect(await searchFeedbackPeople(ctx, stranger, { workId: work.id, text: "本郷" })).toEqual([
      { id: reviewer.userId, name: "本郷 校正" },
    ]);
    const secret = await seedWork(ctx, { title: "非公開", confidentiality: "restricted" });
    expect(
      (await listFeedbackMentionCandidates(ctx, creator, secret.id)).map((p) => p.id).sort(),
    ).toEqual([manager, approver].map((p) => p.userId).sort());
    const t = await createFeedbackThread(ctx, creator, {
      workId: secret.id,
      title: "x",
      body: "y",
    });
    await expect(
      postFeedback(ctx, creator, { threadId: t, body: "x", mentions: [reviewer.userId] }),
    ).rejects.toThrow(code("mention_not_allowed"));
  });
});

describe("添付", () => {
  it("準備 → 検証 → 投稿に付ける。付けられるのは本人の検証済み・未使用の添付だけ", async () => {
    const { ctx, work } = await setup();
    const prepared = await prepareFeedbackFiles(ctx, creator, {
      workId: work.id,
      files: [
        { fileName: "案A.pdf", mimeType: "application/pdf", size: 10 },
        { fileName: "ポスター.ai", mimeType: "application/postscript", size: 20 },
      ],
    });
    const [pdf, ai] = prepared.map((p) => p.fileId) as [string, string];
    const target = await feedbackFileForUpload(ctx, creator, pdf);
    expect(target).toMatchObject({
      declaredSize: 10,
      fileName: "案A.pdf",
      mimeType: "application/pdf",
    });
    expect(target.objectKey).toBe(`feedback/${work.id}/${pdf}/案A.pdf`);
    await expect(feedbackFileForUpload(ctx, reviewer, pdf)).rejects.toThrow(
      code("feedback_not_found"),
    );
    // 申告サイズと違えば failed
    expect(
      await markFeedbackFileVerified(ctx, creator, { fileId: ai, size: 19, sha256: "x" }),
    ).toMatchObject({
      status: "failed",
    });
    await markFeedbackFileFailed(ctx, creator, { fileId: ai, message: "破損" });
    await expect(
      createFeedbackThread(ctx, creator, { workId: work.id, title: "案", body: "", fileIds: [ai] }),
    ).rejects.toThrow(code("feedback_file_not_ready"));
    expect(
      await markFeedbackFileVerified(ctx, creator, { fileId: pdf, size: 10, sha256: "x" }),
    ).toEqual({
      status: "verified",
      failureMessage: null,
    });
    await expect(feedbackFileForUpload(ctx, creator, pdf)).rejects.toThrow(
      code("feedback_invalid"),
    );
    // 投稿前は本人だけが読める
    await authorizeFeedbackFile(ctx, creator, pdf);
    await expect(authorizeFeedbackFile(ctx, reviewer, pdf)).rejects.toThrow(code("forbidden"));
    // 他人の添付は付けられない
    await expect(
      createFeedbackThread(ctx, reviewer, {
        workId: work.id,
        title: "案",
        body: "",
        fileIds: [pdf],
      }),
    ).rejects.toThrow(code("feedback_file_not_ready"));
    const t = await createFeedbackThread(ctx, creator, {
      workId: work.id,
      title: "案",
      body: "",
      fileIds: [pdf],
    });
    const view = await getFeedbackThread(ctx, stranger, t);
    expect(view.posts[0]!.files).toEqual([
      {
        id: pdf,
        fileName: "案A.pdf",
        mimeType: "application/pdf",
        type: "pdf",
        size: 10,
        status: "verified",
      },
    ]);
    expect(await authorizeFeedbackFile(ctx, stranger, pdf)).toMatchObject({ fileName: "案A.pdf" });
    // 同じ添付を 2 回は付けられない
    await expect(
      postFeedback(ctx, creator, { threadId: t, body: "再掲", fileIds: [pdf] }),
    ).rejects.toThrow(code("feedback_file_not_ready"));
    // 投稿を消すと誰も読めない
    await deleteFeedbackPost(ctx, creator, { postId: view.posts[0]!.id });
    await expect(authorizeFeedbackFile(ctx, creator, pdf)).rejects.toThrow(code("forbidden"));
  });

  it("restricted の制作物の添付は、制作物を見られない人には読めない", async () => {
    const { ctx } = await setup();
    const secret = await seedWork(ctx, { title: "非公開", confidentiality: "restricted" });
    const fileId = await uploadVerified(ctx, secret.id);
    await createFeedbackThread(ctx, creator, {
      workId: secret.id,
      title: "x",
      body: "",
      fileIds: [fileId],
    });
    await authorizeFeedbackFile(ctx, approver, fileId);
    await expect(authorizeFeedbackFile(ctx, stranger, fileId)).rejects.toThrow(code("forbidden"));
    await expect(
      prepareFeedbackFiles(ctx, stranger, {
        workId: secret.id,
        files: [{ fileName: "a.png", mimeType: "image/png", size: 1 }],
      }),
    ).rejects.toThrow(code("forbidden"));
  });

  it("投稿に付けないまま 24 時間たった添付は清掃の対象（付けた添付は対象外）", async () => {
    const { ctx, work } = await setup();
    const used = await uploadVerified(ctx, work.id);
    const stale = await uploadVerified(ctx, work.id);
    await createFeedbackThread(ctx, creator, {
      workId: work.id,
      title: "x",
      body: "",
      fileIds: [used],
    });
    expect(await expireFeedbackFiles(ctx)).toEqual([]);
    ctx.clock.advance(24 * HOUR);
    expect(await expireFeedbackFiles(ctx)).toEqual([stale]);
    const orphans = await listOrphanFeedbackObjects(ctx);
    expect(orphans).toEqual([
      { itemId: `feedback:${stale}`, objectKey: `feedback/${work.id}/${stale}/案A.pdf` },
    ]);
    // 放置扱いの添付はもう付けられない
    await expect(
      postFeedback(ctx, creator, {
        threadId: (await listFeedbackThreads(ctx, creator))[0]!.id,
        body: "",
        fileIds: [stale],
      }),
    ).rejects.toThrow(code("feedback_file_not_ready"));
    expect(await markFeedbackObjectsPurged(ctx, [stale, used, stale])).toBe(1);
    expect(await listOrphanFeedbackObjects(ctx)).toEqual([]);
  });
});

describe("制作物ごとの集計（A-4）", () => {
  it("システム管理者だけ。局で絞ると配下の担当の制作物も入る", async () => {
    const { ctx, work } = await setup();
    const pr = await ctx.teams.insert({
      name: "広報局",
      kind: "bureau",
      order: 1,
      updatedAt: 0,
      updatedBy: "a",
    });
    const design = await ctx.teams.insert({
      name: "デザイン担当",
      kind: "team",
      parentId: pr.id,
      order: 1,
      updatedAt: 0,
      updatedBy: "a",
    });
    const ga = await ctx.teams.insert({
      name: "総務局",
      kind: "bureau",
      order: 2,
      updatedAt: 0,
      updatedBy: "a",
    });
    const designed = await seedWork(ctx, {
      title: "パンフレット",
      ownerTeamId: design.id,
      productionTeamIds: [design.id],
    });
    const revision = await submitRevision(ctx, designed.id);
    await grantWorkPermission(ctx, sysadmin, {
      workId: designed.id,
      principalType: "user",
      principalId: reviewer.userId,
      permission: "review",
    });
    const c = await postComment(ctx, reviewer, {
      revisionId: revision.id,
      body: "誤字",
      kind: "correction",
      severity: "minor",
    });
    await decideThread(ctx, creator, { threadId: c.id, action: "rejected", reason: "意図どおり" });
    ctx.clock.advance(48 * HOUR);
    await finalizeWork(ctx, approver, { workId: designed.id, revisionId: revision.id });
    await createFeedbackThread(ctx, creator, { workId: designed.id, title: "x", body: "y" });

    await expect(exportWorkStats(ctx, creator, {})).rejects.toThrow(code("forbidden"));
    await expect(exportWorkStats(ctx, sysadmin, { teamId: "nope" })).rejects.toThrow(
      code("team_not_found"),
    );
    expect((await exportWorkStats(ctx, sysadmin, {})).map((r) => r.title)).toEqual([
      "EVE 企画ポスター",
      "パンフレット",
    ]);
    expect(await exportWorkStats(ctx, sysadmin, { teamId: ga.id })).toEqual([]);
    const [row] = await exportWorkStats(ctx, sysadmin, { teamId: pr.id });
    expect(row).toMatchObject({
      workId: designed.id,
      ownerTeam: "広報局 › デザイン担当",
      productionTeams: "広報局 › デザイン担当",
      lifecycle: "finalized",
      revisionCount: 1,
      firstSubmittedAt: revision.submittedAt,
      daysToFinalize: 2,
      commentCount: 1,
      commentsPerRevision: "第1版 1",
      rejectedCount: 1,
      decisionReasons: "意図どおり",
      feedbackThreadCount: 1,
      feedbackPostCount: 1,
    });
    void work;
  });
});
