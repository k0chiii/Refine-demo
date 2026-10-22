import { createHash } from "node:crypto";
import { expect, it, vi } from "vite-plus/test";
import { multipartRequest } from "../multipart";
import type { Sha256Sink, UploadOps } from "../ports";
const hash = (text: string) => createHash("sha256").update(text).digest("hex");
const sink = (): Sha256Sink => {
  const h = createHash("sha256");
  return {
    writable: new WritableStream({
      write: (c) => {
        h.update(c);
      },
    }),
    digest: async () => h.digest("hex"),
  };
};
it("multipart は全体を検証して一度だけ採用し、採用後の part 書換えと権限剥奪を拒否する", async () => {
  let part = "";
  let adopted = false;
  let exists = false;
  let meta = {};
  const target = {
    attemptId: "attempt",
    objectKey: "private/attempt",
    mimeType: "text/plain",
    declaredSize: 5,
    fileName: "a.txt",
  };
  const upload = {
    uploadId: "upload",
    uploadPart: vi.fn(async (partNumber: number, body: ReadableStream) => {
      part = await new Response(body).text();
      return { partNumber, etag: "etag" };
    }),
    complete: vi.fn(async () => {
      exists = true;
    }),
    abort: vi.fn(),
  };
  const bucket = {
    createMultipartUpload: async (_key: string, o: { customMetadata: unknown }) => {
      meta = o.customMetadata as object;
      return upload;
    },
    resumeMultipartUpload: () => upload,
    get: async () => (exists ? { body: new Response(part).body, customMetadata: meta } : null),
  };
  const ops: UploadOps = {
    begin: async () => target,
    resume: vi.fn(async () => ({ ...target, adopted })),
    complete: vi.fn(async () => {
      adopted = true;
      return { status: "verified", failureMessage: null };
    }),
    fail: vi.fn(),
  };
  const call = (
    path: string,
    method: string,
    body?: string,
    headers: Record<string, string> = {},
  ) =>
    multipartRequest(
      new Request(`https://test/uploads/multipart/${path}`, {
        method,
        headers: { "X-Multipart-Upload-ID": "upload", ...headers },
        ...(body ? { body } : {}),
      }),
      {
        token: "jwt",
        ops,
        bucket: bucket as unknown as Parameters<typeof multipartRequest>[1]["bucket"],
        sink,
      },
    );
  await call("start/item", "POST", undefined, { "X-Content-SHA256": hash("hello") });
  await call("part/attempt/1", "PUT", "wrong", { "Content-Length": "5" });
  const parts = JSON.stringify({ parts: [{ partNumber: 1, etag: "etag" }] });
  expect((await call("complete/attempt", "POST", parts)).status).toBe(400);
  expect(ops.complete).not.toHaveBeenCalled();
  // New valid attempt; the fake reuses its key only to exercise integrity checking.
  exists = false;
  await call("part/attempt/1", "PUT", "hello", { "Content-Length": "5" });
  expect((await call("complete/attempt", "POST", parts)).status).toBe(200);
  expect(ops.complete).toHaveBeenCalledWith("jwt", "attempt", { size: 5, sha256: hash("hello") });
  await call("complete/attempt", "POST", parts);
  expect(ops.complete).toHaveBeenCalledTimes(1);
  expect((await call("part/attempt/1", "PUT", "wrong", { "Content-Length": "5" })).status).toBe(
    409,
  );
  vi.mocked(ops.resume!).mockRejectedValueOnce(new Error("forbidden"));
  await expect(call("part/attempt/1", "PUT", "hello", { "Content-Length": "5" })).rejects.toThrow(
    "forbidden",
  );
  expect(upload.uploadPart).toHaveBeenCalledTimes(2);
});
