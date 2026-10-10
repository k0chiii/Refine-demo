/**
 * Hono 層が依存する抽象。
 * - TokenVerifier: Convex Auth が発行した JWT の検証（Hono 側でも認証を確認する: §7.2 セキュリティ要件）。
 * - BackendGateway: 業務判断は Convex に委ねる。Hono は「この利用者がこの操作をしてよいか」を Convex に尋ねるだけ。
 * - ObjectStore: R2 の必要最小限。テストではインメモリ実装に差し替える。
 */
export interface VerifiedToken {
  subject: string;
}

export interface TokenVerifier {
  verify(token: string): Promise<VerifiedToken | null>;
}

export interface UploadTarget {
  objectKey: string;
  mimeType: string;
  declaredSize: number | null;
  fileName: string;
}

export interface ArtifactAccess {
  objectKey: string;
  mimeType: string;
  fileName: string;
  size: number | null;
}

export class GatewayError extends Error {
  constructor(
    readonly code: string,
    readonly details: unknown = {},
  ) {
    super(code);
    this.name = "GatewayError";
  }
}

export interface BackendGateway {
  itemForUpload(token: string, itemId: string): Promise<UploadTarget>;
  markVerified(token: string, itemId: string, meta: { size: number; sha256: string }): Promise<{ status: string; failureMessage: string | null }>;
  markFailed(token: string, itemId: string, message: string): Promise<void>;
  authorizeArtifact(token: string, artifactId: string): Promise<ArtifactAccess>;
}

export interface StoredObjectMeta {
  size: number;
  sha256Hex: string | null;
}

export interface StoredObject {
  body: ReadableStream;
  size: number;
  contentType: string | null;
}

export interface ObjectStore {
  /** sha256 は 16 進。ストア側で検証し、不一致なら例外。 */
  put(key: string, body: ReadableStream | ArrayBuffer, opts: { contentType: string; sha256Hex: string }): Promise<StoredObjectMeta>;
  head(key: string): Promise<StoredObjectMeta | null>;
  get(key: string): Promise<StoredObject | null>;
  delete(key: string): Promise<void>;
}
