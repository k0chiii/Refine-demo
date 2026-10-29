import { describe, expect, it } from "vite-plus/test";
import {
  type AccountChannel,
  channelStatusOf,
  type DeliveryChannel,
  deliverableEmail,
  destinationsOf,
  normalizeNotificationPrefs,
  parseDestinationKey,
  type PushDevice,
  reachableChannels,
  SLACK_RECHECK_MS,
  type SlackLink,
  type SlackMembership,
  wantedChannels,
} from "../index.ts";

const T0 = 1_700_000_000_000;
const DUE = T0 + SLACK_RECHECK_MS;
const EMAIL = "a.b@example-org.jp";

const unresolved: SlackLink = { state: "unresolved" };
const linked: SlackLink = { state: "linked", memberId: "UA", checkedAt: T0 };
const notFound: SlackLink = { state: "not_found", checkedAt: T0 };
const cannotDm: SlackLink = { state: "cannot_dm", memberId: "UA", checkedAt: T0 };

const TEAM = "T0123ABCD";
const inTeam = (link: SlackLink): SlackMembership => ({ teamId: TEAM, link });

const phone: PushDevice = {
  id: "s1",
  endpoint: "https://fcm.googleapis.com/x",
  p256dh: "p",
  auth: "a",
};
const laptop: PushDevice = {
  id: "s2",
  endpoint: "https://web.push.apple.com/y",
  p256dh: "q",
  auth: "b",
};

describe("届け先のキー", () => {
  it("保存した文字列を、知っている形のときだけキーに戻す", () => {
    expect(parseDestinationKey("email")).toBe("email");
    expect(parseDestinationKey("slack")).toBe("slack");
    expect(parseDestinationKey("push:s1")).toBe("push:s1");
    for (const s of ["", "push:", "push", "sms", "Email", " email", "email "])
      expect(parseDestinationKey(s)).toBeNull();
  });

  it("届け先のキーはどれも、保存して読み戻すと同じキーになる", () => {
    const destinations = destinationsOf({
      channels: ["push", "email", "slack"],
      devices: [phone, laptop],
      email: EMAIL,
      slack: inTeam(linked),
      now: T0,
    });
    expect(destinations).toHaveLength(4);
    for (const d of destinations) expect(parseDestinationKey(d.key)).toBe(d.key);
  });
});

describe("届けうる経路と、この通知を届ける経路", () => {
  const all = new Set<DeliveryChannel>(["push", "email", "slack"]);
  const cases: [string, Set<DeliveryChannel>, AccountChannel[], boolean, DeliveryChannel[]][] = [
    ["秘密が無ければどこへも届けない", new Set(), ["email", "slack"], true, []],
    ["何もオンにせず端末も無ければ届けない", all, [], false, []],
    ["端末があれば端末へ", all, [], true, ["push"]],
    ["端末が無ければ、端末の秘密があっても端末へは届けない", new Set(["push"]), [], false, []],
    ["オンにしたメールへ", all, ["email"], false, ["email"]],
    ["オンにした Slack へ", all, ["slack"], false, ["slack"]],
    ["すべて", all, ["email", "slack"], true, ["push", "email", "slack"]],
    [
      "メールをオンにしても、メールの秘密が無ければ届けない",
      new Set(["push", "slack"]),
      ["email"],
      false,
      [],
    ],
    [
      "秘密のある経路でも、オンにしていなければ届けない",
      new Set(["email", "slack"]),
      ["email"],
      true,
      ["email"],
    ],
  ];

  it.each(cases)("%s", (_name, available, channels, hasPushDevice, expected) => {
    const prefs = normalizeNotificationPrefs({ channels });
    expect(reachableChannels({ prefs, available, hasPushDevice })).toEqual(expected);
    expect(wantedChannels({ kind: "mentioned", prefs, available, hasPushDevice })).toEqual(
      expected,
    );
  });

  it("止めた分類は、どの経路にも届けない。届けうる経路は分類によらない", () => {
    const prefs = normalizeNotificationPrefs({
      channels: ["email", "slack"],
      mutedCategories: ["reply"],
    });
    const input = { prefs, available: all, hasPushDevice: true };
    expect(wantedChannels({ ...input, kind: "comment_posted" })).toEqual([]);
    expect(wantedChannels({ ...input, kind: "mentioned" })).toEqual(["push", "email", "slack"]);
    expect(reachableChannels(input)).toEqual(["push", "email", "slack"]);
  });
});

