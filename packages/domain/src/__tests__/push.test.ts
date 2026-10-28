import { describe, expect, it } from "vite-plus/test";
import {
  clipPushText,
  composeNotificationMessage,
  DomainError,
  notificationPath,
  PUSH_BODY_MAX,
  PUSH_TITLE_MAX,
  pushOutcome,
  pushTagOf,
  toPushPayload,
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
  const pushOf = ({
    unread,
    ...input
  }: Parameters<typeof composeNotificationMessage>[0] & { unread: number }) =>
    toPushPayload(composeNotificationMessage(input), unread);
  const n = {
    id: "n1",
    kind: "comment_posted",
    title: "新しいコメント",
    // 本文に制作物名・送り主・抜粋があっても、端末には載らない
    body: "『夏のポスター』第2版・本郷 校正さん: 相談です",
    workId: "w1",
    revisionId: "r1",
    threadId: "t1",
    createdAt: 1_700_000_000_000,
    preview: "相談です",
  };
  const open = { title: "夏のポスター", restricted: false };

  it("題名は制作物名、本文は送り主と抜粋。押すと同じ画面を開く", () => {
    const p = pushOf({
      notification: n,
      work: open,
      hidden: false,
      actorName: "本郷 校正",
      unread: 3,
    });
    expect(p.title).toContain("夏のポスター");
    expect(p.body).toContain("本郷 校正");
    expect(p.body).toContain("相談です");
    expect(p).toMatchObject({
      url: "/revisions/r1?thread=t1",
      id: "n1",
      badge: 3,
      createdAt: 1_700_000_000_000,
    });
  });

  it("同じスレッドの通知は同じ印でまとまり、スレッドが無ければ制作物、それも無ければ通知の ID", () => {
    const tag = (x: object) =>
      pushOf({
        notification: { ...n, ...x },
        work: open,
        hidden: false,
        unread: 0,
      }).tag;
    expect(tag({ id: "n1" })).toBe(tag({ id: "n2" }));
    expect(tag({})).toBe("t1");
    expect(tag({ threadId: undefined })).toBe("w1");
    expect(tag({ threadId: undefined, workId: undefined })).toBe("n1");
    expect(pushTagOf({ id: "n9" })).toBe("n9");
  });

  it("制作物の無い通知は通知の題名を題名にし、送り主か抜粋だけでも本文を作る", () => {
    const base = { id: "n3", kind: "rule_proposed", title: "提案が届きました", body: "" };
    const only = (extra: object, actorName: string | null) =>
      pushOf({
        notification: { ...base, ...extra },
        work: null,
        hidden: false,
        actorName,
        unread: 1,
      });
    expect(only({}, "山田")).toMatchObject({
      title: base.title,
      tag: "n3",
      url: "/notation?view=proposals",
    });
    expect(only({}, "山田").body).toContain("山田");
    expect(only({ preview: "追加です" }, null).body).toContain("追加です");
    expect(only({}, null).body.length).toBeGreaterThan(0);
  });

  it("長い題名・本文は切る", () => {
    const p = pushOf({
      notification: { ...n, preview: "あ".repeat(500) },
      work: { title: "題".repeat(300), restricted: false },
      hidden: false,
      actorName: "本郷",
      unread: 0,
    });
    expect(Array.from(p.title).length).toBeLessThanOrEqual(PUSH_TITLE_MAX);
    expect(Array.from(p.body).length).toBeLessThanOrEqual(PUSH_BODY_MAX);
    expect(clipPushText("😀".repeat(10), 4)).toBe("😀😀😀…");
  });

  it("内容の表示を止めると、送り主と抜粋は載せず、題名は決まった文言になる", () => {
    const input = { notification: n, work: open, hidden: false, actorName: "本郷 校正", unread: 1 };
    const shown = pushOf(input);
    for (const off of [
      pushOf({ ...input, showPreview: false }),
      pushOf({ ...input, policy: { showWorkTitle: true, showPreview: false } }),
    ]) {
      const text = JSON.stringify([off.title, off.body]);
      expect(text).not.toContain("本郷");
      expect(text).not.toContain("相談です");
      expect(off.title).not.toBe(shown.title);
      expect(off.body).toContain("夏のポスター"); // 制作物名は従来どおり（ポリシーが許すとき）
      expect(off.tag).toBe("t1");
    }
  });

  it("非公開の制作物の名前・送り主・抜粋と、見られない通知の内容は載せない", () => {
    const restricted = pushOf({
      notification: n,
      work: { title: "極秘", restricted: true },
      hidden: false,
      actorName: "本郷 校正",
      unread: 1,
    });
    expect(restricted.body).toBe("非公開の制作物");
    expect(JSON.stringify(restricted)).not.toMatch(/極秘|本郷|相談です/);
    // 内容の表示を止めていても、非公開の制作物名は出ない
    const restrictedOff = pushOf({
      notification: n,
      work: { title: "極秘", restricted: true },
      hidden: false,
      showPreview: false,
      unread: 1,
    });
    expect(JSON.stringify(restrictedOff)).not.toContain("極秘");
    const hidden = pushOf({
      notification: {
        id: "n1",
        kind: "comment_posted",
        title: "閲覧できない制作物の通知です",
        body: "",
        createdAt: 1,
      },
      work: null,
      hidden: true,
      actorName: "本郷 校正",
      unread: 1,
    });
    expect(JSON.stringify(hidden)).not.toMatch(/r1|t1|w1|本郷|相談です/);
    expect(hidden.url).toBe("/");
    expect(hidden.tag).toBe("n1");
  });

  it("ポリシーで制作物名を載せないようにできる", () => {
    const p = pushOf({
      notification: n,
      work: open,
      hidden: false,
      actorName: "本郷 校正",
      unread: 0,
      policy: { showWorkTitle: false, showPreview: true },
    });
    expect(JSON.stringify(p)).not.toContain("夏のポスター");
  });

  it("行き先はアプリ内の通知と同じ", () => {
    expect(
      notificationPath({ kind: "comment_posted", workId: "w", revisionId: "r 1", threadId: "t 1" }),
    ).toBe("/revisions/r%201?thread=t%201");
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
