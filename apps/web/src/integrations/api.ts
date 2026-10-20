import { createCacheStorePersistence } from "@/lib/artifactCacheStore";
import {
  ArtifactError,
  ArtifactFiles,
  type ArtifactTransport,
  type OpenOptions,
} from "@/lib/artifactFiles";
import { defaultFileCachePolicy } from "@/lib/fileCachePolicy";
import { jwtUser } from "@/lib/jwt";
import { messageForCode } from "@/lib/errors";
import {
  UploadTooLargeError,
  encodeForUpload,
  encodingHeaders,
  sha256Hex,
  type UploadPhase,
} from "@/lib/uploadEncoding";

/** Hono API（ファイル提出・配信）。業務データは Convex、ファイルはこちら、の境界を守る。 */
export const API_URL = (import.meta.env.VITE_API_URL ?? "http://127.0.0.1:8787").replace(/\/$/, "");

export { sha256Hex };

export interface UploadResult {
  itemId: string;
  status: string;
  failureMessage: string | null;
  size: number;
}

/**
 * 版の提出物を送る。ダウンロード専用の原本は gzip して送る（lib/uploadEncoding）。申告する sha256・大きさは元の実体のもの。
 * 圧縮している間は onPhase("compressing") を呼ぶ（画面が「圧縮しています」を出す）
 */
export async function uploadItem(
  token: string,
  itemId: string,
  file: File,
  onProgress?: (fraction: number) => void,
  onPhase?: (phase: UploadPhase) => void,
): Promise<UploadResult> {
  const upload = await encodeOrExplain(file, onPhase);
  onProgress?.(0.1);
  const res = await fetch(`${API_URL}/uploads/items/${encodeURIComponent(itemId)}`, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": file.type || "application/octet-stream",
      ...encodingHeaders(upload),
    },
    body: upload.body,
  });
  onProgress?.(1);
  const json = (await res.json().catch(() => ({}))) as Partial<UploadResult> & {
    code?: string;
    message?: string;
  };
  if (!res.ok)
    throw new Error(
      json.code === "size_mismatch"
        ? "ファイルが途中で欠けました。もう一度アップロードしてください。"
        : json.code === "file_too_large"
          ? messageForCode("upload_file_too_large")
          : "ファイルをアップロードできませんでした。もう一度お試しください。",
    );
  return json as UploadResult;
}

/** 送る本文を用意する。圧縮しても上限に収まらないときは、理由のわかる文面で断る */
async function encodeOrExplain(file: File, onPhase?: (phase: UploadPhase) => void) {
  try {
    return await encodeForUpload(file, { onCompressing: () => onPhase?.("compressing") });
  } catch (error) {
    if (error instanceof UploadTooLargeError)
      throw new Error(messageForCode("upload_file_too_large"));
    throw error;
  } finally {
    onPhase?.(null);
  }
}

/**
 * 認可付きの添付の取得（Hono GET /files/:id）。署名付き URL は無いので、毎回 Bearer を付ける（Worker が毎回認可する）。
 * 範囲取得（Range）・条件付き取得（If-None-Match → 304）に対応。応答の本体はストリームのまま渡す。
 */
const createTransport = (urlFor: (id: string) => string): ArtifactTransport => ({
  async request({ token, artifactId, start, end, ifNoneMatch, ifRange, signal }) {
    const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
    if (start !== undefined) headers.Range = `bytes=${start}-${end !== undefined ? end : ""}`;
    if (ifNoneMatch) headers["If-None-Match"] = ifNoneMatch;
    if (ifRange) headers["If-Range"] = ifRange;
    let res: Response;
    try {
      res = await fetch(urlFor(artifactId), {
        headers,
        ...(signal ? { signal } : {}),
      });
    } catch (e) {
      if (signal?.aborted) throw e;
      throw new ArtifactError(0);
    }
    if (res.status !== 200 && res.status !== 206 && res.status !== 304)
      throw new ArtifactError(res.status);
    const range = /^bytes (\d+)-\d+\/(\d+)$/.exec(res.headers.get("Content-Range") ?? "");
    const length = Number(res.headers.get("Content-Length"));
    return {
      status: res.status,
      etag: res.headers.get("ETag"),
      contentType: res.headers.get("Content-Type"),
      total: range ? Number(range[2]) : Number.isFinite(length) && length > 0 ? length : null,
      start: range ? Number(range[1]) : 0,
      rangeSupported: res.headers.get("Accept-Ranges") === "bytes",
      body: res.body,
    };
  },
});
const transport = createTransport((id) => `${API_URL}/files/${encodeURIComponent(id)}`);