describe("届け先", () => {
  const base = { devices: [] as PushDevice[], email: null, slack: inTeam(unresolved), now: T0 };

  it("端末は購読ごとに 1 つ。端末が無ければ無い", () => {
    expect(destinationsOf({ ...base, channels: ["push"], devices: [phone, laptop] })).toEqual([
      { channel: "push", key: "push:s1", device: phone },
      { channel: "push", key: "push:s2", device: laptop },
    ]);
    expect(destinationsOf({ ...base, channels: ["push"] })).toEqual([]);
  });

  it("メールは送れるアドレスがあるときだけ", () => {
    expect(destinationsOf({ ...base, channels: ["email"], email: EMAIL })).toEqual([
      { channel: "email", key: "email", to: EMAIL },
    ]);
    expect(destinationsOf({ ...base, channels: ["email"] })).toEqual([]);
  });

  it("Slack は、アドレスがあり、いま送るか引くときだけ。送り先は選んだワークスペース", () => {
    const slack = (link: SlackLink, now = T0, email: string | null = EMAIL) =>
      destinationsOf({ ...base, channels: ["slack"], email, slack: inTeam(link), now });
    const lookup = [{ channel: "slack", key: "slack", teamId: TEAM, email: EMAIL, memberId: null }];
    const post = [{ channel: "slack", key: "slack", teamId: TEAM, email: EMAIL, memberId: "UA" }];

    expect(slack(unresolved)).toEqual(lookup);
    expect(slack(linked)).toEqual(post);
    expect(slack(notFound, DUE - 1)).toEqual([]);
    expect(slack(notFound, DUE + 1)).toEqual(lookup);
    expect(slack(cannotDm, DUE - 1)).toEqual([]);
    expect(slack(cannotDm, DUE + 1)).toEqual(post);
    expect(slack(linked, T0, null)).toEqual([]);
    expect(slack(unresolved, T0, null)).toEqual([]);
  });

  it("Slack はワークスペースを選んでいない（登録が消えた）なら送らない", () => {
    expect(
      destinationsOf({ ...base, channels: ["slack", "email"], email: EMAIL, slack: null }),
    ).toEqual([{ channel: "email", key: "email", to: EMAIL }]);
  });

  it("経路に入っていなければ、宛先があっても届けない", () => {
    expect(
      destinationsOf({
        channels: [],
        devices: [phone],
        email: EMAIL,
        slack: inTeam(linked),
        now: T0,
      }),
    ).toEqual([]);
    expect(
      destinationsOf({
        channels: ["email"],
        devices: [phone],
        email: EMAIL,
        slack: inTeam(linked),
        now: T0,
      }),
    ).toEqual([{ channel: "email", key: "email", to: EMAIL }]);
  });
});

describe("送ってよいメールアドレス", () => {
  it("前後の空白を除き、小文字にそろえる", () => {
    expect(deliverableEmail(EMAIL)).toBe(EMAIL);
    expect(deliverableEmail("  A.B@Example-Org.JP \n")).toBe(EMAIL);
    expect(deliverableEmail("kenta@myexample.com")).toBe("kenta@myexample.com");
  });

  it("予約済みのドメインと、形の正しくないアドレスには送らない", () => {
    for (const raw of [
      "x@example.invalid",
      "mock-1@example.invalid",
      "x@example.com",
      "X@EXAMPLE.COM",
      "x@example.net",
      "x@sub.example.org",
      "x@foo.test",
      "x@foo.example",
      "x@foo.localhost",
      "x@localhost",
      "x.example-org.jp",
      "a b@example-org.jp",
      "a@b@example-org.jp",
      "@example-org.jp",
      "x@.jp",
      "x@example-org.",
      "",
      "   ",
      null,
      undefined,
    ])
      expect(deliverableEmail(raw)).toBeNull();
  });
});

describe("設定画面の経路の状態", () => {
  it("メールは送れるアドレスがあれば使える（Slack のワークスペースによらない）", () => {
    expect(channelStatusOf("email", EMAIL, inTeam(unresolved))).toBe("ready");
    expect(channelStatusOf("email", EMAIL, inTeam(notFound))).toBe("ready");
    expect(channelStatusOf("email", EMAIL, null)).toBe("ready");
    expect(channelStatusOf("email", null, inTeam(linked))).toBe("no_address");
  });

  it("Slack はアドレスが無ければ使えず、ワークスペースが無ければ選べず、あればそこでの状態", () => {
    expect(channelStatusOf("slack", null, inTeam(linked))).toBe("no_address");
    expect(channelStatusOf("slack", null, null)).toBe("no_address");
    expect(channelStatusOf("slack", EMAIL, null)).toBe("no_workspace");
    expect(channelStatusOf("slack", EMAIL, inTeam(unresolved))).toBe("unresolved");
    expect(channelStatusOf("slack", EMAIL, inTeam(linked))).toBe("ready");
    expect(channelStatusOf("slack", EMAIL, inTeam(notFound))).toBe("not_found");
    expect(channelStatusOf("slack", EMAIL, inTeam(cannotDm))).toBe("cannot_dm");
  });
});
