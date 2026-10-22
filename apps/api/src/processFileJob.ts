import puppeteer from "@cloudflare/puppeteer";
import type { Bindings } from "./env";
import { createFigmaClient } from "./adapters/figmaClient";
import { outputKey, publicSnapshotUrl } from "./processingSecurity";
import { processingGateway } from "./processingGateway";
import type { Id } from "@mf100/convex/dataModel";

export interface ProcessingEnv extends Bindings {
  PROCESSING_SECRET: string;
  PROCESSING_QUEUE: Queue<{ jobId: string }>;
  FILE_WORKFLOW: Workflow<{ jobId: string }>;
  IMAGES?: ImagesBinding;
  MEDIA?: MediaBinding;
  BROWSER?: Fetcher;
  CONVERTER?: DurableObjectNamespace;
  SNAPSHOT_ALLOWED_HOSTS?: string;
  STREAM_ACCOUNT_ID?: string;
  STREAM_API_TOKEN?: string;
}
const MAX_DERIVED_BYTES = 20_000_000;
async function putDerived(
  env: ProcessingEnv,
  key: string,
  body: ReadableStream<Uint8Array>,
  contentType: string,
) {
  let size = 0;
  const bounded = body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        size += chunk.length;
        if (size > MAX_DERIVED_BYTES) throw new Error("derived_file_too_large");
        controller.enqueue(chunk);
      },
    }),
  );
  const result = await env.ASSETS.put(key, bounded, {
    httpMetadata: { contentType },
    onlyIf: { etagDoesNotMatch: "*" },
  });
  // Retries reuse an existing immutable derived object.
  if (result) return result.size;
  const existing = await env.ASSETS.head(key);
  if (!existing) throw new Error("derived_file_missing");
  return existing.size;
}

