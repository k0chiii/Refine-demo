import type {
  ArtifactAccess,
  BackendGateway,
  ObjectStore,
  TokenVerifier,
  UploadTarget,
} from "../ports.ts";
import { GatewayError } from "../ports.ts";

export const fakeVerifier: TokenVerifier = {
  async verify(token) {
    return token.startsWith("valid:") ? { subject: token.slice(6) } : null;
  },
};

async function sha256Hex(buf: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", buf);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export class MemoryStore implements ObjectStore {
  readonly objects = new Map<string, { bytes: Uint8Array; contentType: string }>();
  async put(
    key: string,
    body: ReadableStream | ArrayBuffer,
    opts: { contentType: string; sha256Hex: string },
  ) {
    const buf = body instanceof ArrayBuffer ? body : await new Response(body).arrayBuffer();
    const actual = await sha256Hex(buf);
    if (actual !== opts.sha256Hex)
      throw new Error("The SHA-256 checksum you specified did not match what we received.");
    this.objects.set(key, { bytes: new Uint8Array(buf), contentType: opts.contentType });
    return { size: buf.byteLength, sha256Hex: actual };
  }
  async head(key: string) {
    const o = this.objects.get(key);
    return o ? { size: o.bytes.byteLength, sha256Hex: null } : null;
  }
  async get(key: string) {
    const o = this.objects.get(key);
    if (!o) return null;
    return {
      body: new Response(o.bytes.slice().buffer as ArrayBuffer).body!,
      size: o.bytes.byteLength,
      contentType: o.contentType,
    };
  }
  async delete(key: string) {
    this.objects.delete(key);
  }
}

export class FakeGateway implements BackendGateway {
  items = new Map<
    string,
    UploadTarget & { owner: string; status: string; failureMessage: string | null }
  >();
  artifacts = new Map<string, ArtifactAccess & { viewers: string[] }>();
  calls: string[] = [];
  private subjectOf(token: string) {
    return token.slice(6);
  }
  async itemForUpload(token: string, itemId: string) {
    const item = this.items.get(itemId);
    if (!item || item.owner !== this.subjectOf(token))
      throw new GatewayError("upload_item_not_found", { itemId });
    if (item.status === "verified") throw new GatewayError("upload_item_invalid_state", { itemId });
    return item;
  }
  async markVerified(_token: string, itemId: string, meta: { size: number; sha256: string }) {
    this.calls.push(`verified:${itemId}:${meta.size}:${meta.sha256}`);
    const item = this.items.get(itemId)!;
    item.status = "verified";
    return { status: "verified", failureMessage: null };
  }
  async markFailed(_token: string, itemId: string, message: string) {
    this.calls.push(`failed:${itemId}:${message}`);
    const item = this.items.get(itemId)!;
    item.status = "failed";
    item.failureMessage = message;
  }
  async authorizeArtifact(token: string, artifactId: string) {
    const a = this.artifacts.get(artifactId);
    if (!a || !a.viewers.includes(this.subjectOf(token)))
      throw new GatewayError("forbidden", { artifactId });
    return a;
  }
  /** フィードバックの添付（版の提出と同じ形。ID の頭で区別しない別の表） */
  feedbackFiles = new Map<
    string,
    UploadTarget & {
      owner: string;
      status: string;
      failureMessage: string | null;
      viewers: string[];
      size: number | null;
    }
  >();
  async feedbackFileForUpload(token: string, fileId: string) {
    const f = this.feedbackFiles.get(fileId);
    if (!f || f.owner !== this.subjectOf(token))
      throw new GatewayError("feedback_not_found", { fileId });
    if (f.status === "verified") throw new GatewayError("feedback_invalid", { fileId });
    return f;
  }
  async markFeedbackFileVerified(
    _token: string,
    fileId: string,
    meta: { size: number; sha256: string },
  ) {
    this.calls.push(`feedback-verified:${fileId}:${meta.size}:${meta.sha256}`);
    const f = this.feedbackFiles.get(fileId)!;
    f.status = "verified";
    f.size = meta.size;
    return { status: "verified", failureMessage: null };
  }
  async markFeedbackFileFailed(_token: string, fileId: string, message: string) {
    this.calls.push(`feedback-failed:${fileId}:${message}`);
    const f = this.feedbackFiles.get(fileId)!;
    f.status = "failed";
    f.failureMessage = message;
  }
  async authorizeFeedbackFile(token: string, fileId: string) {
    const f = this.feedbackFiles.get(fileId);
    if (!f || f.status !== "verified" || !f.viewers.includes(this.subjectOf(token)))
      throw new GatewayError("forbidden", { fileId });
    return { objectKey: f.objectKey, mimeType: f.mimeType, fileName: f.fileName, size: f.size };
  }
}

export { sha256Hex };
