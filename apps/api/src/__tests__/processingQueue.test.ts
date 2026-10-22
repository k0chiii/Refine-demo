import { afterEach, expect, it, vi } from "vite-plus/test";
import { consumeProcessingQueue } from "../processingQueue";
import type { ProcessingEnv } from "../processFileJob";
afterEach(() => vi.unstubAllGlobals());
it("Queue/R2 event は認可済みジョブだけを復旧し、重複をまとめ、一時障害だけ再試行する", async () => {
  const create = vi.fn(async () => ({}));
  const status = vi.fn(async () => ({ status: "running" }));
  const env = {
    CONVEX_SITE_URL: "https://backend.invalid",
    PROCESSING_SECRET: "x".repeat(32),
    FILE_WORKFLOW: { create, get: async () => ({ status }) },
  } as unknown as ProcessingEnv;
  const response = vi.fn(async () => Response.json({ job: { state: "queued" } }));
  vi.stubGlobal("fetch", response);
  const deliver = async (body: unknown) => {
    const ack = vi.fn();
    const retry = vi.fn();
    await consumeProcessingQueue(
      { messages: [{ body, ack, retry }] } as unknown as MessageBatch<unknown>,
      env,
    );
    return { ack, retry };
  };
  expect((await deliver({ object: { key: "uploads/original" } })).ack).toHaveBeenCalled();
  expect(create).not.toHaveBeenCalled();
  expect((await deliver({ object: { key: "derived/job/result" } })).ack).toHaveBeenCalled();
  expect(create).toHaveBeenCalledWith({ id: "job", params: { jobId: "job" } });
  create.mockRejectedValueOnce(new Error("exists"));
  expect((await deliver({ jobId: "job" })).ack).toHaveBeenCalled();
  expect(status).toHaveBeenCalled();
  response.mockResolvedValueOnce(new Response(null, { status: 409 }));
  expect((await deliver({ jobId: "revoked" })).ack).toHaveBeenCalled();
  response.mockResolvedValueOnce(new Response(null, { status: 503 }));
  expect((await deliver({ jobId: "job" })).retry).toHaveBeenCalledWith({ delaySeconds: 30 });
});
