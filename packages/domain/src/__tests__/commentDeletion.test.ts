import { describe, expect, it } from "vite-plus/test";
import type { CommentEvent } from "../comment/CommentThread.ts";
import {
  canDeleteComment,
  commentDeleteAuthority,
  deleteReply,
  deleteThreadComment,
  isActiveThread,
  isListedThread,
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

  it("他の人の返信が無ければ一覧に残さない。あれば残す（自分の返信だけなら残さない）", () => {
    const none = deleteThreadComment(makeThread(), "reviewer", "active", [], NOW);
    expect(isListedThread(none)).toBe(false);
    const own = deleteThreadComment(
      makeThread(),
      "reviewer",
      "active",
      [reply("e1", "reviewer")],
      NOW,
    );
    expect(isListedThread(own)).toBe(false);
    const others = deleteThreadComment(
      makeThread(),
      "reviewer",
      "active",
      [reply("e1", "creator")],
      NOW,
    );
    expect(isListedThread(others)).toBe(true);
    expect(isActiveThread(others)).toBe(false);
  });

  it("他の人の返信が削除済みなら残す理由にならない", () => {
    const next = deleteThreadComment(
      makeThread(),
      "reviewer",
      "active",
      [reply("e1", "creator"), replyDeleted("e1", "creator")],
      NOW,
    );
    expect(isListedThread(next)).toBe(false);
  });
});

describe("返信の削除", () => {
  const thread = makeThread();
  const events = [reply("e1", "creator"), reply("e2", "reviewer")];

  it("返信した本人だけ削除できる（スレッドの投稿者でも他人の返信は消せない）", () => {
    expect(deleteReply(thread, "e1", "creator", "active", events)).toBe(thread);
    expect(() => deleteReply(thread, "e1", "reviewer", "active", events)).toThrowError(
      code("comment_delete_not_author"),
    );
    expect(() => deleteReply(thread, "e1", "admin", "active", events)).toThrowError(
      code("comment_delete_not_author"),
    );
  });

  it("システム管理者は他人の返信も、校了後も削除できる", () => {
    const admin = { isSystemAdmin: true };
    expect(deleteReply(thread, "e1", "admin", "active", events, admin)).toBe(thread);
    expect(deleteReply(thread, "e2", "admin", "finalized", events, admin)).toBe(thread);
    expect(() => deleteReply(thread, "nope", "admin", "active", events, admin)).toThrowError(
      code("comment_reply_not_found"),
    );
  });

  it("校了後・存在しない・削除済みの返信は削除できない", () => {
    expect(() => deleteReply(thread, "e1", "creator", "finalized", events)).toThrowError(
      code("work_already_finalized"),
    );
    expect(() => deleteReply(thread, "nope", "creator", "active", events)).toThrowError(
      code("comment_reply_not_found"),
    );
    expect(() =>
      deleteReply(thread, "e1", "creator", "active", [...events, replyDeleted("e1", "creator")]),
    ).toThrowError(code("comment_reply_not_found"));
  });

  it("削除されたコメントに残った他の人の返信が全て消えたら一覧から外す", () => {
    const gone = makeThread({ deletedAt: 5, deletedKeepsReplies: true });
    const two = [reply("e1", "creator"), reply("e2", "approver")];
    const stillListed = deleteReply(gone, "e1", "creator", "active", two);
    expect(isListedThread(stillListed)).toBe(true);
    const last = deleteReply(gone, "e1", "creator", "active", [
      ...two,
      replyDeleted("e2", "approver"),
    ]);
    expect(isListedThread(last)).toBe(false);
  });

  it("replyEntries は削除済みを導く", () => {
    expect(replyEntries([...events, replyDeleted("e1", "creator")])).toEqual([
      { id: "e1", actorId: "creator", deleted: true },
      { id: "e2", actorId: "reviewer", deleted: false },
    ]);
  });
});

describe("画面向けの見せ方", () => {
  it("presentThread: 削除済みは本文・位置・メンション・担当を伏せ、can.delete は偽。通常は本人だけ真", () => {
    const live = makeThread({ mentions: ["x"], assigneeId: "creator" });
    expect(presentThread(live, "reviewer", "active")).toMatchObject({
      deleted: false,
      can: { delete: true },
    });
    expect(presentThread(live, "creator", "active").can.delete).toBe(false);
    expect(presentThread(live, "reviewer", "finalized").can.delete).toBe(false);
    // システム管理者は他人のものも、校了後も削除できる
    const admin = { isSystemAdmin: true };
    expect(presentThread(live, "admin", "active", admin).can.delete).toBe(true);
    expect(presentThread(live, "admin", "finalized", admin).can.delete).toBe(true);
    expect(presentThread(makeThread({ deletedAt: 5 }), "admin", "active", admin).can.delete).toBe(
      false,
    );

    const gone = presentThread(
      makeThread({
        deletedAt: 5,
        deletedKeepsReplies: true,
        mentions: ["x"],
        assigneeId: "creator",
        anchor: { type: "external", artifactId: "a", note: "n" },
        artifactId: "a",
      }),
      "reviewer",
      "active",
    );
    expect(gone.deleted).toBe(true);
    expect(gone.can.delete).toBe(false);
    expect(gone.body).not.toBe("誤字");
    expect(gone.anchor).toBeUndefined();
    expect(gone.artifactId).toBeUndefined();
    expect(gone.mentions).toBeUndefined();
    expect(gone.assigneeId).toBeUndefined();
  });

  it("projectThreadEvents: 削除された返信は本文を伏せ、削除の記録は並べない。返信の can.delete は本人だけ", () => {
    const events: CommentEvent[] = [
      { id: "e0", threadId: "t1", eventType: "created", actorId: "reviewer", createdAt: 1 },
      reply("e1", "creator"),
      reply("e2", "reviewer"),
      replyDeleted("e1", "creator"),
      { id: "e4", threadId: "t1", eventType: "deleted", actorId: "reviewer", createdAt: 30 },
    ];
    const view = projectThreadEvents({}, events, "reviewer", "active");
    expect(view.map((e) => e.eventType)).toEqual(["created", "replied", "replied"]);
    const [, r1, r2] = view;
    expect(r1).toMatchObject({ id: "e1", deleted: true, can: { delete: false } });
    expect((r1!.payload as { body: string }).body).not.toBe("返信");
    expect(r2).toMatchObject({ id: "e2", can: { delete: true } });
    expect(projectThreadEvents({}, events, "creator", "active")[2]!.can).toEqual({ delete: false });
    expect(projectThreadEvents({}, events, "reviewer", "finalized")[2]!.can).toEqual({
      delete: false,
    });
    // システム管理者は他人の返信も、校了後も削除できる（削除済みの返信は除く）
    const admin = { isSystemAdmin: true };
    for (const lifecycle of ["active", "finalized"] as const) {
      const v = projectThreadEvents({}, events, "admin", lifecycle, admin);
      expect(v[1]!.can).toEqual({ delete: false });
      expect(v[2]!.can).toEqual({ delete: true });
    }
  });

  it("projectThreadEvents: 削除したスレッドの訂正前の本文は見せない", () => {
    const edited: CommentEvent = {
      id: "e1",
      threadId: "t1",
      eventType: "edited",
      actorId: "reviewer",
      payload: { previousBody: "原文" },
      createdAt: 2,
    };
    expect(projectThreadEvents({}, [edited], "reviewer", "active")[0]!.payload).toEqual({
      previousBody: "原文",
    });
    expect(projectThreadEvents({ deletedAt: 5 }, [edited], "reviewer", "active")[0]!.payload).toBe(
      undefined,
    );
  });
});
