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

/** 認可付きで添付を取得する。署名付き URL は無いので毎回 Bearer を付ける。 */
export async function fetchArtifactBlob(token: string, artifactId: string): Promise<Blob> {
  const res = await fetch(`${API_URL}/files/${encodeURIComponent(artifactId)}`, {
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
