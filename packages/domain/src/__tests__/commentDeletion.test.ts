import { describe, expect, it } from "vite-plus/test";
import type { CommentEvent } from "../comment/CommentThread.ts";
import {
  canDeleteComment,
  commentDeleteAuthority,
  assertCanDeleteReply,
  deleteThreadComment,
  isActiveThread,
  planThreadDeletion,
  presentThread,
  projectThreadEvents,
  replyEntries,
} from "../comment/deletion.ts";
import { makeThread } from "./fixtures.ts";

const code = (c: string) => expect.objectContaining({ code: c });
const NOW = 1_000;

const reply = (id: string, actorId: string): CommentEvent => ({
  id,
  threadId: "t1",
  eventType: "replied",
  actorId,
  payload: { body: "返信" },
  createdAt: 10,
});
const replyDeleted = (replyEventId: string, actorId: string): CommentEvent => ({
  threadId: "t1",
  eventType: "reply_deleted",
  actorId,
  payload: { replyEventId },
  createdAt: 20,
});

describe("コメントの削除（投稿者は校了前だけ・システム管理者は常に）", () => {
  it("canDeleteComment: 本人かつ校了前だけ", () => {
    expect(canDeleteComment("reviewer", "reviewer", "active")).toBe(true);
    expect(canDeleteComment("reviewer", "creator", "active")).toBe(false);
    expect(canDeleteComment("reviewer", "reviewer", "finalized")).toBe(false);
  });

  it("投稿者は削除できる。原文は書き換えない", () => {
    const next = deleteThreadComment(makeThread(), "reviewer", "active", [], NOW);
    expect(next.deletedAt).toBe(NOW);
    expect(next.body).toBe("誤字");
    expect(isActiveThread(next)).toBe(false);
  });

  it("システム管理者は他人のコメントも、校了後も削除できる。権限の種類を区別する", () => {
    const admin = { isSystemAdmin: true };
    expect(canDeleteComment("reviewer", "admin", "active", admin)).toBe(true);
    expect(canDeleteComment("reviewer", "admin", "finalized", admin)).toBe(true);
    expect(commentDeleteAuthority("reviewer", "admin", "active", admin)).toBe("admin");
    expect(commentDeleteAuthority("reviewer", "reviewer", "active", admin)).toBe("author");
    expect(commentDeleteAuthority("reviewer", "reviewer", "finalized", admin)).toBe("admin");
    expect(commentDeleteAuthority("reviewer", "creator", "active", { isSystemAdmin: false })).toBe(
      null,
    );
    const next = deleteThreadComment(makeThread(), "admin", "finalized", [], NOW, admin);
    expect(next.deletedAt).toBe(NOW);
    expect(next.body).toBe("誤字");
  });

  it("他の人（制作者・管理者でない人）は削除できない", () => {
    for (const actor of ["creator", "admin", "someone"]) {
      expect(() => deleteThreadComment(makeThread(), actor, "active", [], NOW)).toThrowError(
        code("comment_delete_not_author"),
      );
    }
  });

  it("校了後は投稿者でも削除できない", () => {
    expect(() => deleteThreadComment(makeThread(), "reviewer", "finalized", [], NOW)).toThrowError(
      code("work_already_finalized"),
    );
  });

  it("削除済みを重ねて削除はできない", () => {
    const gone = makeThread({ deletedAt: 5 });
    expect(() => deleteThreadComment(gone, "reviewer", "active", [], NOW)).toThrowError(
      code("comment_thread_deleted"),
    );
  });

  it("削除したスレッドは返信の有無によらず一覧に残さない（deletedAt が付くだけ）", () => {
    for (const events of [[], [reply("e1", "reviewer")], [reply("e1", "creator")]]) {
      const next = deleteThreadComment(makeThread(), "reviewer", "active", events, NOW);
      expect(isActiveThread(next)).toBe(false);
      expect(next.deletedKeepsReplies).toBeUndefined(); // 古い仕様の印は書かない
    }
  });
});

describe("スレッドの削除は返信ごとまとめて消す（本人も管理者も。利用者決定 2026-10-19・指示「「削除された投稿」として残さなくて良い。」）", () => {
  const admin = { isSystemAdmin: true };
  const events = [reply("e1", "creator"), reply("e2", "reviewer"), reply("e3", "approver")];

  it("管理者: 削除されていない全ての返信が対象で、一覧には何も残らない", () => {
    const plan = planThreadDeletion(
      makeThread(),
      "admin",
      "active",
      [...events, replyDeleted("e2", "reviewer")],
      NOW,
      admin,
    );
    expect(plan.authority).toBe("admin");
    expect(plan.cascadeReplyIds).toEqual(["e1", "e3"]);
    expect(plan.thread.deletedAt).toBe(NOW);
    // 校了後も同じ
    expect(
      planThreadDeletion(makeThread(), "admin", "finalized", events, NOW, admin).cascadeReplyIds,
    ).toEqual(["e1", "e2", "e3"]);
  });

  it("投稿者本人も、他の人の返信を含む削除されていない全ての返信を巻き込む", () => {
    const own = planThreadDeletion(
      makeThread(),
      "reviewer",
      "active",
      [...events, replyDeleted("e1", "creator")],
      NOW,
    );
    expect(own.authority).toBe("author");
    expect(own.cascadeReplyIds).toEqual(["e2", "e3"]);
    expect(own.thread.deletedAt).toBe(NOW);
    // 管理者でも自分のコメントを校了前に消すときは本人の削除
    expect(
      planThreadDeletion(makeThread(), "reviewer", "active", events, NOW, admin).authority,
    ).toBe("author");
  });

  it("権限の無い人は削除できない", () => {
    expect(() => planThreadDeletion(makeThread(), "creator", "active", events, NOW)).toThrowError(
      code("comment_delete_not_author"),
    );
  });
});