export async function processFileJob(env: ProcessingEnv, id: string): Promise<void> {
  const service = processingGateway(env.CONVEX_SITE_URL, env.PROCESSING_SECRET);
  const jobId = id as Id<"processingJobs">;
  const info = await service("inspect", { jobId });
  if (info.job.state === "ready") return;
  const key = outputKey(id);
  const time = info.job.options.time ?? 0;
  const loadSource = async () => {
    // Recheck ACL before every external read/transform, including a retry.
    const current = await service("inspect", { jobId });
    if (!current.source) throw new Error("source_missing");
    const source = await env.ASSETS.get(current.source);
    if (!source || source.customMetadata?.["mf100-encoding"]) throw new Error("unsupported_source");
    return source;
  };
  if (info.job.kind === "figma") {
    if (!env.FIGMA_ACCESS_TOKEN || !info.target || info.origin?.kind !== "figma")
      throw new Error("figma_not_configured");
    if (!info.adopted) {
      let object = await env.ASSETS.head(info.target.objectKey);
      if (!object) {
        const client = createFigmaClient(env.FIGMA_ACCESS_TOKEN);
        const nodes = await client.getNodes(info.origin.fileKey, [info.origin.nodeId]);
        const node = nodes.nodes.get(info.origin.nodeId);
        if (!node?.box) throw new Error("figma_node_missing");
        const urls = await client.renderImages(
          info.origin.fileKey,
          [info.origin.nodeId],
          info.origin.scale,
        );
        const url = urls.get(info.origin.nodeId);
        if (!url) throw new Error("figma_render_failed");
        const bytes = await client.download(url);
        if (bytes.byteLength > MAX_DERIVED_BYTES) throw new Error("figma_image_too_large");
        const sha = [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))]
          .map((n) => n.toString(16).padStart(2, "0"))
          .join("");
        const meta = {
          nodeName: node.name,
          box: node.box,
          ...(nodes.version ? { figmaVersion: nodes.version } : {}),
          ...(nodes.lastModified ? { lastModified: nodes.lastModified } : {}),
        };
        // The original attempt key is write-once, even if a timeout causes overlapping executions.
        object =
          (await env.ASSETS.put(info.target.objectKey, bytes, {
            sha256: sha,
            httpMetadata: { contentType: "image/png" },
            customMetadata: { sha256: sha, figma: JSON.stringify(meta) },
            onlyIf: { etagDoesNotMatch: "*" },
          })) ?? (await env.ASSETS.head(info.target.objectKey));
      }
      if (!object?.customMetadata?.sha256 || !object.customMetadata.figma)
        throw new Error("figma_metadata_missing");
      const result = await service("figmaComplete", {
        jobId,
        size: object.size,
        sha256: object.customMetadata.sha256,
        figma: JSON.parse(object.customMetadata.figma),
      });
      if (result.status !== "verified") throw new Error("figma_verification_failed");
    }
    await service("complete", { jobId, output: {} });
    return;
  }
  if (info.job.kind === "image") {
    if (!env.IMAGES) throw new Error("images_not_configured");
    const source = await loadSource();
    if (source.size > MAX_DERIVED_BYTES) throw new Error("image_too_large");
    const metadata = await env.IMAGES.info(source.body);
    if (
      !("width" in metadata) ||
      !metadata.width ||
      !metadata.height ||
      metadata.width * metadata.height > 100_000_000
    )
      throw new Error("image_dimensions_unsupported");
    const content = await loadSource();
    const output = await env.IMAGES.input(content.body)
      .transform({ width: 1600, fit: "scale-down" })
      .output({ format: "image/png" });
    const size = await putDerived(env, key, output.image(), "image/png");
    const scale = Math.min(1, 1600 / metadata.width);
    await service("complete", {
      jobId,
      output: {
        key,
        contentType: "image/png",
        size,
        width: Math.round(metadata.width * scale),
        height: Math.round(metadata.height * scale),
      },
    });
    return;
  }
  if (info.job.kind === "video-frame") {
    if (!env.MEDIA) throw new Error("media_not_configured");
    const source = await loadSource();
    const transformed = env.MEDIA.input(source.body).output({
      mode: "frame",
      time: `${time}s`,
      format: "png",
    });
    const size = await putDerived(env, key, await transformed.media(), "image/png");
    await service("complete", { jobId, output: { key, contentType: "image/png", size, time } });
    return;
  }
  if (info.job.kind === "web-snapshot") {
    if (!env.BROWSER) throw new Error("browser_not_configured");
    const hosts = (env.SNAPSHOT_ALLOWED_HOSTS ?? "")
      .split(",")
      .map((h) => h.trim().toLowerCase())
      .filter(Boolean);
    const url = publicSnapshotUrl(info.job.options.url ?? "", hosts);
    const browser = await puppeteer.launch(env.BROWSER);
    try {
      const context = await browser.createBrowserContext();
      const page = await context.newPage();
      await page.setJavaScriptEnabled(false);
      await page.setViewport({ width: 1280, height: 720, deviceScaleFactor: 1 });
      await page.setRequestInterception(true);
      page.on("request", (request) => {
        try {
          publicSnapshotUrl(request.url(), hosts);
          void request.continue();
        } catch {
          void request.abort();
        }
      });
      await page.goto(url.href, { waitUntil: "networkidle2", timeout: 15_000 });
      publicSnapshotUrl(page.url(), hosts);
      // Fixed viewport coordinates; no credentials, cookies, arbitrary scripts or scrolling past the captured area.
      const bytes = await page.screenshot({ type: "png", fullPage: false });
      await service("inspect", { jobId });
      const size = await putDerived(
        env,
        key,
        new Blob([new Uint8Array(bytes)]).stream(),
        "image/png",
      );
      await service("complete", {
        jobId,
        output: { key, contentType: "image/png", size, width: 1280, height: 720 },
      });
    } finally {
      await browser.close();
    }
    return;
  }
  if (info.job.kind === "container-preview") {
    if (!env.CONVERTER) throw new Error("container_not_configured");
    const source = await loadSource();
    if (source.size > MAX_DERIVED_BYTES) throw new Error("container_source_too_large");
    const stub = env.CONVERTER.get(env.CONVERTER.idFromName(id));
    const response = await stub.fetch(
      `http://container/convert?kind=${info.mimeType === "application/pdf" ? "pdf" : "video"}&time=${time}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/octet-stream",
          "Content-Length": String(source.size),
        },
        body: source.body,
      },
    );
    if (!response.ok || !response.body) throw new Error("container_conversion_failed");
    const size = await putDerived(env, key, response.body, "image/png");
    await service("complete", { jobId, output: { key, contentType: "image/png", size, time } });
    return;
  }
  if (info.job.kind === "stream") {
    const { uploadStream } = await import("./streamProcessing");
    const uid = await uploadStream(env, info);
    await service("complete", { jobId, output: { streamUid: uid } });
    return;
  }
  throw new Error("unknown_processing_kind");
}
