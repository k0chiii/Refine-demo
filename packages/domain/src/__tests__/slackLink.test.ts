import { describe, expect, it } from "vite-plus/test";
import {
  nextSlackLink,
  SLACK_RECHECK_MS,
  type SlackLink,
  type SlackObservation,
  slackStep,
} from "../index.ts";

const T0 = 1_700_000_000_000;
const AT = T0 + 60_000;
const DUE = T0 + SLACK_RECHECK_MS;

const unresolved: SlackLink = { state: "unresolved" };
const linkedA: SlackLink = { state: "linked", memberId: "UA", checkedAt: T0 };
const notFound: SlackLink = { state: "not_found", checkedAt: T0 };
const cannotDmA: SlackLink = { state: "cannot_dm", memberId: "UA", checkedAt: T0 };

const foundA = (at: number): SlackObservation => ({ type: "lookup_found", memberId: "UA", at });
const foundB = (at: number): SlackObservation => ({ type: "lookup_found", memberId: "UB", at });
const missing = (at: number): SlackObservation => ({ type: "lookup_not_found", at });
const okA = (at: number): SlackObservation => ({ type: "post_ok", memberId: "UA", at });
const okB = (at: number): SlackObservation => ({ type: "post_ok", memberId: "UB", at });
const noDmA = (at: number): SlackObservation => ({ type: "post_cannot_dm", memberId: "UA", at });
const noDmB = (at: number): SlackObservation => ({ type: "post_cannot_dm", memberId: "UB", at });

describe("Slack の宛先の状態の移り方", () => {
  // "same" は前の状態そのもの（呼ぶ側は同一かどうかで保存を省く）
  const table: [string, SlackLink, SlackObservation, SlackLink | "same"][] = [
    [
      "未確認で見つかる",
      unresolved,
      foundA(AT),
      { state: "linked", memberId: "UA", checkedAt: AT },
    ],
    ["未確認で見つからない", unresolved, missing(AT), { state: "not_found", checkedAt: AT }],
    ["未確認に届いた送信の結果", unresolved, okA(AT), "same"],
    ["未確認に届いた DM できない結果", unresolved, noDmA(AT), "same"],

    ["つながっていて同じ人が見つかる", linkedA, foundA(AT), "same"],
    [
      "つながっていて別の人が見つかる",
      linkedA,
      foundB(AT),
      { state: "linked", memberId: "UB", checkedAt: AT },
    ],
    ["つながっていて見つからなくなる", linkedA, missing(AT), { state: "not_found", checkedAt: AT }],
    ["つながっていて送れた", linkedA, okA(AT), "same"],
    [
      "つながっていて DM できない",
      linkedA,
      noDmA(AT),
      { state: "cannot_dm", memberId: "UA", checkedAt: AT },
    ],
    ["別の人へ送れた古い結果", linkedA, okB(AT), "same"],
    ["別の人へ DM できなかった古い結果", linkedA, noDmB(AT), "same"],

    [
      "見つからなかったが見つかる",
      notFound,
      foundA(AT),
      { state: "linked", memberId: "UA", checkedAt: AT },
    ],
    ["見つからないまま", notFound, missing(AT), "same"],
    ["見つからない人に届いた送信の結果", notFound, okA(AT), "same"],
    ["見つからない人に届いた DM できない結果", notFound, noDmA(AT), "same"],

    [
      "DM できなかったが同じ人が見つかる",
      cannotDmA,
      foundA(AT),
      { state: "linked", memberId: "UA", checkedAt: AT },
    ],
    [
      "DM できなかったが別の人が見つかる",
      cannotDmA,
      foundB(AT),
      { state: "linked", memberId: "UB", checkedAt: AT },
    ],
    [
      "DM できなかったが見つからなくなる",
      cannotDmA,
      missing(AT),
      { state: "not_found", checkedAt: AT },
    ],
    [
      "DM できなかったが送れた",
      cannotDmA,
      okA(AT),
      { state: "linked", memberId: "UA", checkedAt: AT },
    ],
    ["DM できないまま", cannotDmA, noDmA(AT), "same"],
    ["DM できない人に別の人へ送れた古い結果", cannotDmA, okB(AT), "same"],
    ["DM できない人に別の人の古い結果", cannotDmA, noDmB(AT), "same"],
  ];

  it.each(table)("%s", (_name, prev, observation, expected) => {
    const next = nextSlackLink(prev, observation);
    if (expected === "same") expect(next).toBe(prev);
    else expect(next).toEqual(expected);
  });

  it("同じ状態のままでも、確かめ直す間が過ぎていれば確かめた時刻を新しくする", () => {
    expect(nextSlackLink(linkedA, foundA(DUE))).toEqual({ ...linkedA, checkedAt: DUE });
    expect(nextSlackLink(linkedA, okA(DUE))).toEqual({ ...linkedA, checkedAt: DUE });
    expect(nextSlackLink(notFound, missing(DUE))).toEqual({ ...notFound, checkedAt: DUE });
    expect(nextSlackLink(cannotDmA, noDmA(DUE))).toEqual({ ...cannotDmA, checkedAt: DUE });
  });

  it("確かめ直す間の手前では、同じ状態なら前の状態そのものを返す", () => {
    for (const [prev, observation] of [
      [linkedA, foundA(DUE - 1)],
      [linkedA, okA(DUE - 1)],
      [notFound, missing(DUE - 1)],
      [cannotDmA, noDmA(DUE - 1)],
    ] as const)
      expect(nextSlackLink(prev, observation)).toBe(prev);
  });

  it("別の人への古い結果は、間が過ぎていても前の状態を変えない", () => {
    expect(nextSlackLink(linkedA, okB(DUE + 1))).toBe(linkedA);
    expect(nextSlackLink(cannotDmA, noDmB(DUE + 1))).toBe(cannotDmA);
  });
});

