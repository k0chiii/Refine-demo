/**
 * Hono 層が依存する抽象。
 * - TokenVerifier: Convex Auth が発行した JWT の検証（Hono 側でも認証を確認する: §7.2 セキュリティ要件）。
 * - BackendGateway: 業務判断は Convex に委ねる。Hono は「この利用者がこの操作をしてよいか」を Convex に尋ねるだけ。
 *   実体の転送（試行の開始・採用・破棄）だけは、R2 で実体を検証した Hono がサービス認証付きで呼ぶ（利用者の自己申告にしない）。
 * - ObjectStore: R2 の必要最小限。テストではインメモリ実装に差し替える。
 */
export interface VerifiedToken {
  subject: string;
}

export interface TokenVerifier {
  verify(token: string): Promise<VerifiedToken | null>;
}

/**
 * 転送の試行（Convex が PUT の前に払い出す）。objectKey はこの試行だけが書き込むキーで、
 * 同じ項目への他の PUT とは重ならない。採用されるまで、提出物・添付からは参照されない。
 */
export interface UploadAttemptTarget {
  attemptId: string;
  objectKey: string;
  mimeType: string;
  declaredSize: number | null;
  fileName: string;
}

/**
 * 実体の転送の 3 段階（版の提出物とフィードバックの添付で同じ）。いずれも利用者の JWT とサービスの秘密を付けて呼ぶ。
 * - begin: 利用者が持ち主の受付中・未検証の項目に、試行のキーを払い出す。
 * - complete: R2 が sha256 を確かめた試行を、項目がまだ受付中・未検証なら原子的に採用する。拒否は GatewayError。
 * - fail: 試行を破棄する（Hono が自分の試行のキーを消した後の記録）。
 */
export interface UploadOps {
  begin(token: string, id: string): Promise<UploadAttemptTarget>;
  complete(
    token: string,
    attemptId: string,
    meta: { size: number; sha256: string },
  ): Promise<{ status: string; failureMessage: string | null }>;
  fail(token: string, attemptId: string, message: string): Promise<void>;
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
  /** 版の提出物（PUT /uploads/items/:itemId） */
  itemUploads: UploadOps;
  authorizeArtifact(token: string, artifactId: string): Promise<ArtifactAccess>;
  /** フィードバックの添付（PUT /feedback/files/:fileId）。版の提出と同じ流れ */
  feedbackUploads: UploadOps;
  authorizeFeedbackFile(token: string, fileId: string): Promise<ArtifactAccess>;
}

/** 清掃（D14）: Convex から孤立オブジェクトを受け取り、R2 から削除して記録する。共有秘密で認証。 */
export interface CleanupGateway {
  listOrphans(limit: number): Promise<Array<{ itemId: string; objectKey: string }>>;
  markPurged(itemIds: string[]): Promise<number>;
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
  put(
    key: string,
    body: ReadableStream | ArrayBuffer,
    opts: { contentType: string; sha256Hex: string },
  ): Promise<StoredObjectMeta>;
  head(key: string): Promise<StoredObjectMeta | null>;
  get(key: string): Promise<StoredObject | null>;
  delete(key: string): Promise<void>;
}
