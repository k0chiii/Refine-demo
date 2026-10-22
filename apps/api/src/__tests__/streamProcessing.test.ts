import { afterEach, expect, it, vi } from "vite-plus/test";
import { uploadStream } from "../streamProcessing";
import type { ProcessingJob } from "../processingGateway";
import type { ProcessingEnv } from "../processFileJob";
afterEach(() => vi.unstubAllGlobals());
it("Stream の署名必須設定を確認できるまで原本の bytes を送らない", async () => {
  const uid = "a".repeat(32);
  const get = vi.fn();
  const env = {
    CONVEX_SITE_URL: "https://backend.invalid",
    PROCESSING_SECRET: "x".repeat(32),
    STREAM_ACCOUNT_ID: "b".repeat(32),
    STREAM_API_TOKEN: "test-only",
    ASSETS: { head: async () => ({ size: 5 }), get },
  } as unknown as ProcessingEnv;
  const job = {
    source: "original",
    job: {
      _id: "job",
      streamUid: uid,
      streamUploadUrl: "https://upload.videodelivery.net/private-upload",
    },
  } as unknown as ProcessingJob;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_input: unknown, init?: RequestInit) =>
      init?.method === "POST"
        ? Response.json({ success: true })
        : Response.json({ result: { requireSignedURLs: false } }),
    ),
  );
  await expect(uploadStream(env, job)).rejects.toThrow("stream_privacy_not_confirmed");
  expect(get).not.toHaveBeenCalled();
});
