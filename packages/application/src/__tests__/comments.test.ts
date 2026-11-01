import { byteLength, emptyPost, postManifest } from "@mf100/domain";
import { describe, expect, it } from "vite-plus/test";
import { grantWorkPermission } from "../usecases/acl.ts";
import {
  decideThread,
  editThread,
  postComment,
  replyToThread,
  searchMentionCandidates,
} from "../usecases/comments.ts";
import { closeExpiredReviews, completeMyReview, markRevisionViewed } from "../usecases/reviews.ts";
import { setWorkReviewers } from "../usecases/reviewers.ts";
import { confirmSubmission, prepareSubmission } from "../usecases/submissions.ts";
import { createInMemoryContext } from "../testing/inMemory.ts";
import {
  HOUR,
  principals,
  seedWork,
  submitRevision,
  uploadVerifiedItem,
} from "../testing/scenario.ts";

const code = (c: string) => expect.objectContaining({ code: c });

async function setup() {
  const ctx = createInMemoryContext();
  // 非公開の制作物（通常の制作物は委員の誰でも見られるので、閲覧権限の境目はこちらで確かめる）
  const work = await seedWork(ctx);
  const revision = await submitRevision(ctx, work.id, { deadlineInHours: 24 });
  await grantWorkPermission(ctx, principals.sysadmin, {
    workId: work.id,
    userIds: [principals.reviewer.userId],
    permission: "review",
  });
  await setWorkReviewers(ctx, principals.manager, {
    workId: revision.workId,
    reviewerIds: [principals.reviewer.userId],
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

  it("校正完了は読了印: 二度押しても完了時刻は最初のまま。その後に閲覧しても戻らない", async () => {
    const { ctx, revision } = await setup();
    ctx.clock.current = revision.deadlineAt - 5 * HOUR;
    const first = await completeMyReview(ctx, principals.reviewer, revision.id);
    ctx.clock.current = revision.deadlineAt - HOUR;
    const again = await completeMyReview(ctx, principals.reviewer, revision.id);
    expect(again.respondedAt).toBe(first.respondedAt);
    await markRevisionViewed(ctx, principals.reviewer, revision.id);
    const stored = await ctx.assignments.find(revision.id, principals.reviewer.userId);
    expect(stored).toMatchObject({ state: "responded", respondedAt: first.respondedAt });
  });

  it("割当のない人は校正完了にできない", async () => {
    const { ctx, revision } = await setup();
    await expect(completeMyReview(ctx, principals.creator, revision.id)).rejects.toThrow(
      code("forbidden"),
    );
  });

  it("見られる人は ACL が review 未満でも新しいコメントを投稿できる（利用者決定 2026-10-19）。委員なら誰でも（105A）", async () => {
    const { ctx, work, revision } = await setup();
    ctx.state.members.add("u_viewer");
    await grantWorkPermission(ctx, principals.sysadmin, {
      workId: work.id,
      userIds: ["u_viewer"],
      permission: "review",
    });
    const viewer = {
      userId: "u_viewer",
      isSystemAdmin: false,
      groupIds: [],
      orgPermissions: ["*"],
    };
    const input = {
      revisionId: revision.id,
      body: "x",
      kind: "question",
      severity: "info",
    } as const;
    const thread = await postComment(ctx, viewer, input);
    expect(thread.authorId).toBe(viewer.userId);
    // 本文の訂正は投稿者だけ
    await expect(
      editThread(ctx, principals.reviewer, { threadId: thread.id, body: "y" }),
    ).rejects.toThrow(code("comment_edit_not_author"));
    await expect(editThread(ctx, viewer, { threadId: thread.id, body: "y" })).resolves.toBeTruthy();
    await expect(postComment(ctx, principals.stranger, input)).resolves.toMatchObject({
      authorId: principals.stranger.userId,
    });
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
  it("受付終了後も制作者の処置記録と返信は可能。校正者も返信できる（利用者決定 2026-10-18）", async () => {
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
    ).resolves.toBeUndefined();
  });
  it("返信は委員なら誰でもできる（105A）", async () => {
    const { ctx, revision } = await setup();
    const thread = await postComment(ctx, principals.reviewer, {
      revisionId: revision.id,
      body: "x",
      kind: "question",
      severity: "info",
    });
    await expect(
      replyToThread(ctx, principals.stranger, { threadId: thread.id, body: "y" }),
    ).resolves.toBeUndefined();
  });
});

describe("メンション", () => {
  /** コメント（threadId つき）の通知だけを見る */
  const kinds = (ctx: Awaited<ReturnType<typeof setup>>["ctx"], userId: string) =>
    ctx.state.notifications
      .all()
      .filter((n) => n.recipientId === userId && n.threadId)
      .map((n) => n.kind);

  it("委員全員をメンション候補にでき、メンションされた人に通知が届く（105A）", async () => {
    const { ctx, work, revision } = await setup();
    const ids = (
      await searchMentionCandidates(ctx, principals.reviewer, { workId: work.id, text: "" })
    ).map((p) => p.id);
    expect(ids).toContain(principals.stranger.userId);
    const strangerCandidates = await searchMentionCandidates(ctx, principals.stranger, {
      workId: work.id,
      text: "",
    });
    expect(strangerCandidates.map((p) => p.id)).toContain(principals.creator.userId);

    const thread = await postComment(ctx, principals.reviewer, {
      revisionId: revision.id,
      body: "@五月 めい ここ確認お願いします",
      kind: "correction",
      severity: "major",
      mentions: [principals.creator.userId, principals.approver.userId],
    });
    expect(thread.mentions).toEqual([principals.creator.userId, principals.approver.userId]);
    expect(kinds(ctx, principals.creator.userId)).toContain("mentioned");
    expect(kinds(ctx, principals.approver.userId)).toContain("mentioned");

    await expect(
      postComment(ctx, principals.reviewer, {
        revisionId: revision.id,
        body: "x",
        kind: "correction",
        severity: "minor",
        mentions: [principals.stranger.userId],
      }),
    ).resolves.toMatchObject({ mentions: [principals.stranger.userId] });

    // 返信でのメンション（自分自身は通知しない）
    await replyToThread(ctx, principals.creator, {
      threadId: thread.id,
      body: "@本郷 校正 直しました",
      mentions: [principals.reviewer.userId, principals.creator.userId],
    });
    expect(kinds(ctx, principals.reviewer.userId)).toContain("mentioned");
    expect(kinds(ctx, principals.creator.userId)).toContain("mentioned");
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
      userIds: [principals.manager.userId],
      permission: "review",
    });
    const at = { revisionId: revision.id, kind: "correction" as const, severity: "minor" as const };
    const a = await postComment(ctx, principals.reviewer, { ...at, body: "表記が違う" });
    const b = await postComment(ctx, principals.manager, { ...at, body: "私もそう思う" });
    expect(a.id).not.toBe(b.id);
  });
});

