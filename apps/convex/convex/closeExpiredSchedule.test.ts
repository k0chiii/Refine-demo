import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { createCast, createHarness, HOUR, uploadVerified } from "../test/harness";
import { setupWork } from "../test/flows";

const NOW = Date.UTC(2026, 10, 1, 9, 0, 0);

describe("受付終了は期限の時刻の予約で走る（cron なし）", () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: NOW });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("提出確定で予約した実行が、期限の時刻に版を閉じる", async () => {
    const t = createHarness();
    const cast = await createCast(t);
    const workId = await setupWork(t, cast);
    const deadlineAt = NOW + 48 * HOUR;
    const prepared = await cast.creator.as.mutation(api.submissions.prepare, {
      workId,
      kind: "standard",
      reviewType: "general",
      deadlineAt,
      changeSummary: "提出",
      focusNotes: "",
      items: [{ fileName: "a.pdf", mimeType: "application/pdf", type: "pdf", role: "source" }],
    });
    await uploadVerified(cast.creator, prepared.items[0]!.id, { size: 10, sha256: "a" });
    const { revisionId } = await cast.creator.as.mutation(api.submissions.confirm, {
      sessionId: prepared.sessionId as Id<"uploadSessions">,
    });
    const stateOf = () =>
      t.run(async (ctx) => {
        const r = await ctx.db.get(revisionId as Id<"revisions">);
        return { state: r?.reviewState, reason: r?.reviewClosedReason };
      });
    expect(await stateOf()).toEqual({ state: "open", reason: undefined });

    // 期限の前: 予約の実行はまだ走らず、版は受付中のまま
    await vi.advanceTimersByTimeAsync(47 * HOUR);
    await t.finishInProgressScheduledFunctions();
    expect(await stateOf()).toEqual({ state: "open", reason: undefined });

    // 期限の時刻: cron を動かさなくても閉じる
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(Date.now()).toBeGreaterThanOrEqual(deadlineAt);
    expect(await stateOf()).toEqual({ state: "closed", reason: "deadline" });
  });
});
