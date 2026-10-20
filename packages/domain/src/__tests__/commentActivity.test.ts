import { describe, expect, it } from "vite-plus/test";
import {
  deriveThreadActivity,
  initialThreadActivity,
  isThreadUnread,
  replyRecipients,
  storedThreadActivity,
  withThreadActivity,
} from "../comment/activity.ts";
import type { CommentEvent } from "../comment/CommentThread.ts";
import type { BotOrigin } from "../notation/autoProofread.ts";
import { makeThread } from "./fixtures.ts";

const reply = (id: string, actorId: string, createdAt: number): CommentEvent => ({
  id,
  threadId: "t1",
  eventType: "replied",
  actorId,
  payload: { body: "返信" },
  createdAt,
});
const replyDeleted = (replyEventId: string): CommentEvent => ({
  threadId: "t1",
  eventType: "reply_deleted",
  actorId: "x",
  payload: { replyEventId },
  createdAt: 99,
});
const decided = (createdAt: number): CommentEvent => ({
  threadId: "t1",
  eventType: "decided",
  actorId: "creator",
  payload: { to: "resolved" },
  createdAt,
});

const thread = makeThread({ authorId: "reviewer", createdAt: 100 });
const botThread = makeThread({
  authorId: "bot:proofreader",
  createdAt: 100,
  origin: { kind: "bot" } as BotOrigin,
});

describe("スレッドのやり取り（返信の件数・参加者・最後の動き）", () => {
  it("立てた直後は返信なし・動きは投稿・参加者は投稿者だけ", () => {
    expect(initialThreadActivity(thread)).toEqual({
      lastActivityAt: 100,
      lastActivityBy: "reviewer",
      replyCount: 0,
      participantIds: ["reviewer"],
    });
  });

  it("イベントから導く: 返信の件数・最後の動き・参加者（投稿者が先頭、続いて返信した人を新しい順）", () => {
    const a = deriveThreadActivity(thread, [
      reply("e1", "creator", 200),
      reply("e2", "manager", 300),
      reply("e3", "creator", 400),
      reply("e4", "reviewer", 500),
    ]);
    expect(a.replyCount).toBe(4);
    expect(a.lastActivityAt).toBe(500);
    expect(a.lastActivityBy).toBe("reviewer");
    expect(a.participantIds).toEqual(["reviewer", "creator", "manager"]);
  });

  it("削除した返信は件数・参加者・最後の動きに数えない。採否は動きではない", () => {
    const a = deriveThreadActivity(thread, [
      reply("e1", "creator", 200),
      reply("e2", "manager", 300),
      replyDeleted("e2"),
      decided(900),
    ]);
    expect(a.replyCount).toBe(1);
    expect(a.lastActivityAt).toBe(200);
    expect(a.lastActivityBy).toBe("creator");
    expect(a.participantIds).toEqual(["reviewer", "creator"]);
    // 返信がすべて消えたら、投稿の時点に戻る
    expect(deriveThreadActivity(thread, [reply("e1", "creator", 200), replyDeleted("e1")])).toEqual(
      initialThreadActivity(thread),
    );
  });

  it("スレッドに持たせた値は、全部そろっているときだけ読める（古いスレッドは null）", () => {
    expect(storedThreadActivity(thread)).toBeNull();
    const a = deriveThreadActivity(thread, [reply("e1", "creator", 200)]);
    const saved = withThreadActivity(thread, a);
    expect(storedThreadActivity(saved)).toEqual(a);
    const { replyCount: _dropped, ...partial } = saved;
    void _dropped;
    expect(storedThreadActivity(partial)).toBeNull();
  });
});

describe("未読（FB と同じ規則: 読んだ時刻が無い、または最後の動きより前）", () => {
  const activity = { lastActivityAt: 500, lastActivityBy: "creator", replyCount: 2 };

  it("読んだことが無い・読んだ後に動きがあれば未読。読んだ後に動きが無ければ既読", () => {
    expect(isThreadUnread(thread, activity, "reviewer", null)).toBe(true);
    expect(isThreadUnread(thread, activity, "reviewer", 499)).toBe(true);
    expect(isThreadUnread(thread, activity, "reviewer", 500)).toBe(false);
    expect(isThreadUnread(thread, activity, "reviewer", 900)).toBe(false);
  });

  it("自分の動きでは未読にしない（読んだ印が無くても）。ほかの人にとっては未読", () => {
    const mine = { ...activity, lastActivityBy: "reviewer" };
    expect(isThreadUnread(thread, mine, "reviewer", null)).toBe(false);
    expect(isThreadUnread(thread, mine, "creator", null)).toBe(true);
  });

  it("自動校正の指摘は、人の返信が付くまで未読にしない", () => {
    const quiet = { lastActivityAt: 100, lastActivityBy: "bot:proofreader", replyCount: 0 };
    expect(isThreadUnread(botThread, quiet, "reviewer", null)).toBe(false);
    const replied = { lastActivityAt: 200, lastActivityBy: "creator", replyCount: 1 };
    expect(isThreadUnread(botThread, replied, "reviewer", null)).toBe(true);
  });
});

describe("返信の通知の宛先", () => {
  const events = [
    reply("e1", "creator", 200),
    reply("e2", "manager", 300),
    reply("e3", "approver", 400),
    replyDeleted("e3"),
  ];

  it("投稿者とこれまでの返信者。返信した本人・メンションした人・削除した返信だけの人は除く", () => {
    expect(replyRecipients(thread, events, "creator")).toEqual(["reviewer", "manager"]);
    expect(replyRecipients(thread, events, "reviewer", ["manager"])).toEqual(["creator"]);
    expect(replyRecipients(thread, [], "reviewer")).toEqual([]);
    // 重複しない
    expect(
      replyRecipients(thread, [reply("a", "creator", 1), reply("b", "creator", 2)], "manager"),
    ).toEqual(["reviewer", "creator"]);
  });

  it("自動校正の指摘の投稿者（システム）には送らない", () => {
    expect(replyRecipients(botThread, [reply("a", "creator", 1)], "manager")).toEqual(["creator"]);
  });
});
