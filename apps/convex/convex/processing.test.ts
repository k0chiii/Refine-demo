import { afterEach, expect, it, vi } from "vite-plus/test";
import type { Id } from "./_generated/dataModel";
import { api, internal } from "./_generated/api";
import { createCast, createHarness } from "../test/harness";
import { setupWork, submitFiles } from "../test/flows";

afterEach(() => vi.unstubAllEnvs());
it("派生処理は明示同意・作品権限・機密区分を確認し、権限剥奪後の採用を拒否する", async () => {
  vi.stubEnv("PROCESSING_ENABLED", "true");
  vi.stubEnv("PROCESSING_CAPABILITIES", "image,web-snapshot");
  const t = createHarness();
  const c = await createCast(t);
  const workId = await setupWork(t, c, { mediaType: "image" });
  const { artifacts } = await submitFiles(c, workId, [
    { fileName: "original.png", mimeType: "image/png", type: "image" },
  ]);
  const artifactId = artifacts[0]!.id as Id<"artifacts">;
  const options = { artifactId };
  await expect(
    c.creator.as.mutation(api.processing.create, {
      kind: "image",
      options,
      consentToProcessing: false,
    }),
  ).rejects.toThrow();
  await expect(
    c.stranger.as.mutation(api.processing.create, {
      kind: "image",
      options,
      consentToProcessing: true,
    }),
  ).rejects.toThrow();
  const jobId = await c.creator.as.mutation(api.processing.create, {
    kind: "image",
    options,
    consentToProcessing: true,
  });
  expect(
    await c.creator.as.mutation(api.processing.create, {
      kind: "image",
      options,
      consentToProcessing: true,
    }),
  ).toBe(jobId);
  const inspected = await t.query(internal.processing.inspect, { jobId });
  expect(inspected.source).toBeTruthy();
  await expect(
    t.mutation(internal.processing.complete, { jobId, output: { key: "original/replaced" } }),
  ).rejects.toThrow("invalid_derived_key");
  await c.manager.as.mutation(api.works.update, { workId, patch: { creatorIds: [c.stranger.id] } });
  await expect(t.query(internal.processing.inspect, { jobId })).rejects.toThrow();
  await expect(
    t.mutation(internal.processing.complete, { jobId, output: { key: `derived/${jobId}/result` } }),
  ).rejects.toThrow();
  await t.mutation(internal.processing.fail, { jobId });
  expect(await c.stranger.as.query(api.processing.get, { jobId })).toMatchObject({
    state: "failed",
    output: null,
  });
  const restricted = await setupWork(t, c);
  await expect(
    c.creator.as.mutation(api.processing.create, {
      kind: "web-snapshot",
      options: { workId: restricted, url: "https://example.com/" },
      consentToProcessing: true,
    }),
  ).rejects.toThrow("processing_not_allowed");
});