describe("Slack でいま何をするか", () => {
  it("未確認なら引き、つながっていればいつでも送る", () => {
    expect(slackStep(unresolved, T0)).toEqual({ do: "lookup" });
    expect(slackStep(linkedA, T0)).toEqual({ do: "post", memberId: "UA" });
    expect(slackStep(linkedA, T0 + 10 * SLACK_RECHECK_MS)).toEqual({ do: "post", memberId: "UA" });
  });

  it("見つからなかった人は、確かめ直す間が過ぎてから引き直す", () => {
    expect(slackStep(notFound, DUE - 1)).toEqual({ do: "skip" });
    expect(slackStep(notFound, DUE)).toEqual({ do: "lookup" });
    expect(slackStep(notFound, DUE + 1)).toEqual({ do: "lookup" });
  });

  it("DM できなかった人は、確かめ直す間が過ぎてから送り直す", () => {
    expect(slackStep(cannotDmA, DUE - 1)).toEqual({ do: "skip" });
    expect(slackStep(cannotDmA, DUE)).toEqual({ do: "post", memberId: "UA" });
    expect(slackStep(cannotDmA, DUE + 1)).toEqual({ do: "post", memberId: "UA" });
  });

  it("確かめ直して同じ結果なら、そこからまた間を置く", () => {
    const later = DUE + 1;
    const stillMissing = nextSlackLink(notFound, missing(later));
    expect(slackStep(stillMissing, later + 1)).toEqual({ do: "skip" });
    expect(slackStep(stillMissing, later + SLACK_RECHECK_MS)).toEqual({ do: "lookup" });

    const stillNoDm = nextSlackLink(cannotDmA, noDmA(later));
    expect(slackStep(stillNoDm, later + 1)).toEqual({ do: "skip" });
    expect(slackStep(stillNoDm, later + SLACK_RECHECK_MS)).toEqual({
      do: "post",
      memberId: "UA",
    });
  });
});
