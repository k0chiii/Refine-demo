import { createHash } from "node:crypto";
import type {
  ArtifactAccess,
  ByteRange,
  BackendGateway,
  FigmaClient,
  FigmaImportMeta,
  FigmaNodeInfo,
  ObjectStore,
  RangeRequest,
  Sha256Sink,
  ThumbOps,
  TokenVerifier,
  UploadOps,
} from "../ports.ts";
import { FigmaApiError, GatewayError } from "../ports.ts";

export const fakeVerifier: TokenVerifier = {
  async verify(token) {
    return token.startsWith("valid:") ? { subject: token.slice(6) } : null;
  },
};

async function sha256Hex(buf: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", buf);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Workers の crypto.DigestStream の代わり（Node の createHash でストリームのまま SHA-256 を取る） */
export function nodeSha256Sink(): Sha256Sink {
  const hash = createHash("sha256");
  return {
    writable: new WritableStream<Uint8Array>({
      write(chunk) {
        hash.update(chunk);
      },
    }),
    digest: async () => hash.digest("hex"),
  };
}

const encodingOf = (o: { encoding?: "gzip"; originalSize?: number }) =>
  o.encoding
    ? { encoding: o.encoding, originalSize: o.originalSize ?? null }
    : { encoding: null, originalSize: null };

export class MemoryStore implements ObjectStore {
  readonly objects = new Map<
    string,
    {
      bytes: Uint8Array;
      contentType: string;
      encoding?: "gzip";
      originalSize?: number;
    }
  >();
  /** 書込み直前のフック（遅れて届く PUT の再現に使う） */
  beforeWrite: ((key: string) => Promise<void>) | null = null;
  async put(
    key: string,
    body: ReadableStream | ArrayBuffer,
    opts: {
      contentType: string;
      sha256Hex?: string;
      encoding?: "gzip";
      originalSize?: number;
    },
  ) {
    const buf = body instanceof ArrayBuffer ? body : await new Response(body).arrayBuffer();
    if (this.beforeWrite) await this.beforeWrite(key);
    const actual = await sha256Hex(buf);
    if (opts.sha256Hex !== undefined && actual !== opts.sha256Hex)
      throw new Error("The SHA-256 checksum you specified did not match what we received.");
    this.objects.set(key, {
      bytes: new Uint8Array(buf),
      contentType: opts.contentType,
      ...(opts.encoding ? { encoding: opts.encoding, originalSize: opts.originalSize ?? 0 } : {}),
    });
    return { size: buf.byteLength, sha256Hex: opts.sha256Hex ? actual : null };
  }
  /** 内容から決まる強い検証子（R2 の httpEtag のまねごと） */
  private etagOf(o: { bytes: Uint8Array }) {
    let h = 2166136261;
    for (const b of o.bytes) h = Math.imul(h ^ b, 16777619) >>> 0;
    return `"${h.toString(16)}-${o.bytes.byteLength}"`;
  }
  /** get の呼び出し（範囲つきかどうか）。範囲リクエストが R2 の範囲読みになっているかの確認に使う */
  readonly gets: Array<{ key: string; range: ByteRange | RangeRequest | undefined }> = [];
  /** head の呼び出し回数（範囲取得が HEAD なしの 1 回で済んでいるかの確認に使う） */
  heads = 0;
  async head(key: string) {
    this.heads++;
    const o = this.objects.get(key);
    return o
      ? { size: o.bytes.byteLength, sha256Hex: null, etag: this.etagOf(o), ...encodingOf(o) }
      : null;
  }
  async get(key: string, range?: ByteRange | RangeRequest) {
    this.gets.push({ key, range });
    const o = this.objects.get(key);
    if (!o) return null;
    const size = o.bytes.byteLength;
    let bytes = o.bytes;
    if (range) {
      // R2 と同じく、始めが実体の外なら例外。終わりは実体の末尾に収める
      const offset = "suffix" in range ? Math.max(size - range.suffix, 0) : (range.offset ?? 0);
      if (offset >= size) throw new Error("The requested range is not satisfiable (10039)");
      const length =
        "suffix" in range ? size - offset : Math.min(range.length ?? size - offset, size - offset);
      bytes = o.bytes.slice(offset, offset + length);
    }
    return {
      body: new Response(bytes.slice().buffer as ArrayBuffer).body!,
      size: o.bytes.byteLength,
      contentType: o.contentType,
      etag: this.etagOf(o),
      ...encodingOf(o),
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
  /** Figma から取り込んだときに添えられた値 */
  figma?: FigmaImportMeta;
}

export class FakeUploads implements UploadOps {
  readonly targets = new Map<string, FakeUploadTarget>();
  readonly attempts = new Map<
    string,
    { id: string; targetId: string; objectKey: string; state: "reserved" | "adopted" | "discarded" }
  >();
  calls: string[] = [];
  /** complete で渡された値（.ai の PDF 互換など、呼び出しの文字列に出ない値の確認用） */
  readonly completeMetas: Array<{ pdfCompatible?: boolean }> = [];
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
  async complete(
    token: string,
    attemptId: string,
    meta: { size: number; sha256: string; figma?: FigmaImportMeta; pdfCompatible?: boolean },
  ) {
    this.calls.push(`${this.label}complete:${attemptId}:${meta.size}:${meta.sha256}`);
    this.completeMetas.push(
      meta.pdfCompatible !== undefined ? { pdfCompatible: meta.pdfCompatible } : {},
    );
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
    if (meta.figma) t.figma = meta.figma;
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

/** コメントの添付のサムネイル（固定の置き場。付ける前の本人の画像にだけ受ける）をまねるインメモリ実装 */
export class FakeThumbs implements ThumbOps {
  readonly files = new Map<
    string,
    {
      keyPrefix: string;
      fileName: string;
      owner: string;
      /** false: コメントに付けた等で、もう受け付けない */
      open: boolean;
      thumb?: { size: number; mimeType: string };
    }
  >();
  calls: string[] = [];
  private own(token: string, id: string) {
    const f = this.files.get(id);
    if (!f || f.owner !== token.slice(6)) throw new GatewayError("comment_file_not_found", { id });
    return f;
  }
  async begin(token: string, fileId: string) {
    const f = this.own(token, fileId);
    if (!f.open) throw new GatewayError("comment_file_invalid", { fileId });
    this.calls.push(`thumb-begin:${fileId}`);
    return { objectKey: `${f.keyPrefix}/thumb`, fileName: f.fileName };
  }
  async complete(token: string, fileId: string, meta: { size: number; mimeType: string }) {
    const f = this.own(token, fileId);
    if (!f.open) throw new GatewayError("comment_file_invalid", { fileId });
    this.calls.push(`thumb-complete:${fileId}:${meta.size}:${meta.mimeType}`);
    f.thumb = meta;
    return { hasThumb: true };
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
  readonly commentUploads = new FakeUploads(
    {
      notFound: "comment_file_not_found",
      invalid: "comment_file_invalid",
      closed: "comment_file_invalid",
    },
    "comment-",
  );
  readonly commentThumbs = new FakeThumbs();
  artifacts = new Map<string, ArtifactAccess & { viewers: string[] }>();
  /** コメントの添付を見られる人と、サムネイルを端末に残してよいか（機密でない制作物） */
  commentViewers = new Map<
    string,
    { viewers: string[]; cacheable: boolean; attachment?: boolean }
  >();
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
  async authorizeCommentFile(token: string, fileId: string, variant: "original" | "thumb") {
    const f = this.commentUploads.targets.get(fileId);
    const access = this.commentViewers.get(fileId);
    if (!f || !access || !access.viewers.includes(this.subjectOf(token)))
      throw new GatewayError("forbidden", { fileId });
    if (variant === "thumb") {
      const thumb = this.commentThumbs.files.get(fileId)?.thumb;
      if (!thumb) throw new GatewayError("comment_file_not_ready", { fileId });
      return {
        objectKey: `${f.keyPrefix}/thumb`,
        mimeType: thumb.mimeType,
        fileName: f.fileName,
        size: thumb.size,
        cacheable: access.cacheable,
      };
    }
    if (f.status !== "verified" || !f.objectKey)
      throw new GatewayError("comment_file_not_ready", { fileId });
    return {
      objectKey: f.objectKey,
      mimeType: f.mimeType,
      fileName: f.fileName,
      size: f.size,
      cacheable: false,
      attachment: access.attachment ?? false,
    };
  }
}

export { sha256Hex };

/**
 * Figma REST API の偽物（ネットワークは呼ばない）。ファイルごとにノードと画像を持ち、
 * 呼ばれた回数と 429 を起こす設定で、レート制限の扱いを試す
 */
export class FakeFigma implements FigmaClient {
  files = new Map<
    string,
    {
      version: string;
      lastModified: string;
      nodes: Map<string, FigmaNodeInfo & { png: Uint8Array | null }>;
    }
  >();
  calls: string[] = [];
  /** 次の呼び出しで 429（Retry-After 秒）。null なら起こさない */
  rateLimitNext: number | null = null;
  /** 全部に 403 */
  forbidden = false;
  async getNodes(fileKey: string, nodeIds: readonly string[]) {
    this.calls.push(`nodes:${fileKey}:${nodeIds.join(",")}`);
    this.gate();
    const f = this.files.get(fileKey);
    if (!f) throw new FigmaApiError(404);
    const nodes = new Map<string, FigmaNodeInfo>();
    for (const id of nodeIds) {
      const n = f.nodes.get(id);
      if (n) nodes.set(id, { name: n.name, box: n.box });
    }
    return { version: f.version, lastModified: f.lastModified, nodes };
  }
  async renderImages(fileKey: string, nodeIds: readonly string[], scale: number) {
    this.calls.push(`images:${fileKey}:${nodeIds.join(",")}:${scale}`);
    this.gate();
    const f = this.files.get(fileKey);
    if (!f) throw new FigmaApiError(404);
    const out = new Map<string, string | null>();
    for (const id of nodeIds)
      out.set(id, f.nodes.get(id)?.png ? `https://figma-cdn.invalid/${fileKey}/${id}.png` : null);
    return out;
  }
  async download(url: string) {
    this.calls.push(`download:${url}`);
    const m = /\/([^/]+)\/([^/]+)\.png$/.exec(url);
    const png = m ? this.files.get(m[1]!)?.nodes.get(m[2]!)?.png : null;
    if (!png) throw new FigmaApiError(404);
    return png.slice().buffer as ArrayBuffer;
  }
  private gate() {
    if (this.forbidden) throw new FigmaApiError(403);
    if (this.rateLimitNext !== null) {
      const ra = this.rateLimitNext;
      this.rateLimitNext = null;
      throw new FigmaApiError(429, ra);
    }
  }
}
