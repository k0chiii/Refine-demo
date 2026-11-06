import { describe, expect, it } from "vite-plus/test";
import type { CommentEvent } from "../comment/CommentThread.ts";
import { projectThreadEvents } from "../comment/deletion.ts";
import {
  assertCanReactToComment,
  summarizeCommentReactions,
  toggleReplyReaction,
  toggleThreadReaction,
  validateCommentReaction,
} from "../comment/reactions.ts";
import { REACTIONS } from "../shared/reactions.ts";
import { makeThread } from "./fixtures.ts";

const code = (c: string) => expect.objectContaining({ code: c });

const reply = (id: string, reactions?: CommentEvent["reactions"]): CommentEvent => ({
  id,
  threadId: "t1",
  eventType: "replied",
  actorId: "creator",
  payload: { body: "返信" },
  ...(reactions ? { reactions } : {}),
  createdAt: 10,
});
const replyDeleted = (replyEventId: string): CommentEvent => ({
  threadId: "t1",
  eventType: "reply_deleted",
  actorId: "creator",
  payload: { replyEventId },
  createdAt: 20,
});

describe("コメントへのリアクション", () => {
  it("絵文字の種類は決まったものだけ。決まったもの以外は拒否", () => {
    expect([...REACTIONS]).toEqual(["👍", "🙏", "👀", "🎉", "💡", "❤️"]);
    expect(validateCommentReaction("👍")).toBe("👍");
    expect(() => validateCommentReaction("😀")).toThrow(code("comment_reaction_invalid"));
  });

  it("コメントは押すと付き、もう一度押すと外れる。誰も付けていなければ持たない", () => {
    let t = makeThread();
    t = toggleThreadReaction(t, "🎉", "a");
    t = toggleThreadReaction(t, "👍", "a");
    t = toggleThreadReaction(t, "👍", "b");
    expect(t.reactions).toEqual([
      { emoji: "👍", userIds: ["a", "b"] },
      { emoji: "🎉", userIds: ["a"] },
    ]);
    t = toggleThreadReaction(t, "👍", "a");
    t = toggleThreadReaction(t, "👍", "b");
    t = toggleThreadReaction(t, "🎉", "a");
    expect(t.reactions).toBeUndefined();
  });

  it("同じ人は同じ絵文字を 1 回だけ（2 回目は外れる）。別の絵文字は重ねて付けられる", () => {
    let t = makeThread();
    t = toggleThreadReaction(t, "👀", "a");
    t = toggleThreadReaction(t, "🙏", "a");
    expect(t.reactions?.map((r) => [r.emoji, r.userIds.length])).toEqual([
      ["🙏", 1],
      ["👀", 1],
    ]);
    t = toggleThreadReaction(t, "👀", "a");
    expect(t.reactions).toEqual([{ emoji: "🙏", userIds: ["a"] }]);
  });

  it("元のスレッドは書き換えない", () => {
    const t = makeThread();
    toggleThreadReaction(t, "👍", "a");
    expect(t.reactions).toBeUndefined();
  });

  it("削除されたコメントには付けられない", () => {
    const t = { ...makeThread(), deletedAt: 5 };
    expect(() => toggleThreadReaction(t, "👍", "a")).toThrow(code("comment_thread_deleted"));
  });

  it("返信へのリアクション: 付け外しでき、返信でないもの・削除された返信は見つからない", () => {
    const events = [reply("r1"), reply("r2"), replyDeleted("r2")];
    const first = toggleReplyReaction(events, "r1", "💡", "a", "t1");
    expect(first).toEqual([{ emoji: "💡", userIds: ["a"] }]);
    const withMine = [reply("r1", first)];
    expect(toggleReplyReaction(withMine, "r1", "💡", "a", "t1")).toEqual([]);
    expect(toggleReplyReaction(withMine, "r1", "💡", "b", "t1")).toEqual([
      { emoji: "💡", userIds: ["a", "b"] },
    ]);
    expect(() => toggleReplyReaction(events, "r2", "💡", "a", "t1")).toThrow(
      code("comment_reply_not_found"),
    );
    expect(() => toggleReplyReaction(events, "nope", "💡", "a", "t1")).toThrow(
      code("comment_reply_not_found"),
    );
    expect(() => toggleReplyReaction(events, "r1", "😀", "a", "t1")).toThrow(
      code("comment_reaction_invalid"),
    );
  });

  it("校了後は付けられない", () => {
    expect(() => assertCanReactToComment("finalized")).toThrow(code("work_already_finalized"));
    expect(() => assertCanReactToComment("active")).not.toThrow();
  });

  it("集計: 決まった並びで、人数・自分が付けたか・付けた人", () => {
    const entries = [
      { emoji: "🎉" as const, userIds: ["a"] },
      { emoji: "👍" as const, userIds: ["a", "b"] },
    ];
    expect(summarizeCommentReactions(entries, "b")).toEqual([
      { emoji: "👍", count: 2, mine: true, userIds: ["a", "b"] },
      { emoji: "🎉", count: 1, mine: false, userIds: ["a"] },
    ]);
    expect(summarizeCommentReactions(undefined, "b")).toEqual([]);
  });

  it("削除した返信は履歴に並べない（リアクションも出ない）", () => {
    const events = [reply("r1", [{ emoji: "👍", userIds: ["a"] }]), replyDeleted("r1")];
    expect(projectThreadEvents(events, "a", "active")).toEqual([]);
  });
});
