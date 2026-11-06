import { createHash, type Hash } from "node:crypto";
import { boundedText } from "./boundedBody";
import {
  MAX_UPLOAD_BYTES,
  needsPdfSignatureCheck,
  hasPdfSignature,
  PDF_SIGNATURE_WINDOW,
} from "@mf100/domain";
import type { Sha256Sink, UploadOps } from "./ports";

export const MULTIPART_PART_SIZE = 8 * 1024 * 1024;
type MultipartStore = Pick<R2Bucket, "createMultipartUpload" | "resumeMultipartUpload" | "get">;

/**
 * Running SHA-256 across parts in this isolate. Same-upload parts usually stay here;
 * a miss on complete falls back to a full-object read so integrity never weakens.
 */
type PartAccumulator = { hash: Hash; size: number; head: number[] };
const partAccumulators = new Map<string, PartAccumulator>();

function accKey(objectKey: string, uploadId: string) {
  return `${objectKey}\n${uploadId}`;
}

function takeAccumulator(objectKey: string, uploadId: string): PartAccumulator {
  const key = accKey(objectKey, uploadId);
  let acc = partAccumulators.get(key);
  if (!acc) {
    acc = { hash: createHash("sha256"), size: 0, head: [] };
    partAccumulators.set(key, acc);
  }
  return acc;
}

function dropAccumulator(objectKey: string, uploadId: string) {
  partAccumulators.delete(accKey(objectKey, uploadId));
}

/** Exposed for tests that assert the fast path avoided a full body digest. */
export function multipartAccumulatorCountForTests() {
  return partAccumulators.size;
}