/** 添付の取得・写し（二重取得の排除、受け取りながらの利用、端末の写し）。lib/artifactFiles */
export const artifactFiles = new ArtifactFiles({
  transport,
  persistence: createCacheStorePersistence(),
  subjectOf: jwtUser,
  policy: defaultFileCachePolicy,
});

/** 認可付きで添付を丸ごと取得する。同じ添付の取得は共有され、端末の写しがあればそこから */
export function fetchArtifactBlob(
  token: string,
  artifactId: string,
  opts?: OpenOptions,
): Promise<Blob> {
  return artifactFiles.blob(token, artifactId, opts);
}

/** 添付を手元に保存する（.ai など紙面に出さない原本も）。認可付きで取得してから、元のファイル名で保存させる */
export async function downloadArtifact(token: string, artifactId: string, fileName: string) {
  saveBlob(await fetchArtifactBlob(token, artifactId), fileName);
}

function saveBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

// ---------------------------------------------------------------- フィードバック（表現の議論）の添付

export interface FeedbackUploadResult {
  fileId: string;
  status: string;
  failureMessage: string | null;
  size: number;
}

/**
 * フィードバックの添付を送る（Convex の feedback.prepareFiles で受け取った fileId ごと）。
 * 版の提出と同じく sha256 を添え、Hono が R2 で確かめてから検証済みにする。
 */
export async function uploadFeedbackFile(
  token: string,
  fileId: string,
  file: File,
  onProgress?: (fraction: number) => void,
): Promise<FeedbackUploadResult> {
  const upload = await encodeOrExplain(file);
  onProgress?.(0.1);
  const res = await fetch(`${API_URL}/feedback/files/${encodeURIComponent(fileId)}`, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": file.type || "application/octet-stream",
      ...encodingHeaders(upload),
    },
    body: upload.body,
  });
  onProgress?.(1);
  const json = (await res.json().catch(() => ({}))) as Partial<FeedbackUploadResult> & {
    code?: string;
  };
  if (!res.ok)
    throw new Error(
      json.code === "size_mismatch"
        ? "ファイルが途中で欠けました。もう一度添付してください。"
        : "ファイルを添付できませんでした。もう一度お試しください。",
    );
  return json as FeedbackUploadResult;
}

