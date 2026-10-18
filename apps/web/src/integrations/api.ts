import { createCacheStorePersistence } from "@/lib/artifactCacheStore";
import {
  ArtifactError,
  ArtifactFiles,
  type ArtifactTransport,
  type OpenOptions,
} from "@/lib/artifactFiles";
import { defaultFileCachePolicy } from "@/lib/fileCachePolicy";
import { jwtUser } from "@/lib/jwt";

/** Hono API（ファイル提出・配信）。業務データは Convex、ファイルはこちら、の境界を守る。 */
export const API_URL = (import.meta.env.VITE_API_URL ?? "http://127.0.0.1:8787").replace(/\/$/, "");

export async function sha256Hex(data: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export interface UploadResult {
  itemId: string;
  status: string;
  failureMessage: string | null;
  size: number;
}

export async function uploadItem(
  token: string,
  itemId: string,
  file: File,
  onProgress?: (fraction: number) => void,
): Promise<UploadResult> {
  const buffer = await file.arrayBuffer();
  const sha = await sha256Hex(buffer);
  onProgress?.(0.1);
  const res = await fetch(`${API_URL}/uploads/items/${encodeURIComponent(itemId)}`, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": file.type || "application/octet-stream",
      "X-MF100-Sha256": sha,
    },
    body: buffer,
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
        : "ファイルをアップロードできませんでした。もう一度お試しください。",
    );
  return json as UploadResult;
}

/**
 * 認可付きの添付の取得（Hono GET /files/:id）。署名付き URL は無いので、毎回 Bearer を付ける（Worker が毎回認可する）。
 * 範囲取得（Range）・条件付き取得（If-None-Match → 304）に対応。応答の本体はストリームのまま渡す。
 */
const transport: ArtifactTransport = {
  async request({ token, artifactId, start, end, ifNoneMatch, ifRange, signal }) {
    const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
    if (start !== undefined) headers.Range = `bytes=${start}-${end !== undefined ? end : ""}`;
    if (ifNoneMatch) headers["If-None-Match"] = ifNoneMatch;
    if (ifRange) headers["If-Range"] = ifRange;
    let res: Response;
    try {
      res = await fetch(`${API_URL}/files/${encodeURIComponent(artifactId)}`, {
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
};

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
  const buffer = await file.arrayBuffer();
  const sha = await sha256Hex(buffer);
  onProgress?.(0.1);
  const res = await fetch(`${API_URL}/feedback/files/${encodeURIComponent(fileId)}`, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": file.type || "application/octet-stream",
      "X-MF100-Sha256": sha,
    },
    body: buffer,
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
