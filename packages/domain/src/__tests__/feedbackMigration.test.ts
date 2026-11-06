import { describe, expect, it } from "vite-plus/test";
import type { Anchor } from "../comment/Anchor.ts";
import {
  deriveFeedbackThreadTitle,
  isLiveFeedbackThread,
  type FeedbackFile,
  type FeedbackPost,
  type FeedbackThread,
} from "../feedback/feedback.ts";
import {
  commentFileFromFeedbackFile,
  feedbackMigrationBody,
  FEEDBACK_MIGRATION_REASON,
  isMigratableFeedbackFile,
  latestNonVoidRevision,
  planFeedbackThreadMigration,
  resolveMigratedThread,
} from "../feedback/migration.ts";
import { HOUR, makeRevision, makeThread, T0 } from "./fixtures.ts";

const thread = (over: Partial<FeedbackThread> = {}): FeedbackThread => ({
  id: "fb1",
  workId: "work1",
  title: "配色の方向性",
  createdBy: "creator",
  createdAt: T0,
  lastPostAt: T0 + 2 * HOUR,
  postCount: 2,
  participantIds: ["creator", "reviewer"],
  ...over,
});
const post = (id: string, over: Partial<FeedbackPost> = {}): FeedbackPost => ({
  id,
  threadId: "fb1",
  workId: "work1",
  authorId: "creator",
  body: "配色の意図です",
  mentions: [],
  fileIds: [],
  reactions: [],
  createdAt: T0,
  ...over,
});
const file = (over: Partial<FeedbackFile> = {}): FeedbackFile => ({
  id: "f1",
  workId: "work1",
  uploaderId: "creator",
  fileName: "案A.pdf",
  mimeType: "application/pdf",
  type: "pdf",
  declaredSize: 10,
  size: 10,
  sha256: "abc",
  keyPrefix: "feedback/work1/f1/案A.pdf",
  objectKey: "feedback/work1/f1/案A.pdf/attempts/a1",
  status: "verified",
  postId: "p1",
  createdAt: T0,
  ...over,
});

const r1 = makeRevision({ id: "r1", sequence: 1, submittedAt: T0, reviewState: "closed" });
const r2 = makeRevision({ id: "r2", sequence: 2, submittedAt: T0 + 10 * HOUR });

function plan(
  over: {
    thread?: Partial<FeedbackThread>;
    posts?: FeedbackPost[];
    revisions?: ReturnType<typeof makeRevision>[];
    lifecycle?: "active" | "finalized";
  } = {},
) {
  return planFeedbackThreadMigration({
    thread: thread(over.thread),
    posts: over.posts ?? [post("p1"), post("p2", { authorId: "reviewer", createdAt: T0 + HOUR })],
    revisions: over.revisions ?? [r1, r2],
    workLifecycle: over.lifecycle ?? "active",
  });
}
function migrated(over: Parameters<typeof plan>[0] = {}) {
  const d = plan(over);
  if (d.kind !== "migrate") throw new Error(`skipped: ${d.reason}`);
  return d.plan;
}

