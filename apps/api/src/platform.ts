import { consumeProcessingQueue } from "./processingQueue";
import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";
import { Container } from "@cloudflare/containers";
import type { Id } from "@mf100/convex/dataModel";
import {
  createCloudflareProcessingClient,
  createConvexProcessingClient,
  type ProcessingCreateArgs,
} from "./adapters/processingClient";
import { GatewayError, gatewayStatus } from "./ports";
import baseWorker, { handleRequest } from "./index";
import { boundedText } from "./boundedBody";
import { backendSiteUrl } from "./env";
import { processFileJob, type ProcessingEnv } from "./processFileJob";
import { processingGateway } from "./processingGateway";
import { streamPlayback } from "./streamProcessing";

export class PreviewContainer extends Container {
  override defaultPort = 8080;
  override sleepAfter = "1m";
  override enableInternet = false;
}
export class FileWorkflow extends WorkflowEntrypoint<ProcessingEnv, { jobId: string }> {
  override async run(event: WorkflowEvent<{ jobId: string }>, step: WorkflowStep) {
    try {
      await step.do(
        "process authorized file",
        { retries: { limit: 2, delay: "5 seconds", backoff: "exponential" }, timeout: "5 minutes" },
        async () => {
          await processFileJob(this.env, event.payload.jobId);
          return null;
        },
      );
    } catch (error) {
      await step.do("record failure", async () =>
        processingGateway(backendSiteUrl(this.env), this.env.PROCESSING_SECRET)("fail", {
          jobId: event.payload.jobId as Id<"processingJobs">,
        }),
      );
      throw error;
    }
  }
}
async function processingRequest(
  request: Request,
  token: string,
  env: ProcessingEnv,
): Promise<Response> {
  try {
    return await processingRoutes(request, token, env);
  } catch (error) {
    // Cloudflare 版の拒否（forbidden など）は Convex 版と違い {code} で返るので、そのまま状態にする
    if (error instanceof GatewayError)
      return Response.json(
        { code: error.code, details: error.details },
        { status: gatewayStatus(error.code), headers: { "Cache-Control": "no-store" } },
      );
    throw error;
  }
}
async function processingRoutes(
  request: Request,
  token: string,
  env: ProcessingEnv,
): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname.split("/").filter(Boolean);
  const client =
    env.BACKEND === "cloudflare"
      ? createCloudflareProcessingClient(backendSiteUrl(env), token)
      : createConvexProcessingClient(env.CONVEX_URL, token);
  if (request.method === "POST" && url.pathname === "/processing/jobs") {
    const body = JSON.parse(await boundedText(request, 8192)) as ProcessingCreateArgs;
    const id = await client.create(body);
    await env.PROCESSING_QUEUE.send({ jobId: id });
    return Response.json({ jobId: id }, { status: 202, headers: { "Cache-Control": "no-store" } });
  }
  if (request.method === "POST" && url.pathname === "/processing/figma") {
    const body = JSON.parse(await boundedText(request, 8192)) as { itemId?: string };
    if (!body.itemId) return new Response(null, { status: 400 });
    const id = await client.create({
      kind: "figma",
      options: { itemId: body.itemId as Id<"uploadItems"> },
      consentToProcessing: true,
    });
    await env.PROCESSING_QUEUE.send({ jobId: id });
    return Response.json({ jobId: id }, { status: 202, headers: { "Cache-Control": "no-store" } });
  }
  const id = path[2];
  if (!id) return new Response(null, { status: 404 });
  // The public query checks the requesting viewer's current ACL for every derived fetch and HLS segment.
  const job = await client.get(id);
  if (request.method === "GET" && path[1] === "jobs")
    return Response.json(job, { headers: { "Cache-Control": "no-store" } });
  if (
    request.method === "GET" &&
    path[1] === "stream" &&
    job.state === "ready" &&
    job.output?.streamUid
  )
    return streamPlayback(
      env,
      job.output.streamUid,
      id,
      path.slice(3).join("/") || "manifest/video.m3u8",
      token,
    );
  if (request.method === "GET" && path[1] === "files" && job.state === "ready" && job.output?.key) {
    const object = await env.ASSETS.get(job.output.key);
    if (!object) return new Response(null, { status: 404 });
    return new Response(object.body, {
      headers: {
        "Content-Type": job.output.contentType ?? "application/octet-stream",
        "Content-Length": String(object.size),
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  }
  return new Response(null, { status: 404 });
}
export default {
  fetch(request: Request, env: ProcessingEnv, ctx: ExecutionContext) {
    return handleRequest(request, env, ctx, (request, token) =>
      processingRequest(request, token, env),
    );
  },
  async scheduled(event: ScheduledController, env: ProcessingEnv, ctx: ExecutionContext) {
    await baseWorker.scheduled(event, env, ctx);
    ctx.waitUntil(
      (async () => {
        const service = processingGateway(backendSiteUrl(env), env.PROCESSING_SECRET);
        for (const job of await service("cleanupCandidates", {})) {
          await env.ASSETS.delete(job.key);
          if (job.streamUid) {
            if (!env.STREAM_ACCOUNT_ID || !env.STREAM_API_TOKEN) continue;
            const response = await fetch(
              `https://api.cloudflare.com/client/v4/accounts/${env.STREAM_ACCOUNT_ID}/stream/${job.streamUid}`,
              { method: "DELETE", headers: { Authorization: `Bearer ${env.STREAM_API_TOKEN}` } },
            );
            if (!response.ok && response.status !== 404) continue;
          }
          await service("markCleaned", { jobId: job.jobId });
        }
      })(),
    );
  },
  queue: consumeProcessingQueue,
};
