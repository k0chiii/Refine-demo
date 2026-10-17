import { api } from "./_generated/api";
import { describe, expect, it, vi } from "vite-plus/test";
import { createCast, createHarness } from "../test/harness";
import { setupWork, submitFiles } from "../test/flows";

const code = (c: string) => expect.objectContaining({ data: expect.objectContaining({ code: c }) });

describe("Convex 統合: 提出時の自動校正", () => {
  it("提出で待ち状態の実行ができ、送った文字をサーバーで照合して「自動校正」の指摘になる", async () => {
    vi.useFakeTimers({ now: Date.UTC(2026, 10, 1, 9), toFake: ["Date"] });
    const t = createHarness();
    const cast = await createCast(t);
    await cast.admin.as.mutation(api.notation.save, {
      rule: {
        ruleId: "A2-0002",
        categoryCode: "A2",
        title: "お問い合わせ",
        description: "送り仮名を省略しない",
        correct: ["お問い合わせ"],
        incorrect: ["お問合せ"],
        patterns: [],
        exceptions: [],
        language: "ja",
        scopes: [],
        years: [],
        priority: 0,
        strictness: "required",
        enabled: true,
      },
    });
    const workId = await setupWork(t, cast, { mediaType: "document", notationCategories: ["A2"] });
    const { revisionId, artifacts } = await submitFiles(cast, workId, [
      { fileName: "本文.txt", mimeType: "text/plain", type: "document" },
    ]);
    const view = await cast.creator.as.query(api.proofreading.run, { revisionId });
    expect(view.run!.status).toBe("pending");
    expect(view.canRun).toBe(true);
    const runId = view.run!.id;
    const artifactId = artifacts[0]!.id;
    await expect(
      cast.stranger.as.mutation(api.proofreading.claim, { runId, artifactId }),
    ).rejects.toThrow(code("forbidden"));
    expect(
      (await cast.creator.as.mutation(api.proofreading.claim, { runId, artifactId })).claimed,
    ).toBe(true);
    const res = await cast.creator.as.mutation(api.proofreading.submit, {
      runId,
      artifactId,
      segments: [{ kind: "text", text: "お問合せは受付まで。お問い合わせ" }],
    });
    expect(res.created).toBe(1);
    const rev = await cast.reviewer.as.query(api.revisions.get, { revisionId });
    const bot = rev.threads.find((x) => x.origin);
    expect(bot!.author!.name).toBe("自動校正");
    expect(bot!.anchor).toMatchObject({ type: "text_range", start: 0, end: 4, quote: "お問合せ" });
    expect((await cast.creator.as.query(api.proofreading.run, { revisionId })).run!.status).toBe(
      "done",
    );
    vi.useRealTimers();
  });
});
