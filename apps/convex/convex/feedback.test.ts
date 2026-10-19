import { feedbackTemplate } from "@mf100/domain";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { createCast, createHarness, HOUR, uploadFeedbackVerified } from "../test/harness";
import { setupWork, submitFiles } from "../test/flows";

const code = (c: string) => expect.objectContaining({ data: expect.objectContaining({ code: c }) });

afterEach(() => {
  vi.useRealTimers();
});

describe("Convex 統合: 制作のフィードバック", () => {
  it("誰でもスレッドを立てて投稿でき、restricted の制作物は見られる人だけ", async () => {
    const t = createHarness();
    const cast = await createCast(t);
    const workId = await setupWork(t, cast, { title: "EVE 企画ポスター" });
    const threadId = await cast.creator.as.mutation(api.feedback.createThread, {
      workId,
      title: "配色の方向性",
      body: feedbackTemplate("creator_first").body,
      template: "creator_first",
    });
    // 制作物に関与していない委員も読めて投稿できる（通常の制作物はそのものも開ける。利用者決定 2026-10-17）
    const postId = await cast.stranger.as.mutation(api.feedback.post, {
      threadId,
      body: "夜の雰囲気が伝わります",
    });
    const view = await cast.stranger.as.query(api.feedback.getThread, { threadId });
    expect(view).toMatchObject({
      thread: { title: "配色の方向性", postCount: 2 },
      work: { id: workId, title: "EVE 企画ポスター", canOpen: true },
      can: { post: true, editOwn: true, rename: false },
    });
    expect(view!.posts.map((p) => [p.author.name, p.template ?? null])).toEqual([
      ["creator", "creator_first"],
      ["stranger", null],
    ]);
    expect(view!.posts[1]!.can).toEqual({ edit: true, delete: true });
    expect((await cast.creator.as.query(api.feedback.getThread, { threadId }))!.work.canOpen).toBe(
      true,
    );
    // 一覧と未読
    const [row] = await cast.creator.as.query(api.feedback.listThreads, {});
    expect(row).toMatchObject({
      id: threadId,
      workTitle: "EVE 企画ポスター",
      confidentiality: "normal",
      lastPost: { authorName: "stranger", excerpt: "夜の雰囲気が伝わります" },
      unread: true,
    });
    await cast.creator.as.mutation(api.feedback.markRead, { threadId });
    expect((await cast.creator.as.query(api.feedback.listThreads, { workId }))[0]!.unread).toBe(
      false,
    );
    // 編集・削除
    await expect(
      cast.creator.as.mutation(api.feedback.editPost, { postId, body: "x" }),
    ).rejects.toThrow(code("forbidden"));
    await cast.admin.as.mutation(api.feedback.deletePost, { postId });
    const after = await cast.creator.as.query(api.feedback.getThread, { threadId });
    expect(after!.posts.map((x) => x.id)).not.toContain(postId);
    expect(after!.posts).toHaveLength(1);
    expect(after!.thread.postCount).toBe(1);

    // restricted: 制作物を見られない人には無いのと同じ
    await cast.manager.as.mutation(api.works.update, {
      workId,
      patch: { confidentiality: "restricted" },
    });
    expect(await cast.stranger.as.query(api.feedback.getThread, { threadId })).toBeNull();
    expect(await cast.stranger.as.query(api.feedback.listThreads, {})).toEqual([]);
    await expect(
      cast.stranger.as.mutation(api.feedback.post, { threadId, body: "x" }),
    ).rejects.toThrow(code("feedback_not_found"));
    expect((await cast.reviewer.as.query(api.feedback.getThread, { threadId }))!.thread.id).toBe(
      threadId,
    );
    // 無い ID・形の違う ID も null
    expect(await cast.creator.as.query(api.feedback.getThread, { threadId: "nope" })).toBeNull();
  });

  it("メンションと通知・リアクション・題名の変更", async () => {
    const t = createHarness();
    const cast = await createCast(t);
    const workId = await setupWork(t, cast);
    const threadId = await cast.reviewer.as.mutation(api.feedback.createThread, {
      workId,
      title: "表紙",
      body: "相談です",
    });
    const candidates = await cast.reviewer.as.query(api.feedback.searchPeople, {
      workId,
      text: "",
    });
    expect(candidates.map((p) => p.name)).toEqual([
      "admin",
      "approver",
      "creator",
      "manager",
      "stranger",
    ]);
    expect(candidates[0]).toEqual({
      id: cast.admin.id,
      name: "admin",
      email: "admin@example.invalid",
    });
    expect(
      await cast.reviewer.as.query(api.feedback.searchPeople, { workId, text: "stran" }),
    ).toEqual([{ id: cast.stranger.id, name: "stranger", email: "stranger@example.invalid" }]);

    await cast.stranger.as.mutation(api.feedback.post, {
      threadId,
      body: "@creator ご確認を",
      mentions: [cast.creator.id],
    });
    const creatorNotes = await cast.creator.as.query(api.notifications.list, {});
    expect(creatorNotes.map((n) => n.kind)).toEqual(["feedback_mentioned", "feedback_posted"]);
    expect(creatorNotes[0]).toMatchObject({ workId, threadId });
    expect((await cast.reviewer.as.query(api.notifications.list, {})).map((n) => n.kind)).toEqual([
      "feedback_posted",
    ]);

    const view = await cast.creator.as.query(api.feedback.getThread, { threadId });
    const firstPost = view!.posts[0]!.id;
    expect(
      await cast.creator.as.mutation(api.feedback.toggleReaction, {
        postId: firstPost,
        emoji: "🙏",
      }),
    ).toEqual([{ emoji: "🙏", count: 1, mine: true }]);
    await expect(
      cast.creator.as.mutation(api.feedback.toggleReaction, { postId: firstPost, emoji: "x" }),
    ).rejects.toThrow(code("feedback_invalid"));
    await expect(
      cast.creator.as.mutation(api.feedback.renameThread, { threadId, title: "x" }),
    ).rejects.toThrow(code("forbidden"));
    await cast.reviewer.as.mutation(api.feedback.renameThread, { threadId, title: "表紙の写真" });
    expect((await cast.creator.as.query(api.feedback.getThread, { threadId }))!.thread.title).toBe(
      "表紙の写真",
    );
  });

  it("添付: 準備 → 検証 → 投稿に付ける → 認可付き配信。放置した添付は清掃の一覧に載る", async () => {
    vi.useFakeTimers();
    const t = createHarness();
    const cast = await createCast(t);
    const workId = await setupWork(t, cast);
    const [pdf, stale] = await cast.creator.as.mutation(api.feedback.prepareFiles, {
      workId,
      files: [
        { fileName: "案A.pdf", mimeType: "application/pdf", size: 10 },
        { fileName: "ポスター.ai", mimeType: "application/postscript", size: 20 },
      ],
    });
    // 転送はサービス境界（internal）からだけ。試行ごとのキーは添付の名前空間の下
    const target = await cast.creator.as.mutation(internal.feedback.beginFileUpload, {
      fileId: pdf!.fileId,
    });
    expect(target).toMatchObject({ declaredSize: 10, fileName: "案A.pdf" });
    expect(target.objectKey.startsWith(`feedback/${workId}/${pdf!.fileId}/`)).toBe(true);
    await expect(
      cast.reviewer.as.mutation(internal.feedback.beginFileUpload, { fileId: pdf!.fileId }),
    ).rejects.toThrow(code("feedback_not_found"));
    expect(
      await cast.creator.as.mutation(internal.feedback.completeFileUpload, {
        attemptId: target.attemptId,
        size: 10,
        sha256: "abc",
      }),
    ).toEqual({ status: "verified", failureMessage: null });
    // 申告と違うサイズ: 採用されず failed（試行は清掃の対象）
    const broken = await cast.creator.as.mutation(internal.feedback.beginFileUpload, {
      fileId: stale!.fileId,
    });
    expect(
      await cast.creator.as.mutation(internal.feedback.completeFileUpload, {
        attemptId: broken.attemptId,
        size: 19,
        sha256: "x",
      }),
    ).toMatchObject({ status: "failed" });
    await expect(
      cast.creator.as.mutation(api.feedback.createThread, {
        workId,
        title: "案",
        body: "",
        fileIds: [stale!.fileId],
      }),
    ).rejects.toThrow(code("feedback_file_not_ready"));
    const threadId = await cast.creator.as.mutation(api.feedback.createThread, {
      workId,
      title: "案",
      body: "",
      fileIds: [pdf!.fileId],
    });
    const view = await cast.stranger.as.query(api.feedback.getThread, { threadId });
    expect(view!.posts[0]!.files).toEqual([
      {
        id: pdf!.fileId,
        fileName: "案A.pdf",
        mimeType: "application/pdf",
        type: "pdf",
        size: 10,
        status: "verified",
      },
    ]);
    expect(
      await cast.stranger.as.query(api.feedback.authorizeFile, { fileId: pdf!.fileId }),
    ).toMatchObject({ objectKey: target.objectKey, fileName: "案A.pdf", size: 10 });
    await expect(
      cast.stranger.as.query(api.feedback.authorizeFile, { fileId: stale!.fileId }),
    ).rejects.toThrow(code("forbidden"));
    // 放置する添付も、送り直して検証まで済ませておく（投稿には付けない）
    await uploadFeedbackVerified(cast.creator, stale!.fileId, { size: 20, sha256: "def" });

    // 24 時間後: 投稿に付けなかった添付だけ放置扱い → 清掃の一覧に "feedback:" 付きで載る
    expect(await t.mutation(internal.feedback.expireFiles, {})).toBe(0);
    vi.setSystemTime(Date.now() + 25 * HOUR);
    expect(await t.mutation(internal.feedback.expireFiles, {})).toBe(1);
    const orphans = await t.mutation(internal.submissions.listOrphanObjects, {});
    // 放置した添付の採用済みの実体と、採用されなかった試行の実体
    expect(orphans).toEqual([
      { itemId: `feedback:${stale!.fileId}`, objectKey: expect.stringContaining("feedback/") },
      { itemId: `attempt:${broken.attemptId}`, objectKey: broken.objectKey },
    ]);
    expect(
      await t.mutation(internal.submissions.markObjectsPurged, {
        itemIds: orphans.map((o) => o.itemId),
      }),
    ).toBe(2);
    expect(await t.mutation(internal.submissions.listOrphanObjects, {})).toEqual([]);
  });

  it("A-4: 制作物ごとの集計はシステム管理者だけ。局で絞ると配下の担当の制作物が入る", async () => {
    const t = createHarness();
    const cast = await createCast(t);
    const pr = await cast.admin.as.mutation(api.teams.save, { name: "広報局", kind: "bureau" });
    const design = await cast.admin.as.mutation(api.teams.save, {
      name: "デザイン担当",
      kind: "team",
      parentId: pr,
    });
    const ga = await cast.admin.as.mutation(api.teams.save, { name: "総務局", kind: "bureau" });
    const workId = await setupWork(t, cast, { title: "パンフレット" });
    await cast.manager.as.mutation(api.works.update, {
      workId,
      patch: { ownerTeamId: design, productionTeamIds: [design] },
    });
    await setupWork(t, cast, { title: "未所属" });
    const { revisionId } = await submitFiles(cast, workId, [
      { fileName: "a.pdf", mimeType: "application/pdf", type: "pdf" },
    ]);
    await cast.reviewer.as.mutation(api.comments.post, {
      revisionId,
      body: "誤字",
      kind: "correction",
      severity: "minor",
    });
    await cast.creator.as.mutation(api.feedback.createThread, { workId, title: "x", body: "y" });

    await expect(cast.creator.as.query(api.admin.workStats, {})).rejects.toThrow(code("forbidden"));
    expect((await cast.admin.as.query(api.admin.workStats, {})).map((r) => r.title)).toEqual([
      "パンフレット",
      "未所属",
    ]);
    expect(await cast.admin.as.query(api.admin.workStats, { teamId: ga })).toEqual([]);
    const [row] = await cast.admin.as.query(api.admin.workStats, { teamId: pr });
    expect(row).toMatchObject({
      workId,
      ownerTeam: "広報局 › デザイン担当",
      revisionCount: 1,
      commentCount: 1,
      commentsPerRevision: "第1版 1",
      finalizedAt: null,
      feedbackThreadCount: 1,
      feedbackPostCount: 1,
    });
  });

  it("サンプルデータに 2 つのスレッドが入る（2 回目は増やさない）", async () => {
    const t = createHarness();
    await t.mutation(internal.seed.demo, {});
    await t.mutation(internal.seed.demo, {});
    const threads = await t.run((ctx) => ctx.db.query("feedbackThreads").collect());
    expect(threads.map((x) => x.title).sort()).toEqual(["表紙の写真の候補", "配色の方向性"].sort());
    const creatorId = await t.run(
      async (ctx) =>
        (await ctx.db
          .query("users")
          .withIndex("by_nogikuSubject", (q) => q.eq("nogikuSubject", "mock-nogiku-creator"))
          .unique())!._id,
    );
    const as = t.withIdentity({ subject: `${creatorId}|s` });
    const eve = threads.find((x) => x.title === "配色の方向性")!;
    const view = await as.query(api.feedback.getThread, {
      threadId: eve._id as Id<"feedbackThreads">,
    });
    expect(view!.posts.map((p) => p.template)).toEqual(["creator_first", "reviewer"]);
    expect(view!.posts[1]!.reactions).toMatchObject([{ emoji: "👍", count: 1, mine: true }]);
  });

  it("システム管理者は他人の投稿とスレッドを削除でき、削除したスレッドは一覧・開く画面から消え、監査に残る", async () => {
    const t = createHarness();
    const cast = await createCast(t);
    const workId = await setupWork(t, cast, { title: "EVE 企画ポスター" });
    const keep = await cast.creator.as.mutation(api.feedback.createThread, {
      workId,
      title: "残す",
      body: "a",
    });
    const gone = await cast.reviewer.as.mutation(api.feedback.createThread, {
      workId,
      title: "消す",
      body: "b",
    });
    const postId = await cast.stranger.as.mutation(api.feedback.post, {
      threadId: keep,
      body: "意見",
    });

    // サーバーが can.delete を返す（管理者だけ真）
    const asAdmin = await cast.admin.as.query(api.feedback.getThread, { threadId: keep });
    expect(asAdmin!.can.delete).toBe(true);
    expect(asAdmin!.posts[1]!.can.delete).toBe(true);
    expect(
      (await cast.creator.as.query(api.feedback.getThread, { threadId: keep }))!.can,
    ).toMatchObject({ delete: false });

    // 管理者でない人（立てた本人を含む）はスレッドを削除できない
    for (const who of [cast.reviewer, cast.creator, cast.manager, cast.stranger])
      await expect(who.as.mutation(api.feedback.deleteThread, { threadId: gone })).rejects.toThrow(
        code("forbidden"),
      );

    await cast.admin.as.mutation(api.feedback.deletePost, { postId });
    await cast.admin.as.mutation(api.feedback.deleteThread, { threadId: gone });

    expect(
      (await cast.creator.as.query(api.feedback.listThreads, { workId })).map((r) => r.id),
    ).toEqual([keep]);
    expect((await cast.admin.as.query(api.feedback.listThreads, {})).map((r) => r.id)).toEqual([
      keep,
    ]);
    for (const who of [cast.creator, cast.reviewer, cast.admin])
      expect(await who.as.query(api.feedback.getThread, { threadId: gone })).toBeNull();
    const spaces = await cast.creator.as.query(api.feedback.listSpaces, {});
    expect(spaces.find((s) => s.workId === workId)?.threads).toBe(1);

    const audits = await t.run((ctx) => ctx.db.query("auditEvents").collect());
    const del = audits.filter((a) => a.operation === "delete");
    expect(del.map((a) => a.entityType).sort()).toEqual(["feedbackPost", "feedbackThread"]);
    expect(del.every((a) => a.actorId === cast.admin.id)).toBe(true);
    expect(del.find((a) => a.entityType === "feedbackPost")?.before).toMatchObject({
      authorId: cast.stranger.id,
    });
    expect(del.find((a) => a.entityType === "feedbackThread")).toMatchObject({
      entityId: gone,
      before: { createdBy: cast.reviewer.id },
    });
  });
});