describe("本文の書式（markdown。書式なしは旧来の平文）", () => {
  const at = { kind: "correction" as const, severity: "minor" as const };
  const repliedEvents = async (ctx: Awaited<ReturnType<typeof setup>>["ctx"], threadId: string) =>
    (await ctx.threads.listEvents(threadId)).filter((e) => e.eventType === "replied");

  it("投稿・返信・訂正が書式を保存する。書式なしの行（旧来）はそのまま使える", async () => {
    const { ctx, revision } = await setup();
    const md = await postComment(ctx, principals.reviewer, {
      ...at,
      revisionId: revision.id,
      body: "**太字** と https://example.com",
      bodyFormat: "markdown",
    });
    expect((await ctx.threads.findById(md.id))?.bodyFormat).toBe("markdown");
    // 書式なし: 保存した行に bodyFormat は付かない
    const legacy = await postComment(ctx, principals.reviewer, {
      ...at,
      revisionId: revision.id,
      body: "**そのまま**",
    });
    expect((await ctx.threads.findById(legacy.id))?.bodyFormat).toBeUndefined();

    await replyToThread(ctx, principals.creator, {
      threadId: md.id,
      body: "- 直しました",
      bodyFormat: "markdown",
    });
    await replyToThread(ctx, principals.creator, { threadId: md.id, body: "平文の返信" });
    const [r1, r2] = await repliedEvents(ctx, md.id);
    expect(r1?.payload).toMatchObject({ body: "- 直しました", bodyFormat: "markdown" });
    expect(r2?.payload).not.toHaveProperty("bodyFormat");

    // 訂正: 訂正前の本文と書式を履歴に残し、スレッドは新しい書式になる
    await editThread(ctx, principals.reviewer, {
      threadId: legacy.id,
      body: "> 引用",
      bodyFormat: "markdown",
    });
    expect((await ctx.threads.findById(legacy.id))?.bodyFormat).toBe("markdown");
    await editThread(ctx, principals.reviewer, { threadId: legacy.id, body: "平文に戻した" });
    expect((await ctx.threads.findById(legacy.id))?.bodyFormat).toBeUndefined();
    const edits = (await ctx.threads.listEvents(legacy.id)).filter((e) => e.eventType === "edited");
    expect(edits[0]?.payload).toEqual({
      previousBody: "**そのまま**",
      bodyFormat: "markdown",
    });
    expect(edits[1]?.payload).toEqual({ previousBody: "> 引用", previousBodyFormat: "markdown" });
  });

  it("知らない書式・5000 文字を超える本文は投稿・返信・訂正のどれも拒否する", async () => {
    const { ctx, revision } = await setup();
    const input = { ...at, revisionId: revision.id, body: "x" };
    await expect(
      postComment(ctx, principals.reviewer, { ...input, bodyFormat: "html" }),
    ).rejects.toThrow(code("comment_body_format_invalid"));
    await expect(
      postComment(ctx, principals.reviewer, { ...input, body: "あ".repeat(5001) }),
    ).rejects.toThrow(code("comment_body_too_long"));
    const long = await postComment(ctx, principals.reviewer, {
      ...input,
      body: "あ".repeat(5000),
      bodyFormat: "markdown",
    });
    await expect(
      replyToThread(ctx, principals.creator, { threadId: long.id, body: "x", bodyFormat: "html" }),
    ).rejects.toThrow(code("comment_body_format_invalid"));
    await expect(
      replyToThread(ctx, principals.creator, { threadId: long.id, body: "あ".repeat(5001) }),
    ).rejects.toThrow(code("comment_body_too_long"));
    await expect(
      editThread(ctx, principals.reviewer, { threadId: long.id, body: "あ".repeat(5001) }),
    ).rejects.toThrow(code("comment_body_too_long"));
  });

  it("通知の抜粋と端末の通知の文面は書式の記号を除いた平文（書式なしはそのまま）", async () => {
    const { ctx, revision } = await setup();
    const thread = await postComment(ctx, principals.reviewer, {
      ...at,
      revisionId: revision.id,
      body: "**重要**: [規約](https://example.com/a) を確認\n- 一つ目",
      bodyFormat: "markdown",
      mentions: [principals.approver.userId],
    });
    const notified = ctx.state.notifications.all().filter((n) => n.threadId === thread.id);
    expect(notified.length).toBeGreaterThan(0);
    for (const n of notified) {
      expect(n.preview).toBe("重要: 規約 を確認 一つ目");
      expect(n.body).toContain("重要: 規約 を確認 一つ目");
      expect(n.body).not.toContain("**");
    }
    // 書式なしは記号を触らない
    const plain = await postComment(ctx, principals.reviewer, {
      ...at,
      revisionId: revision.id,
      body: "**そのまま**",
    });
    const n = ctx.state.notifications.all().find((x) => x.threadId === plain.id);
    expect(n?.preview).toBe("**そのまま**");
  });
});

