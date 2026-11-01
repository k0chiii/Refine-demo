import { describe, expect, it } from "vite-plus/test";
import {
  composeNotificationMessage,
  type Disclosure,
  type NotificationMessage,
  toEmail,
  toPushPayload,
  toSlackText,
} from "../index.ts";

const ORIGIN = "https://mf100.example.jp";
const ACTOR = "本郷 校正";
const DETAIL_ONLY = "本文だけの続き";

const n = {
  id: "n1",
  kind: "comment_posted",
  title: "新しいコメント",
  body: `「夏のポスター」第2版・${ACTOR}さん: 相談です（${DETAIL_ONLY}）`,
  workId: "work-secret",
  revisionId: "rev-secret",
  threadId: "thread-secret",
  createdAt: 1_700_000_000_000,
  preview: "相談です",
};
const open = { title: "夏のポスター" };

const rendered = {
  push: (m) => JSON.stringify(toPushPayload(m, 1)),
  email: (m) => {
    const e = toEmail(m, ORIGIN);
    return `${e.subject}\n${e.text}`;
  },
  slack: (m) => toSlackText(m, ORIGIN),
} satisfies Record<string, (m: NotificationMessage) => string>;

type Input = Parameters<typeof composeNotificationMessage>[0];

const withheldCases: { name: string; input: Input; disclosure: Disclosure; absent: string[] }[] = [
  {
    // 伏せ直す前の通知が渡っても、手がかり（ID）ごと出さない
    name: "今は見られない制作物",
    input: { notification: n, work: null, hidden: true, actorName: ACTOR },
    disclosure: "hidden",
    absent: [
      "夏のポスター",
      "本郷",
      "相談です",
      DETAIL_ONLY,
      "work-secret",
      "rev-secret",
      "thread-secret",
    ],
  },
  {
    name: "利用者が内容の表示を止めている",
    input: { notification: n, work: open, hidden: false, actorName: ACTOR, showPreview: false },
    disclosure: "withheld",
    absent: ["本郷", "相談です", DETAIL_ONLY],
  },
  {
    name: "ポリシーが内容の表示を止めている",
    input: {
      notification: n,
      work: open,
      hidden: false,
      actorName: ACTOR,
      policy: { showWorkTitle: true, showPreview: false, showDetail: true },
    },
    disclosure: "withheld",
    absent: ["本郷", "相談です", DETAIL_ONLY],
  },
  {
    // 送り主・抜粋は端末の通知と同じく載せる。本文は作品名を含むので載せない
    name: "ポリシーが制作物名を止めている",
    input: {
      notification: n,
      work: open,
      hidden: false,
      actorName: ACTOR,
      policy: { showWorkTitle: false, showPreview: true, showDetail: true },
    },
    disclosure: "full",
    absent: ["夏のポスター", DETAIL_ONLY],
  },
];

describe("外に出す内容: 伏せるものは、端末・メール・Slack のどれにも出さない", () => {
  for (const c of withheldCases)
    it(c.name, () => {
      const m = composeNotificationMessage(c.input);
      expect(m.disclosure).toBe(c.disclosure);
      expect(m.detail).toBeNull();
      for (const [channel, render] of Object.entries(rendered)) {
        const out = render(m);
        for (const s of c.absent) expect(out, `${channel}: ${s}`).not.toContain(s);
      }
    });

  it("見られない通知の行き先はトップで、メール・Slack のリンクもそこを指す", () => {
    const m = composeNotificationMessage({ notification: n, work: null, hidden: true });
    expect(m.path).toBe("/");
    expect(toPushPayload(m, 0).url).toBe("/");
    expect(toEmail(m, ORIGIN).text.split("\n")).toContain(`${ORIGIN}/`);
    expect(toSlackText(m, ORIGIN)).toContain(`<${ORIGIN}/|`);
  });
});

