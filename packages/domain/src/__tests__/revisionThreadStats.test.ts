import { describe, expect, it } from "vite-plus/test";
import type { BotOrigin } from "../notation/autoProofread.ts";
import { revisionThreadStatsFromRevision, revisionThreadStatsOf } from "../dashboard/overview.ts";

describe("revisionThreadStatsOf", () => {
  it("未解決・自動校正未確認・全件を works.get と同じ規則で数える", () => {
    const bot = { kind: "bot" } as BotOrigin;
    expect(
      revisionThreadStatsOf([
        { resolution: "open" },
        { resolution: "acknowledged" },
        { resolution: "accepted" },
        { resolution: "resolved" },
        { resolution: "open", origin: bot },
        { resolution: "acknowledged", origin: bot },
        { resolution: "accepted", origin: bot },
      ]),
    ).toEqual({ unresolved: 6, openBot: 2, total: 7 });
  });

  it("版に 3 件が揃っているときだけキャッシュを返す", () => {
    expect(revisionThreadStatsFromRevision({})).toBeNull();
    expect(revisionThreadStatsFromRevision({ unresolvedCount: 1, openBotCount: 0 })).toBeNull();
    expect(
      revisionThreadStatsFromRevision({ unresolvedCount: 1, openBotCount: 0, threadCount: 2 }),
    ).toEqual({ unresolved: 1, openBot: 0, total: 2 });
  });
});
