import type { Id } from "@mf100/convex/dataModel";
import { processingGateway } from "./processingGateway";
import type { ProcessingEnv } from "./processFileJob";

/** Both explicit jobs and R2 events may recover a missing workflow, but neither carries authorization. */
export async function consumeProcessingQueue(
  batch: MessageBatch<unknown>,
  env: ProcessingEnv,
): Promise<void> {
  for (const message of batch.messages) {
    const body =
      message.body && typeof message.body === "object"
        ? (message.body as { jobId?: unknown; object?: { key?: unknown } })
        : {};
    const key = body.object?.key;
    const id =
      typeof body.jobId === "string"
        ? body.jobId
        : typeof key === "string" && /^derived\/[A-Za-z0-9_-]{1,100}\/result$/.test(key)
          ? key.split("/")[1]
          : undefined;
    if (!id || !/^[A-Za-z0-9_-]{1,100}$/.test(id)) {
      message.ack();
      continue;
    }
    try {
      const info = await processingGateway(env.CONVEX_SITE_URL, env.PROCESSING_SECRET)("inspect", {
        jobId: id as Id<"processingJobs">,
      });
      if (info.job.state !== "ready") {
        try {
          await env.FILE_WORKFLOW.create({ id, params: { jobId: id } });
        } catch {
          await (await env.FILE_WORKFLOW.get(id)).status();
        }
      }
      message.ack();
    } catch (error) {
      if (error instanceof Error && error.message === "processing_rejected") message.ack();
      else message.retry({ delaySeconds: 30 });
    }
  }
}