describe("外に出す内容: 出してよいとき", () => {
  const url = `${ORIGIN}/revisions/rev-secret?thread=thread-secret`;

  it("メールと Slack には本文と画面へのリンクを載せ、端末には本文を載せない", () => {
    const m = composeNotificationMessage({
      notification: n,
      work: open,
      hidden: false,
      actorName: ACTOR,
    });
    expect(m.disclosure).toBe("full");
    expect(m.detail).toContain(DETAIL_ONLY);
    const email = toEmail(m, ORIGIN);
    expect(email.text).toContain(DETAIL_ONLY);
    expect(email.text.split("\n")).toContain(url);
    const slack = toSlackText(m, ORIGIN);
    expect(slack).toContain(DETAIL_ONLY);
    expect(slack).toContain(`<${url}|`);
    for (const render of Object.values(rendered)) {
      expect(render(m)).toContain("夏のポスター");
      expect(render(m)).toContain("本郷");
      expect(render(m)).toContain("相談です");
    }
    expect(rendered.push(m)).not.toContain(DETAIL_ONLY);
  });

  it("ポリシーが本文を許していなければ（値が無いときも）、送り主と抜粋だけ載せる", () => {
    for (const policy of [
      { showWorkTitle: true, showPreview: true },
      { showWorkTitle: true, showPreview: true, showDetail: false },
    ]) {
      const m = composeNotificationMessage({
        notification: n,
        work: open,
        hidden: false,
        actorName: ACTOR,
        policy,
      });
      expect(m.detail).toBeNull();
      for (const render of [rendered.email, rendered.slack]) {
        expect(render(m)).not.toContain(DETAIL_ONLY);
        expect(render(m)).toContain("本郷");
      }
    }
  });

  it("長い本文は切る（メールは 2000 字・Slack は 1000 字まで）", () => {
    const m = composeNotificationMessage({
      notification: { ...n, body: "ゑ".repeat(5000) },
      work: open,
      hidden: false,
    });
    const email = toEmail(m, ORIGIN).text;
    expect(email).toContain("ゑ".repeat(1000));
    expect(email).not.toContain("ゑ".repeat(2001));
    expect(toSlackText(m, ORIGIN)).not.toContain("ゑ".repeat(1001));
  });
});

describe("経路ごとの安全な形", () => {
  it("Slack では、文面から全員への通知・メンション・リンクを作らせない", () => {
    const evil = "<!channel> <@U123> <https://evil.example|ここ> & more";
    const m = composeNotificationMessage({
      notification: { ...n, preview: evil, body: `「<!here>」第2版: ${evil}` },
      work: { title: "<!here>" },
      hidden: false,
      actorName: "<@U999>",
    });
    expect(m.detail).not.toBeNull();
    const text = toSlackText(m, ORIGIN);
    for (const s of ["<!channel>", "<@U123>", "<https://evil", "<!here>", "<@U999>"])
      expect(text).not.toContain(s);
    // Slack の制御は < で始まる。残る < は画面へのリンクの 1 つだけ
    expect(text.match(/</g)).toHaveLength(1);
    expect(text).toContain(`<${ORIGIN}/revisions/`);
    expect(text).not.toMatch(/&(?!amp;|lt;|gt;)/);
    expect(text).toContain("&lt;!channel&gt;");
  });

  it("メールの件名は改行を含まない 1 行で、120 字まで", () => {
    const m = composeNotificationMessage({
      notification: { ...n, preview: `一行目\r\n二行目\n${"あ".repeat(500)}` },
      work: { title: "夏の\r\nポスター\u2028" },
      hidden: false,
      actorName: "本郷\n校正",
    });
    const { subject } = toEmail(m, ORIGIN);
    expect(subject).not.toMatch(/[\r\n\u2028\u2029]/);
    expect(subject.length).toBeGreaterThan(0);
    expect(Array.from(subject).length).toBeLessThanOrEqual(120);
  });
});