describe("返信の削除", () => {
  const thread = makeThread();
  const events = [reply("e1", "creator"), reply("e2", "reviewer")];

  it("返信した本人だけ削除できる（スレッドの投稿者でも他人の返信は消せない）", () => {
    expect(() => assertCanDeleteReply(thread, "e1", "creator", "active", events)).not.toThrow();
    expect(() => assertCanDeleteReply(thread, "e1", "reviewer", "active", events)).toThrowError(
      code("comment_delete_not_author"),
    );
    expect(() => assertCanDeleteReply(thread, "e1", "admin", "active", events)).toThrowError(
      code("comment_delete_not_author"),
    );
  });

  it("システム管理者は他人の返信も、校了後も削除できる", () => {
    const admin = { isSystemAdmin: true };
    expect(() =>
      assertCanDeleteReply(thread, "e1", "admin", "active", events, admin),
    ).not.toThrow();
    expect(() =>
      assertCanDeleteReply(thread, "e2", "admin", "finalized", events, admin),
    ).not.toThrow();
    expect(() =>
      assertCanDeleteReply(thread, "nope", "admin", "active", events, admin),
    ).toThrowError(code("comment_reply_not_found"));
  });

  it("校了後・存在しない・削除済みの返信は削除できない", () => {
    expect(() => assertCanDeleteReply(thread, "e1", "creator", "finalized", events)).toThrowError(
      code("work_already_finalized"),
    );
    expect(() => assertCanDeleteReply(thread, "nope", "creator", "active", events)).toThrowError(
      code("comment_reply_not_found"),
    );
    expect(() =>
      assertCanDeleteReply(thread, "e1", "creator", "active", [
        ...events,
        replyDeleted("e1", "creator"),
      ]),
    ).toThrowError(code("comment_reply_not_found"));
  });

  it("replyEntries は削除済みを導く", () => {
    expect(replyEntries([...events, replyDeleted("e1", "creator")])).toEqual([
      { id: "e1", actorId: "creator", deleted: true, edited: false, fileIds: [] },
      { id: "e2", actorId: "reviewer", deleted: false, edited: false, fileIds: [] },
    ]);
  });
});

describe("画面向けの見せ方", () => {
  it("presentThread: can.delete は本人（校了前）かシステム管理者だけ真", () => {
    const live = makeThread({ mentions: ["x"], assigneeId: "creator" });
    expect(presentThread(live, "reviewer", "active")).toMatchObject({
      body: "誤字",
      can: { delete: true },
    });
    expect(presentThread(live, "creator", "active").can.delete).toBe(false);
    expect(presentThread(live, "reviewer", "finalized").can.delete).toBe(false);
    // システム管理者は他人のものも、校了後も削除できる
    const admin = { isSystemAdmin: true };
    expect(presentThread(live, "admin", "active", admin).can.delete).toBe(true);
    expect(presentThread(live, "admin", "finalized", admin).can.delete).toBe(true);
  });

  it("projectThreadEvents: 削除された返信と削除の記録は並べない。返信の can.delete は本人だけ", () => {
    const events: CommentEvent[] = [
      { id: "e0", threadId: "t1", eventType: "created", actorId: "reviewer", createdAt: 1 },
      reply("e1", "creator"),
      reply("e2", "reviewer"),
      replyDeleted("e1", "creator"),
      { id: "e4", threadId: "t1", eventType: "deleted", actorId: "reviewer", createdAt: 30 },
    ];
    const view = projectThreadEvents(events, "reviewer", "active");
    expect(view.map((e) => e.eventType)).toEqual(["created", "replied"]);
    expect(view.map((e) => e.id)).toEqual(["e0", "e2"]);
    expect(view[1]).toMatchObject({ id: "e2", can: { delete: true, edit: true } });
    expect(projectThreadEvents(events, "creator", "active")[1]!.can).toEqual({
      delete: false,
      edit: false,
    });
    expect(projectThreadEvents(events, "reviewer", "finalized")[1]!.can).toEqual({
      delete: false,
      edit: false,
    });
    // システム管理者は他人の返信も、校了後も削除できる
    const admin = { isSystemAdmin: true };
    for (const lifecycle of ["active", "finalized"] as const)
      expect(projectThreadEvents(events, "admin", lifecycle, admin)[1]!.can).toEqual({
        delete: true,
        edit: false,
      });
  });
});
