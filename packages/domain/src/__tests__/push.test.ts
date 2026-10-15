import { describe, expect, it } from "vite-plus/test";
import {
  buildPushPayload,
  DomainError,
  notificationPath,
  pushOutcome,
  validatePushSubscription,
} from "../index.ts";

const P256DH = `B${"A".repeat(86)}`; // 65 バイト
const AUTH = "A".repeat(22); // 16 バイト

describe("Web Push の購読の検証", () => {
  it("既知のプッシュサービスの https だけを受け付ける", () => {
    for (const endpoint of [
      "https://fcm.googleapis.com/fcm/send/abc",
      "https://web.push.apple.com/QGx",
      "https://updates.push.services.mozilla.com/wpush/v2/x",
      "https://wns2-par02p.notify.windows.com/w/?token=x",
    ])
      expect(validatePushSubscription({ endpoint, p256dh: P256DH, auth: AUTH }).endpoint).toBe(
        endpoint,
      );
    for (const endpoint of [
      "http://fcm.googleapis.com/fcm/send/abc",
      "https://evil.example.com/fcm.googleapis.com",
      "https://fcm.googleapis.com.evil.example/x",
      "https://user@fcm.googleapis.com/x",
      "not a url",
    ])
      expect(() => validatePushSubscription({ endpoint, p256dh: P256DH, auth: AUTH })).toThrow(
        DomainError,
      );
  });

  it("鍵の形と長さを確かめる", () => {
    const endpoint = "https://fcm.googleapis.com/fcm/send/abc";
    expect(() => validatePushSubscription({ endpoint, p256dh: "short", auth: AUTH })).toThrow(
      DomainError,
    );
    expect(() => validatePushSubscription({ endpoint, p256dh: P256DH, auth: "a+b/" })).toThrow(
      DomainError,
    );
  });
});

describe("Web Push の内容", () => {
  const n = {
    id: "n1",
    kind: "comment_created",
    title: "新しいコメント",
    workId: "w1",
    revisionId: "r1",
    threadId: "t1",
  };

  it("題名と制作物名だけを載せ、押すと同じ画面を開く", () => {
    const p = buildPushPayload({
      notification: n,
      work: { title: "夏のポスター", restricted: false },
      hidden: false,
      unread: 3,
    });
    expect(p).toEqual({
      title: "新しいコメント",
      body: "『夏のポスター』",
      url: "/revisions/r1?thread=t1",
      tag: "n1",
      badge: 3,
    });
  });

  it("非公開の制作物の名前と、見られない通知の内容は載せない", () => {
    expect(
      buildPushPayload({
        notification: n,
        work: { title: "極秘", restricted: true },
        hidden: false,
        unread: 1,
      }).body,
    ).toBe("非公開の制作物");
    const hidden = buildPushPayload({
      notification: { ...n, title: "閲覧できない制作物の通知です" },
      work: null,
      hidden: true,
      unread: 1,
    });
    expect(JSON.stringify(hidden)).not.toContain("r1");
    expect(hidden.url).toBe("/");
  });

  it("ポリシーで制作物名を載せないようにできる", () => {
    const p = buildPushPayload({
      notification: n,
      work: { title: "夏のポスター", restricted: false },
      hidden: false,
      unread: 0,
      policy: { showWorkTitle: false },
    });
    expect(p.body).not.toContain("夏のポスター");
  });

  it("行き先はアプリ内の通知と同じ", () => {
    expect(notificationPath({ kind: "feedback_posted", threadId: "f 1", workId: "w" })).toBe(
      "/feedback/f%201",
    );
    expect(notificationPath({ kind: "work_reopened", workId: "w1" })).toBe("/works/w1");
    expect(notificationPath({ kind: "rule_proposed" })).toBe("/notation?view=proposals");
  });

  it("宛先が無くなった・続けて失敗した購読は消す", () => {
    expect(pushOutcome(201, 3)).toEqual({ action: "keep", failureCount: 0 });
    expect(pushOutcome(410, 0).action).toBe("delete");
    expect(pushOutcome(500, 3)).toEqual({ action: "keep", failureCount: 4 });
    expect(pushOutcome(500, 4).action).toBe("delete");
  });
});