describe("SNS 投稿の版の位置（本文の範囲・画像の矩形とピン。端末の枠のプレビューで付ける）", () => {
  /** 本文（30 バイト）・画像 2 枚・内容の記録の 4 添付を提出した版 */
  async function snsSetup() {
    const ctx = createInMemoryContext();
    const work = await seedWork(ctx, { mediaType: "sns" });
    const body = "第100回五月祭を開催します！"; // 14 文字・40 バイト
    const image = (k: string) => ({
      key: k,
      fileName: `${k}.png`,
      alt: "説明",
      aspect: "1:1" as const,
    });
    const snapshot = postManifest({
      ...emptyPost("instagram"),
      body,
      images: [image("01-a"), image("02-b")],
    });
    const file = (
      fileName: string,
      type: "document" | "image",
      mimeType: string,
      size: number,
    ) => ({
      fileName,
      mimeType,
      type,
      role: "source" as const,
      declaredSize: size,
    });
    const prepared = await prepareSubmission(ctx, principals.creator, {
      workId: work.id,
      kind: "standard",
      reviewType: "general",
      deadlineAt: ctx.clock.now() + 24 * HOUR,
      changeSummary: "初稿",
      focusNotes: "",
      items: [
        file("post-body.txt", "document", "text/plain", byteLength(body)),
        file("01-a.png", "image", "image/png", 100),
        file("02-b.png", "image", "image/png", 100),
        file("mf100-post.json", "document", "application/json", byteLength(snapshot)),
      ],
      postSnapshot: snapshot,
    });
    for (const item of prepared.items)
      await uploadVerifiedItem(ctx, principals.creator, {
        itemId: item.id,
        size: item.declaredSize ?? 100,
        sha256: "abc",
      });
    const { revision } = await confirmSubmission(ctx, principals.creator, {
      sessionId: prepared.session.id,
    });
    await grantWorkPermission(ctx, principals.sysadmin, {
      workId: work.id,
      userIds: [principals.reviewer.userId],
      permission: "review",
    });
    await setWorkReviewers(ctx, principals.manager, {
      workId: revision.workId,
      reviewerIds: [principals.reviewer.userId],
    });
    const artifacts = await ctx.artifacts.listByRevision(revision.id);
    const by = (name: string) => artifacts.find((a) => a.fileName === name)!;
    const post = (anchor: Parameters<typeof postComment>[2]["anchor"]) =>
      postComment(ctx, principals.reviewer, {
        revisionId: revision.id,
        body: "位置のコメント",
        kind: "correction",
        severity: "minor",
        ...(anchor ? { anchor } : {}),
      });
    return { by, post, body };
  }

  it("本文の添付に text_range、各画像の添付に image_rect・image_pin を付けられる", async () => {
    const { by, post, body } = await snsSetup();
    const start = body.indexOf("五月祭");
    const text = await post({
      type: "text_range",
      artifactId: by("post-body.txt").id,
      start,
      end: start + 3,
      quote: "五月祭",
    });
    expect(text.anchor).toMatchObject({ type: "text_range", start, end: start + 3 });
    const rect = await post({
      type: "image_rect",
      artifactId: by("01-a.png").id,
      rect: { x: 0.1, y: 0.2, w: 0.3, h: 0.4 },
    });
    expect(rect.artifactId).toBe(by("01-a.png").id);
    const pin = await post({
      type: "image_pin",
      artifactId: by("02-b.png").id,
      point: { x: 0.5, y: 0.5 },
    });
    expect(pin.anchor).toMatchObject({ type: "image_pin", point: { x: 0.5, y: 0.5 } });
  });

  it("種類の合わない添付・内容の記録・本文の大きさを超える範囲は拒否する", async () => {
    const { by, post, body } = await snsSetup();
    const rejected = (anchor: Parameters<typeof post>[0]) =>
      expect(post(anchor)).rejects.toThrow(code("anchor_artifact_mismatch"));
    // 画像の添付に文章の範囲、本文の添付に画像の矩形
    await rejected({
      type: "text_range",
      artifactId: by("01-a.png").id,
      start: 0,
      end: 3,
      quote: "第10",
    });
    await rejected({
      type: "image_rect",
      artifactId: by("post-body.txt").id,
      rect: { x: 0, y: 0, w: 0.5, h: 0.5 },
    });
    // 内容の記録（mf100-post.json）そのものには付けない
    await rejected({
      type: "image_pin",
      artifactId: by("mf100-post.json").id,
      point: { x: 0.5, y: 0.5 },
    });
    // 本文のバイト数を超える終端（壊れた値）
    await rejected({
      type: "text_range",
      artifactId: by("post-body.txt").id,
      start: 0,
      end: byteLength(body) + 1,
      quote: "第100回",
    });
    // 壊れた座標は従来どおり anchor_invalid
    await expect(
      post({
        type: "image_rect",
        artifactId: by("01-a.png").id,
        rect: { x: 0.8, y: 0.8, w: 0.5, h: 0.5 },
      }),
    ).rejects.toThrow(code("anchor_invalid"));
  });
});
