import { describe, expect, it } from "vite-plus/test";
import { availableChannels, deliveryConfigFromEnv, deliveryEnvOf } from "./channels.ts";

const VAPID = {
  VAPID_PUBLIC_KEY: "pub",
  VAPID_PRIVATE_KEY: "priv",
  VAPID_SUBJECT: "mailto:ops@example.invalid",
};
const FRONTEND = { FRONTEND_URL: "https://refine.example.org" };
const EMAIL = { RESEND_API_KEY: "re_key", NOTIFY_EMAIL_FROM: "MF100 <notify@mail.example.org>" };
const MEICHAN = "https://internal.gogatsusai.jp/slackbot/may";
const SLACK = { SLACK_BASE_URL: MEICHAN };

const channelsOf = (env: Record<string, string | undefined>) => [
  ...availableChannels(deliveryConfigFromEnv(env)),
];

describe("外への通知の経路ごとの秘密（env）", () => {
  it.each([
    ["何も無い", {}, []],
    ["VAPID だけ", VAPID, ["push"]],
    ["VAPID が欠けている", { ...VAPID, VAPID_SUBJECT: " " }, []],
    ["メールの鍵と送信元と FRONTEND_URL", { ...EMAIL, ...FRONTEND }, ["email"]],
    ["メールに FRONTEND_URL が無い", EMAIL, []],
    ["メールに送信元が無い", { ...FRONTEND, RESEND_API_KEY: "re_key" }, []],
    ["メールの送信元にアドレスが無い", { ...EMAIL, ...FRONTEND, NOTIFY_EMAIL_FROM: "MF100" }, []],
    ["メールの鍵が無い", { ...FRONTEND, NOTIFY_EMAIL_FROM: EMAIL.NOTIFY_EMAIL_FROM }, []],
    ["めいちゃんの URL と FRONTEND_URL", { ...SLACK, ...FRONTEND }, ["slack"]],
    ["Slack に FRONTEND_URL が無い", SLACK, []],
    [
      "めいちゃんの URL が URL でない",
      { ...FRONTEND, SLACK_BASE_URL: "internal.gogatsusai.jp" },
      [],
    ],
    [
      "めいちゃんの URL が http(s) でない",
      { ...FRONTEND, SLACK_BASE_URL: "ftp://example.org/may" },
      [],
    ],
    ["めいちゃんの URL が空", { ...FRONTEND, SLACK_BASE_URL: " " }, []],
    [
      "廃止した Slack のトークンだけでは使わない",
      { ...FRONTEND, SLACK_BOT_TOKEN: "xoxb-1-2-abc" },
      [],
    ],
    ["FRONTEND_URL が URL でない", { ...EMAIL, ...SLACK, FRONTEND_URL: "refine.example.org" }, []],
    ["すべて", { ...VAPID, ...EMAIL, ...SLACK, ...FRONTEND }, ["push", "email", "slack"]],
  ] satisfies [string, Record<string, string>, string[]][])("%s", (_name, env, expected) => {
    expect(channelsOf(env)).toEqual(expected);
  });

  it("FRONTEND_URL は前後の空白と末尾の / を除いてリンクの前につける", () => {
    expect(
      deliveryConfigFromEnv({ FRONTEND_URL: " https://refine.example.org/app/ " }).origin,
    ).toBe("https://refine.example.org/app");
    expect(deliveryConfigFromEnv({}).origin).toBeNull();
  });

  it("めいちゃんの URL は前後の空白と末尾の / を除き、そのまま連結の前に使う", () => {
    expect(deliveryConfigFromEnv({ ...FRONTEND, SLACK_BASE_URL: ` ${MEICHAN}/ ` }).slack).toEqual({
      baseUrl: MEICHAN,
    });
  });

  it("計画に渡す環境は経路とリンクの前だけで、秘密を含まない", () => {
    const env = deliveryEnvOf(deliveryConfigFromEnv({ ...VAPID, ...EMAIL, ...SLACK, ...FRONTEND }));
    expect(Object.keys(env).sort()).toEqual(["available", "origin"]);
    expect([...env.available]).toEqual(["push", "email", "slack"]);
    expect(env.origin).toBe(FRONTEND.FRONTEND_URL);
  });
});
