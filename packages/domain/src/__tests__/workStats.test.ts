import { describe, expect, it } from "vite-plus/test";
import type { Team } from "../org/team.ts";
import { computeWorkStats, workMatchesTeam, workStatsToCsv } from "../work/workStats.ts";
import { HOUR, makeRevision, makeThread, makeWork, T0 } from "./fixtures.ts";

describe("制作物ごとの集計（A-4）", () => {
  const teams: Team[] = [
    { id: "pr", name: "広報局", kind: "bureau", order: 1, updatedAt: T0, updatedBy: "a" },
    {
      id: "design",
      name: "デザイン担当",
      kind: "team",
      parentId: "pr",
      order: 1,
      updatedAt: T0,
      updatedBy: "a",
    },
    { id: "ga", name: "総務局", kind: "bureau", order: 2, updatedAt: T0, updatedBy: "a" },
  ];
  it("局で絞るとその局と配下の担当、担当で絞るとその担当", () => {
    const work = makeWork({ productionTeamIds: ["design"] });
    expect(workMatchesTeam(work, "pr", teams)).toBe(true);
    expect(workMatchesTeam(work, "design", teams)).toBe(true);
    expect(workMatchesTeam(work, "ga", teams)).toBe(false);
    expect(
      workMatchesTeam(makeWork({ ownerTeamId: "ga", productionTeamIds: [] }), "ga", teams),
    ).toBe(true);
  });
  it("版・コメント・採否・校了日を数える（自動校正・持ち越しの写し・void の版は数えない）", () => {
    const r0 = makeRevision({ id: "r0", kind: "rough", sequence: 0, submittedAt: T0 });
    const r1 = makeRevision({ id: "r1", sequence: 1, submittedAt: T0 + HOUR });
    const r2 = makeRevision({ id: "r2", sequence: 2, submittedAt: T0 + 2 * HOUR });
    const rv = makeRevision({ id: "rv", sequence: 3, reviewState: "void" });
    const t = (id: string, revisionId: string, over = {}) => ({
      thread: makeThread({ id, revisionId, ...over }),
      events: [] as never[],
    });
    const row = computeWorkStats({
      work: makeWork({
        lifecycle: "finalized",
        ownerTeamId: "design",
        productionTeamIds: ["design", "ga"],
      }),
      teams,
      revisions: [r0, r1, r2, rv],
      threads: [
        t("a", "r1"),
        {
          thread: makeThread({ id: "b", revisionId: "r1", resolution: "rejected" }),
          events: [
            {
              threadId: "b",
              eventType: "decided",
              actorId: "creator",
              reason: "意図どおり",
              payload: { from: "open", to: "rejected" },
              createdAt: T0 + 3 * HOUR,
            },
          ],
        },
        t("c", "r1", { resolution: "deferred" }),
        t("d", "r2", { carriedFromThreadId: "c", resolution: "open" }),
        t("e", "r2", { authorId: "bot:proofreader", origin: { kind: "bot" } }),
        t("f", "rv"),
      ],
      approvals: [
        {
          workId: "work1",
          revisionId: "r2",
          actorId: "approver",
          action: "finalized",
          requiredChecksSnapshot: {},
          createdAt: T0 + 36 * HOUR,
        },
      ],
    });
    expect(row).toMatchObject({
      ownerTeam: "広報局 › デザイン担当",
      productionTeams: "広報局 › デザイン担当、総務局",
      revisionCount: 2,
      firstSubmittedAt: T0,
      finalizedAt: T0 + 36 * HOUR,
      daysToFinalize: 1.5,
      commentCount: 3,
      commentsPerRevision: "0版（ラフ） 0・第1版 3・第2版 0",
      rejectedCount: 1,
      deferredCount: 1,
      decisionReasons: "意図どおり",
    });
    const csv = workStatsToCsv([row]);
    expect(csv.split("\r\n")[0]).toContain("制作物名");
    expect(csv).toContain("2026-11-01");
  });
});
