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
    meta: { size: number; sha256: string; figma?: FigmaImportMeta },
  ): Promise<{ status: string; failureMessage: string | null }>;
  fail(token: string, attemptId: string, message: string): Promise<void>;
}

/** Figma から取り込んだとき、検証完了に添える値（Convex の domain `FigmaImportMeta` と同じ形） */
export interface FigmaImportMeta {
  nodeName: string;
  figmaVersion?: string;
  lastModified?: string;
  box: { width: number; height: number };
}

/**
 * Figma REST API（docs/FIGMA_WEB_PROOFING.md §2.1.2）。トークンはサーバーの秘密（FIGMA_ACCESS_TOKEN）で、
 * ブラウザには渡さない。テストでは偽物に差し替える（実際のネットワークは呼ばない）。
 */
export interface FigmaNodeInfo {
  name: string;
  box: { width: number; height: number } | null;
}
export interface FigmaClient {
  /** `GET /v1/files/:key/nodes?ids=` の要約。無いノードは nodes に入らない */
  getNodes(
    fileKey: string,
    nodeIds: readonly string[],
  ): Promise<{
    version: string | null;
    lastModified: string | null;
    nodes: Map<string, FigmaNodeInfo>;
  }>;
  /** `GET /v1/images/:key?ids=&scale=&format=png`。描けなかったノードは null */
  renderImages(
    fileKey: string,
    nodeIds: readonly string[],
    scale: number,
  ): Promise<Map<string, string | null>>;
  /** 書き出された画像（一時 URL）を取る */
  download(url: string): Promise<ArrayBuffer>;
}

/** Figma API の失敗（429 の Retry-After を含む）。利用者に見せる文面は figmaImport が作る */
export class FigmaApiError extends Error {
  constructor(
    readonly status: number,
    readonly retryAfterSec: number | null = null,
  ) {
    super(`figma api ${status}`);
    this.name = "FigmaApiError";
  }
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

/** head の結果。etag は強い検証子（引用符つき。R2 の httpEtag）。無い実装では null */
export interface StoredObjectHead extends StoredObjectMeta {
  etag: string | null;
}

/** バイト範囲（両端を含む offset〜offset+length-1）。呼び出し側が実体の大きさに収めて解決した値 */
export interface ByteRange {
  offset: number;
  length: number;
}

/**
 * 実体の大きさを知らずに頼む範囲（Range ヘッダーを読み替えたもの。parseRange）。R2 の範囲読みにそのまま渡せる。
 * offset だけなら末尾まで、suffix は末尾 n バイト
 */
export type RangeRequest = { offset: number; length?: number } | { suffix: number };

export interface StoredObject {
  /** range を指定したときは、その範囲だけ */
  body: ReadableStream;
  /** 実体全体の大きさ（範囲を指定しても全体） */
  size: number;
  contentType: string | null;
  etag: string | null;
}

export interface ObjectStore {
  /** sha256 は 16 進。ストア側で検証し、不一致なら例外。 */
  put(
    key: string,
    body: ReadableStream | ArrayBuffer,
    opts: { contentType: string; sha256Hex: string },
  ): Promise<StoredObjectMeta>;
  head(key: string): Promise<StoredObjectHead | null>;
  /**
   * 実体を読む。range を指定した場合、body はその範囲だけ（size は全体）。
   * 範囲が実体の外のときは例外を投げてよい（呼び出し側は HEAD で大きさを確かめて 416 にする）。
   */
  get(key: string, range?: ByteRange | RangeRequest): Promise<StoredObject | null>;
  delete(key: string): Promise<void>;
}
