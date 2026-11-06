import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { createCast, createHarness } from "../test/harness";
import * as provider from "./lib/ai/provider";

const content = JSON.stringify({
  type: "doc",
  content: [{ type: "paragraph", content: [{ type: "text", text: "五月祭" }] }],
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});
async function setup() {
  vi.stubEnv("ANTHROPIC_API_KEY", "test-no-network");
  const t = createHarness();
  const c = await createCast(t);
  const workId = (await c.manager.as.mutation(api.works.create, {
    title: "原稿",
    purpose: "案内",
    category: "文章",
    mediaType: "document",
    year: 100,
    creatorIds: [c.creator.id],
    approverId: c.approver.id,
  })) as Id<"works">;
  await c.creator.as.mutation(api.documents.save, {
    workId,
    title: "原稿",
    content,
    text: "五月祭",
    baseVersion: 0,
  });
  return { t, c, workId };
}
describe("AI Workflow", () => {
  it("明示同意を要求し、重複起動をまとめ、step の引数に本文を含めない", async () => {
    const { t, c, workId } = await setup();
    await expect(
      c.creator.as.mutation(api.aiWorkflow.start, {
        workId,
        draftVersion: 1,
        consentToTemporaryStorage: false,
      }),
    ).rejects.toThrow("consent");
    const jobId = (await c.creator.as.mutation(api.aiWorkflow.start, {
      workId,
      draftVersion: 1,
      consentToTemporaryStorage: true,
    })) as Id<"aiJobs">;
    expect(
      await c.creator.as.mutation(api.aiWorkflow.start, {
        workId,
        draftVersion: 1,
        consentToTemporaryStorage: true,
      }),
    ).toBe(jobId);
    const row = await t.run((ctx) => ctx.db.get(jobId));
    expect(JSON.stringify(row)).not.toContain("五月祭");
    expect(await c.stranger.as.query(api.aiWorkflow.get, { jobId })).toBeNull();
    vi.spyOn(provider, "createProvider").mockResolvedValue({
      name: "Test",
      model: "test",
      proofread: async () => [],
    });
    await t.action(internal.aiWorkflow.execute, { jobId });
    expect(await c.creator.as.query(api.aiWorkflow.get, { jobId })).toMatchObject({
      state: "completed",
      result: JSON.stringify({ candidates: [], provider: "Test", model: "test" }),
    });
  });
  it("外部呼出し後に原稿が変わると結果を採用せず、取消後も保存しない", async () => {
    const { t, c, workId } = await setup();
    const jobId = (await c.creator.as.mutation(api.aiWorkflow.start, {
      workId,
      draftVersion: 1,
      consentToTemporaryStorage: true,
    })) as Id<"aiJobs">;
    vi.spyOn(provider, "createProvider").mockResolvedValue({
      name: "Test",
      model: "test",
      proofread: async () => {
        await c.creator.as.mutation(api.documents.save, {
          workId,
          title: "原稿",
          content,
          text: "五月祭",
          baseVersion: 1,
        });
        return [];
      },
    });
    await t.action(internal.aiWorkflow.execute, { jobId });
    expect(await c.creator.as.query(api.aiWorkflow.get, { jobId })).toMatchObject({
      state: "failed",
      result: null,
    });
    await c.creator.as.mutation(api.aiWorkflow.cancel, { jobId });
    await t.mutation(internal.aiWorkflow.finish, { jobId, result: "must-not-save", failed: false });
    expect(await c.creator.as.query(api.aiWorkflow.get, { jobId })).toMatchObject({
      state: "cancelled",
      result: null,
    });
  });
});