describe("FB のスレッドをコメントへ移す計画", () => {
  it("最初の投稿がコメント本体、残りが返信。平文のまま・修正提案・重要で、移行元の ID を持つ", () => {
    const p = migrated({
      posts: [
        post("p2", { authorId: "reviewer", body: "返信 *強調ではない*", createdAt: T0 + HOUR }),
        post("p1", {
          body: "* 箇条ではない\n本文",
          mentions: ["reviewer", "reviewer"],
          reactions: [
            { emoji: "👍", userIds: ["reviewer"] },
            { emoji: "👀", userIds: [] },
          ],
        }),
      ],
      thread: { title: "* 箇条ではない" },
    });
    expect(p.thread).toMatchObject({
      authorId: "creator",
      body: "* 箇条ではない\n本文",
      kind: "correction",
      severity: "major",
      createdAt: T0,
      mentions: ["reviewer"],
      reactions: [{ emoji: "👍", userIds: ["reviewer"] }],
      migratedFromFeedbackThreadId: "fb1",
    });
    expect(p.thread).not.toHaveProperty("bodyFormat");
    expect(p.thread).not.toHaveProperty("anchor");
    expect(p.replies).toEqual([
      {
        sourcePostId: "p2",
        authorId: "reviewer",
        body: "返信 *強調ではない*",
        mentions: [],
        reactions: [],
        createdAt: T0 + HOUR,
        sourceFileIds: [],
      },
    ]);
  });

  it("削除された投稿は移さない。最初の投稿が消えていれば次の投稿がコメント本体になる", () => {
    const p = migrated({
      posts: [
        post("p1", { deletedAt: T0 + 5 * HOUR }),
        post("p2", { authorId: "reviewer", body: "残った投稿", createdAt: T0 + HOUR }),
        post("p3", { createdAt: T0 + 2 * HOUR }),
      ],
    });
    expect(p.thread).toMatchObject({ authorId: "reviewer", createdAt: T0 + HOUR });
    expect(p.replies.map((r) => r.sourcePostId)).toEqual(["p3"]);
  });

  it("題名を明示していた（本文から作られる題名と違う）ときだけ、本文の頭に【題名】の行を足す", () => {
    const first = { body: "余白について\n詳細", fileIds: [] };
    const same = deriveFeedbackThreadTitle({ body: first.body });
    expect(feedbackMigrationBody({ title: same }, first)).toBe("余白について\n詳細");
    expect(feedbackMigrationBody({ title: "配色の方向性" }, first)).toBe(
      "【配色の方向性】\n余白について\n詳細",
    );
    // 範囲の引用・ファイルの数から作られた題名も「本文から作られた題名」
    const quote = "第100回";
    const anchor: Anchor = { type: "text_range", artifactId: "a1", start: 0, end: 4, quote };
    expect(
      feedbackMigrationBody(
        { title: deriveFeedbackThreadTitle({ body: "", quote }), anchor },
        { body: "", fileIds: [] },
      ),
    ).toBe("");
    expect(
      feedbackMigrationBody(
        { title: deriveFeedbackThreadTitle({ body: "", fileCount: 2 }) },
        { body: "", fileIds: ["a", "b"] },
      ),
    ).toBe("");
  });

  it("場所（anchor）はそのまま持ち越す。FB の版が無くなって別の版へ移すときは持ち越さない", () => {
    const anchor: Anchor = { type: "image_pin", artifactId: "art1", point: { x: 0.2, y: 0.4 } };
    const kept = migrated({ thread: { revisionId: "r1", anchor } });
    expect(kept.revisionId).toBe("r1");
    expect(kept.thread).toMatchObject({ anchor, artifactId: "art1" });
    expect(kept.anchorKept).toBe(true);
    const dropped = migrated({ thread: { revisionId: "gone", anchor } });
    expect(dropped.revisionId).toBe("r2");
    expect(dropped.thread).not.toHaveProperty("anchor");
    expect(dropped.anchorKept).toBe(false);
  });

  it("移し先の版: スレッドの版、無ければ最新の void でない版。版が無ければ移さない", () => {
    expect(migrated({ thread: { revisionId: "r1" } }).revisionId).toBe("r1");
    expect(migrated().revisionId).toBe("r2");
    const voided = makeRevision({
      id: "rv",
      sequence: 3,
      submittedAt: T0 + 20 * HOUR,
      reviewState: "void",
    });
    expect(migrated({ revisions: [r1, r2, voided] }).revisionId).toBe("r2");
    expect(latestNonVoidRevision([voided])).toBeNull();
    expect(plan({ revisions: [] })).toEqual({ kind: "skip", reason: "no_revision" });
    expect(plan({ revisions: [voided] })).toEqual({ kind: "skip", reason: "no_revision" });
  });

  it("未解決で移すのは、校了前の制作物の最新の受付中の版だけ。それ以外は解決済み", () => {
    // 最新の受付中の版（r2）
    expect(migrated().resolution).toBe("open");
    expect(migrated({ thread: { revisionId: "r2" } }).resolution).toBe("open");
    // 古い版（受付終了）
    expect(migrated({ thread: { revisionId: "r1" } }).resolution).toBe("resolved");
    // 校了した制作物
    expect(migrated({ lifecycle: "finalized" }).resolution).toBe("resolved");
    // 受付中の版が無い（最新の版が期限で閉じている）
    const closed = makeRevision({
      id: "r2",
      sequence: 2,
      submittedAt: T0 + 10 * HOUR,
      reviewState: "closed",
    });
    expect(migrated({ revisions: [r1, closed] }).resolution).toBe("resolved");
  });

  it("投稿の添付の ID を、コメント本体と返信ごとに持つ", () => {
    const p = migrated({
      posts: [
        post("p1", { fileIds: ["f1", "f2"] }),
        post("p2", { createdAt: T0 + HOUR, fileIds: ["f3"] }),
      ],
    });
    expect(p.sourceFileIds).toEqual(["f1", "f2"]);
    expect(p.replies[0]!.sourceFileIds).toEqual(["f3"]);
  });

  it("対象でないスレッド: 削除済み・生きた投稿が無い", () => {
    expect(plan({ thread: { deletedAt: T0 + HOUR } })).toEqual({
      kind: "skip",
      reason: "not_live",
    });
    expect(plan({ thread: { postCount: 0 } })).toEqual({ kind: "skip", reason: "not_live" });
    expect(
      plan({ posts: [post("p1", { deletedAt: T0 + HOUR }), post("p2", { deletedAt: T0 })] }),
    ).toEqual({ kind: "skip", reason: "no_posts" });
    expect(isLiveFeedbackThread(thread())).toBe(true);
  });
});

describe("解決済みで移すときの採否", () => {
  it("未解決から「反映済み」へ採否の遷移表どおりに移す", () => {
    const t = resolveMigratedThread(makeThread({ resolution: "open" }));
    expect(t.resolution).toBe("resolved");
    expect(FEEDBACK_MIGRATION_REASON.trim()).not.toBe("");
  });
});

describe("FB の添付をコメントの添付にする", () => {
  it("同じ R2 のキーを指し、検証済み・サムネイル無しで、付ける先の版にそろえる", () => {
    const f = file();
    expect(commentFileFromFeedbackFile(f, { threadId: "c1", revisionId: "r2" })).toEqual({
      workId: "work1",
      revisionId: "r2",
      uploaderId: "creator",
      fileName: "案A.pdf",
      originalName: "案A.pdf",
      mimeType: "application/pdf",
      type: "pdf",
      declaredSize: 10,
      size: 10,
      sha256: "abc",
      objectKey: f.objectKey,
      status: "verified",
      threadId: "c1",
      createdAt: T0,
    });
  });

  it("検証に失敗した・まだの・放置された・R2 から消えた添付は移さない", () => {
    for (const over of [
      { status: "failed" as const },
      { status: "pending" as const, objectKey: "" },
      { abandonedAt: T0 + HOUR },
      { purgedAt: T0 + HOUR },
    ]) {
      const f = file(over);
      expect(isMigratableFeedbackFile(f)).toBe(false);
      expect(commentFileFromFeedbackFile(f, { threadId: "c1", revisionId: "r2" })).toBeNull();
    }
  });
});