/** No completed object is deleted here: orphan cleanup decides deletion after atomic adoption/failure. */
export async function multipartRequest(
  request: Request,
  args: { token: string; ops: UploadOps; bucket: MultipartStore; sink: () => Sha256Sink },
): Promise<Response> {
  const path = new URL(request.url).pathname.split("/").filter(Boolean);
  const action = path[2];
  const id = path[3];
  if (!args.ops.resume) return Response.json({ code: "multipart_unavailable" }, { status: 503 });
  if (request.method === "POST" && action === "start" && id) {
    const sha = request.headers.get("X-Content-SHA256") ?? "";
    if (!/^[a-f0-9]{64}$/i.test(sha))
      return Response.json({ code: "sha256_required" }, { status: 400 });
    const target = await args.ops.begin(args.token, id);
    if (
      target.declaredSize === null ||
      target.declaredSize < 1 ||
      target.declaredSize > MAX_UPLOAD_BYTES
    ) {
      await args.ops.fail(
        args.token,
        target.attemptId,
        "multipart requires a bounded declared size",
      );
      return Response.json({ code: "invalid_size" }, { status: 400 });
    }
    const upload = await args.bucket.createMultipartUpload(target.objectKey, {
      httpMetadata: { contentType: target.mimeType },
      customMetadata: {
        "mf100-sha256": sha.toLowerCase(),
        "mf100-size": String(target.declaredSize),
      },
    });
    return Response.json({
      attemptId: target.attemptId,
      uploadId: upload.uploadId,
      partSize: MULTIPART_PART_SIZE,
    });
  }
  if (!id || !["part", "complete", "abort"].includes(action ?? ""))
    return new Response(null, { status: 404 });
  const target = await args.ops.resume(args.token, id);
  const uploadId = request.headers.get("X-Multipart-Upload-ID");
  if (!uploadId || uploadId.length > 1024) return new Response(null, { status: 400 });
  if (target.adopted)
    return action === "complete"
      ? Response.json({ status: "verified", failureMessage: null })
      : new Response(null, { status: 409 });
  const upload = args.bucket.resumeMultipartUpload(target.objectKey, uploadId);
  if (action === "part" && request.method === "PUT") {
    const partNumber = Number(path[4]);
    const length = Number(request.headers.get("Content-Length"));
    const total = target.declaredSize ?? 0;
    const parts = Math.ceil(total / MULTIPART_PART_SIZE);
    const expectedSize =
      partNumber === parts ? total - (parts - 1) * MULTIPART_PART_SIZE : MULTIPART_PART_SIZE;
    if (
      !Number.isInteger(partNumber) ||
      partNumber < 1 ||
      partNumber > parts ||
      length !== expectedSize ||
      !request.body
    )
      return Response.json({ code: "invalid_part" }, { status: 400 });
    const bytes = new Uint8Array(await request.arrayBuffer());
    if (bytes.byteLength !== expectedSize)
      return Response.json({ code: "invalid_part" }, { status: 400 });
    const acc = takeAccumulator(target.objectKey, uploadId);
    acc.hash.update(bytes);
    acc.size += bytes.byteLength;
    if (acc.head.length < PDF_SIGNATURE_WINDOW)
      acc.head.push(...bytes.slice(0, PDF_SIGNATURE_WINDOW - acc.head.length));
    const part = await upload.uploadPart(partNumber, bytes);
    return Response.json(part);
  }
  if (action === "abort" && request.method === "POST") {
    dropAccumulator(target.objectKey, uploadId);
    await upload.abort();
    await args.ops.fail(args.token, id, "multipart cancelled");
    return new Response(null, { status: 204 });
  }
  if (action !== "complete" || request.method !== "POST")
    return new Response(null, { status: 405 });
  if (Number(request.headers.get("Content-Length")) > 16_384)
    return new Response(null, { status: 413 });
  const body = await boundedText(request, 16_384);
  if (body.length > 16_384) return new Response(null, { status: 413 });
  const data = JSON.parse(body) as { parts?: R2UploadedPart[] };
  const expectedParts = Math.ceil((target.declaredSize ?? 0) / MULTIPART_PART_SIZE);
  if (
    !Array.isArray(data.parts) ||
    data.parts.length !== expectedParts ||
    !data.parts.every(
      (part, i) =>
        part.partNumber === i + 1 && typeof part.etag === "string" && part.etag.length <= 256,
    )
  )
    return Response.json({ code: "invalid_parts" }, { status: 400 });
  // A lost completion response can be resumed from this attempt's immutable object key.
  const existing = await args.bucket.get(target.objectKey);
  if (existing) await existing.body.cancel();
  else await upload.complete(data.parts);

  const declared = target.declaredSize ?? 0;
  const acc = partAccumulators.get(accKey(target.objectKey, uploadId));
  let size: number;
  let sha256: string;
  let head: number[];
  let meta: Record<string, string> | undefined;

  if (acc && acc.size === declared) {
    size = acc.size;
    sha256 = acc.hash.digest("hex");
    head = acc.head;
    dropAccumulator(target.objectKey, uploadId);
    const probe = await args.bucket.get(target.objectKey);
    if (!probe) throw new Error("multipart_object_missing");
    meta = probe.customMetadata as Record<string, string> | undefined;
    await probe.body.cancel();
  } else {
    dropAccumulator(target.objectKey, uploadId);
    const object = await args.bucket.get(target.objectKey);
    if (!object) throw new Error("multipart_object_missing");
    meta = object.customMetadata as Record<string, string> | undefined;
    const sink = args.sink();
    const writer = sink.writable.getWriter();
    size = 0;
    head = [];
    const reader = object.body.getReader();
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.length;
      if (size > MAX_UPLOAD_BYTES) {
        await reader.cancel();
        throw new Error("multipart_too_large");
      }
      if (head.length < PDF_SIGNATURE_WINDOW)
        head.push(...chunk.value.slice(0, PDF_SIGNATURE_WINDOW - head.length));
      await writer.write(chunk.value);
    }
    await writer.close();
    sha256 = await sink.digest();
  }

  if (
    size !== declared ||
    sha256 !== (meta?.["mf100-sha256"] ?? "").toLowerCase() ||
    String(size) !== meta?.["mf100-size"]
  ) {
    await args.ops.fail(args.token, id, "multipart full-object verification failed");
    return Response.json({ code: "integrity_mismatch" }, { status: 400 });
  }
  const result = await args.ops.complete(args.token, id, {
    size,
    sha256,
    ...(needsPdfSignatureCheck(target.fileName)
      ? { pdfCompatible: hasPdfSignature(new Uint8Array(head)) }
      : {}),
  });
  return Response.json(result, { headers: { "Cache-Control": "no-store" } });
}