/** フィードバックの添付を認可付きで取得する（PDF・画像を投稿の中に出す） */
export async function fetchFeedbackFileBlob(token: string, fileId: string): Promise<Blob> {
  const res = await fetch(`${API_URL}/feedback/files/${encodeURIComponent(fileId)}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok)
    throw new Error(
      res.status === 403
        ? "このファイルを閲覧する権限がありません"
        : "ファイルを読み込めませんでした。もう一度お試しください。",
    );
  return res.blob();
}

/** フィードバックの添付を手元に保存する（.ai など） */
export async function downloadFeedbackFile(token: string, fileId: string, fileName: string) {
  saveBlob(await fetchFeedbackFileBlob(token, fileId), fileName);
}

// ---------------------------------------------------------------- Figma の取り込み（Hono /figma/*）

export interface FigmaImportItemInput {
  itemId: string;
  fileKey: string;
  /** 「1:2」 */
  nodeId: string;
}
export interface FigmaImportItemResult {
  itemId: string;
  status: string;
  failureMessage: string | null;
  nodeName: string | null;
}

/** Figma 連携が使えるか（Worker にトークンがあるか）。失敗したら使えないものとして扱う */
export async function figmaStatus(token: string): Promise<{ enabled: boolean }> {
  try {
    const res = await fetch(`${API_URL}/figma/status`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return { enabled: false };
    const json = (await res.json()) as { enabled?: unknown };
    return { enabled: json.enabled === true };
  } catch {
    return { enabled: false };
  }
}

/**
 * Figma のフレームを Worker に取り込ませる（Worker が Figma API を呼び、R2 へ入れ、Convex に採用を求める）。
 * ブラウザは Figma のトークンを持たない
 */
export async function importFigmaFrames(
  token: string,
  items: FigmaImportItemInput[],
): Promise<FigmaImportItemResult[]> {
  const res = await fetch(`${API_URL}/figma/import`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ items }),
  });
  const json = (await res.json().catch(() => ({}))) as {
    items?: FigmaImportItemResult[];
    code?: string;
    message?: string;
  };
  if (!res.ok)
    throw new Error(
      json.code === "figma_not_configured"
        ? "Figma 連携が未設定です。書き出した PNG/PDF を添付してください"
        : (json.message ?? "Figma から取り込めませんでした。もう一度お試しください。"),
    );
  return json.items ?? [];
}

// ---------------------------------------------------------------- コメント・返信の添付（Hono /comment-files/*）

export interface CommentUploadResult {
  fileId: string;
  status: string;
  failureMessage: string | null;
  size: number;
  /** サムネイルも置けたか（置けなくても添付は有効。一覧は原本で代替する） */
  thumb: boolean;
}

export interface CommentUploadOptions {
  /** 一覧用のサムネイル（attachmentCompress が作る WebP）。無ければ送らない */
  thumb?: Blob | null;
  /** 原本の送信の進み具合（0〜1。実際に送った量。圧縮・ハッシュの計算が済んでから動き出す） */
  onProgress?: (fraction: number) => void;
  /** 中止（本文の送信を打ち切る） */
  signal?: AbortSignal;
  onPhase?: (phase: UploadPhase) => void;
}

/** PUT を XHR で送り、実際に送れた量を知らせる（fetch は送信の進み具合を取れない） */
function putWithProgress(
  url: string,
  headers: Record<string, string>,
  body: Blob,
  onProgress?: (fraction: number) => void,
  signal?: AbortSignal,
): Promise<{ status: number; json: Record<string, unknown> }> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new DOMException("aborted", "AbortError"));
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    for (const [key, value] of Object.entries(headers)) xhr.setRequestHeader(key, value);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && e.total > 0) onProgress?.(Math.min(1, e.loaded / e.total));
    };
    xhr.onload = () => {
      let json: Record<string, unknown> = {};
      try {
        json = JSON.parse(xhr.responseText) as Record<string, unknown>;
      } catch {
        // 本文が JSON でない応答（経路のエラー）。状態だけで扱う
      }
      resolve({ status: xhr.status, json });
    };
    xhr.onerror = () => reject(new Error("network"));
    xhr.onabort = () => reject(new DOMException("aborted", "AbortError"));
    signal?.addEventListener("abort", () => xhr.abort(), { once: true });
    xhr.send(body);
  });
}

/**
 * コメント・返信の添付を送る（Convex の commentFiles.prepare で受け取った fileId ごと）。
 * 原本は版の提出と同じく sha256 を添え、Hono が R2 で確かめてから検証済みにする（ダウンロード専用の原本は可逆に gzip）。
 * サムネイル（画像）は原本の後に送る。サムネイルの失敗は添付の失敗にしない。
 * 検証済み（status: "verified"）になった fileId を comments.post / reply の fileIds に渡す。
 */
export async function uploadCommentFile(
  token: string,
  fileId: string,
  file: File,
  options: CommentUploadOptions = {},
): Promise<CommentUploadResult> {
  const upload = await encodeOrExplain(file, options.onPhase);
  options.onProgress?.(0);
  const res = await putWithProgress(
    `${API_URL}/comment-files/${encodeURIComponent(fileId)}`,
    {
      Authorization: `Bearer ${token}`,
      "Content-Type": file.type || "application/octet-stream",
      ...encodingHeaders(upload),
    },
    upload.body,
    options.onProgress,
    options.signal,
  );
  if (res.status < 200 || res.status >= 300)
    throw new Error(
      res.json.code === "size_mismatch"
        ? "ファイルが途中で欠けました。もう一度添付してください。"
        : res.json.code === "file_too_large"
          ? messageForCode("upload_file_too_large")
          : "ファイルを添付できませんでした。もう一度お試しください。",
    );
  options.onProgress?.(1);
  const result = res.json as unknown as Omit<CommentUploadResult, "thumb">;

  let thumb = false;
  if (options.thumb && result.status === "verified") {
    try {
      const sha256 = await sha256Hex(await options.thumb.arrayBuffer());
      const t = await putWithProgress(
        `${API_URL}/comment-files/${encodeURIComponent(fileId)}/thumb`,
        {
          Authorization: `Bearer ${token}`,
          "Content-Type": options.thumb.type || "image/webp",
          "X-MF100-Sha256": sha256,
        },
        options.thumb,
        undefined,
        options.signal,
      );
      thumb = t.status >= 200 && t.status < 300;
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") throw error;
    }
  }
  return { ...result, thumb };
}

/**
 * コメントの添付の取得。サムネイル（`thumb:{fileId}` の名前で端末の写しに残る）は一覧に何枚も並ぶので、
 * 写しから開くたびの確認はしない（HTTP 側でも 1 日有効）。原本は添付と同じく開くたびに今も見られるかを確かめる
 */
const commentTransport = createTransport((id) =>
  id.startsWith("thumb:")
    ? `${API_URL}/comment-files/${encodeURIComponent(id.slice(6))}/thumb`
    : `${API_URL}/comment-files/${encodeURIComponent(id)}`,
);
export const commentThumbFiles = new ArtifactFiles({
  transport: commentTransport,
  persistence: createCacheStorePersistence(),
  subjectOf: jwtUser,
  policy: defaultFileCachePolicy,
  revalidate: false,
});
export const commentOriginalFiles = new ArtifactFiles({
  transport: commentTransport,
  persistence: createCacheStorePersistence(),
  subjectOf: jwtUser,
  policy: defaultFileCachePolicy,
});

/** サムネイルを取得する。persist は制作物の機密区分から（lib/fileCachePolicy の mayPersist）。機密なら端末に残さない */
export function fetchCommentThumbBlob(
  token: string,
  fileId: string,
  opts?: OpenOptions,
): Promise<Blob> {
  return commentThumbFiles.blob(token, `thumb:${fileId}`, opts);
}

/** 原本を取得する（拡大表示・ダウンロード）。同じ添付の取得は共有され、端末の写しがあればそこから */
export function fetchCommentFileBlob(
  token: string,
  fileId: string,
  opts?: OpenOptions,
): Promise<Blob> {
  return commentOriginalFiles.blob(token, fileId, opts);
}

/** コメントの添付を手元に保存する */
export async function downloadCommentFile(token: string, fileId: string, fileName: string) {
  saveBlob(await fetchCommentFileBlob(token, fileId), fileName);
}

// ---------------------------------------------------------------- 添付の取得の共通の後始末（サインアウト・トークンの更新）

/** 最新のトークンを返す関数を、添付の取得すべて（版の添付・コメントの添付）に登録する */
export function setFileTokenProvider(fn: (() => string | null) | null) {
  for (const files of [artifactFiles, commentThumbFiles, commentOriginalFiles])
    files.setTokenProvider(fn);
}

/** 利用者が替わった・サインアウトしたとき、keepSubject 以外の写し（メモリと端末）をすべて捨てる */
export async function clearFileStores(token: string | null): Promise<void> {
  const keep = token ? artifactFiles.subjectFor(token) : undefined;
  await Promise.all(
    [artifactFiles, commentThumbFiles, commentOriginalFiles].map((files) => files.clear(keep)),
  );
}
