import type {
  ArtifactAccess,
  BackendGateway,
  ObjectStore,
  TokenVerifier,
  UploadOps,
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
  /** 書込み直前のフック（遅れて届く PUT の再現に使う） */
  beforeWrite: ((key: string) => Promise<void>) | null = null;
  async put(
    key: string,
    body: ReadableStream | ArrayBuffer,
    opts: { contentType: string; sha256Hex: string },
  ) {
    const buf = body instanceof ArrayBuffer ? body : await new Response(body).arrayBuffer();
    if (this.beforeWrite) await this.beforeWrite(key);
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

/**
 * Convex の転送の試行（開始・採用・破棄）をまねるインメモリ実装。
 * 版の提出物・フィードバックの添付で同じ形。試行ごとに別キーを払い出し、検証が済んだ 1 つだけを採用する。
 */
export interface FakeUploadTarget {
  keyPrefix: string;
  mimeType: string;
  declaredSize: number | null;
  fileName: string;
  owner: string;
  status: string;
  failureMessage: string | null;
  /** 採用された試行のキー */
  objectKey: string | null;
  /** false: 提出が確定した・投稿に付けた等で、もう受け付けない */
  open: boolean;
  size: number | null;
}

export class FakeUploads implements UploadOps {
  readonly targets = new Map<string, FakeUploadTarget>();
  readonly attempts = new Map<
    string,
    { id: string; targetId: string; objectKey: string; state: "reserved" | "adopted" | "discarded" }
  >();
  calls: string[] = [];
  /** 次の complete を「通信断（採否不明）」にする */
  failNextCompleteWithNetworkError = false;
  private seq = 0;
  constructor(
    private readonly codes: { notFound: string; invalid: string; closed: string },
    private readonly label: string,
  ) {}
  private subjectOf(token: string) {
    return token.slice(6);
  }
  private own(token: string, id: string) {
    const t = this.targets.get(id);
    if (!t || t.owner !== this.subjectOf(token))
      throw new GatewayError(this.codes.notFound, { id });
    return t;
  }
  async begin(token: string, id: string) {
    const t = this.own(token, id);
    if (!t.open) throw new GatewayError(this.codes.closed, { id });
    if (t.status === "verified") throw new GatewayError(this.codes.invalid, { id });
    const attemptId = `att${++this.seq}`;
    const objectKey = `${t.keyPrefix}/attempts/${attemptId}`;
    this.attempts.set(attemptId, { id: attemptId, targetId: id, objectKey, state: "reserved" });
    this.calls.push(`${this.label}begin:${id}:${attemptId}`);
    return {
      attemptId,
      objectKey,
      mimeType: t.mimeType,
      declaredSize: t.declaredSize,
      fileName: t.fileName,
    };
  }
  async complete(token: string, attemptId: string, meta: { size: number; sha256: string }) {
    this.calls.push(`${this.label}complete:${attemptId}:${meta.size}:${meta.sha256}`);
    if (this.failNextCompleteWithNetworkError) {
      this.failNextCompleteWithNetworkError = false;
      throw new Error("network down");
    }
    const a = this.attempts.get(attemptId);
    if (!a) throw new GatewayError("upload_attempt_not_found", { attemptId });
    const t = this.own(token, a.targetId);
    if (!t.open) throw new GatewayError(this.codes.closed, { id: a.targetId });
    if (t.status === "verified") throw new GatewayError(this.codes.invalid, { id: a.targetId });
    if (a.state !== "reserved") throw new GatewayError("upload_attempt_closed", { attemptId });
    // 採用（項目の状態と試行の状態を同時に変える）
    t.status = "verified";
    t.objectKey = a.objectKey;
    t.size = meta.size;
    t.failureMessage = null;
    a.state = "adopted";
    return { status: "verified", failureMessage: null };
  }
  async fail(token: string, attemptId: string, message: string) {
    this.calls.push(`${this.label}fail:${attemptId}:${message}`);
    const a = this.attempts.get(attemptId);
    if (!a) throw new GatewayError("upload_attempt_not_found", { attemptId });
    const t = this.own(token, a.targetId);
    if (a.state === "reserved") a.state = "discarded";
    if (t.open && t.status !== "verified") {
      t.status = "failed";
      t.failureMessage = message;
    }
  }
}

export class FakeGateway implements BackendGateway {
  readonly itemUploads = new FakeUploads(
    {
      notFound: "upload_item_not_found",
      invalid: "upload_item_invalid_state",
      closed: "upload_session_not_open",
    },
    "",
  );
  readonly feedbackUploads = new FakeUploads(
    { notFound: "feedback_not_found", invalid: "feedback_invalid", closed: "feedback_invalid" },
    "feedback-",
  );
  artifacts = new Map<string, ArtifactAccess & { viewers: string[] }>();
  /** フィードバックの添付を見られる人 */
  feedbackViewers = new Map<string, string[]>();
  private subjectOf(token: string) {
    return token.slice(6);
  }
  /** 提出の確定: 採用された実体を参照する Artifact を作り、セッションの受付を終える */
  confirm(itemId: string, artifactId: string, viewers: string[]) {
    const t = this.itemUploads.targets.get(itemId)!;
    if (t.status !== "verified" || !t.objectKey) throw new Error("not verified");
    t.open = false;
    this.artifacts.set(artifactId, {
      objectKey: t.objectKey,
      mimeType: t.mimeType,
      fileName: t.fileName,
      size: t.size,
      viewers,
    });
  }
  async authorizeArtifact(token: string, artifactId: string) {
    const a = this.artifacts.get(artifactId);
    if (!a || !a.viewers.includes(this.subjectOf(token)))
      throw new GatewayError("forbidden", { artifactId });
    return a;
  }
  async authorizeFeedbackFile(token: string, fileId: string) {
    const f = this.feedbackUploads.targets.get(fileId);
    const viewers = this.feedbackViewers.get(fileId) ?? [];
    if (!f || f.status !== "verified" || !f.objectKey || !viewers.includes(this.subjectOf(token)))
      throw new GatewayError("forbidden", { fileId });
    return { objectKey: f.objectKey, mimeType: f.mimeType, fileName: f.fileName, size: f.size };
  }
}

export { sha256Hex };
