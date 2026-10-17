/** `@/integrations/api` の差し替え（デモモード）: Hono/R2 の代わりにメモリ上の Blob を使う。 */
import { demo } from "./backend";

export const API_URL = "demo://";

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
  _token: string,
  itemId: string,
  file: File,
  onProgress?: (fraction: number) => void,
): Promise<UploadResult> {
  onProgress?.(0.3);
  const sha = await sha256Hex(await file.arrayBuffer());
  await new Promise((r) => setTimeout(r, 300)); // 転送中の表示を見せる
  const res = await demo.uploadItem(itemId, file, sha);
  onProgress?.(1);
  return { itemId, status: res.status, failureMessage: res.failureMessage, size: file.size };
}

export async function fetchArtifactBlob(_token: string, artifactId: string): Promise<Blob> {
  return demo.fetchArtifact(artifactId);
}

export async function downloadArtifact(token: string, artifactId: string, fileName: string) {
  saveBlob(await fetchArtifactBlob(token, artifactId), fileName);
}

export interface FeedbackUploadResult {
  fileId: string;
  status: string;
  failureMessage: string | null;
  size: number;
}

export async function uploadFeedbackFile(
  _token: string,
  fileId: string,
  file: File,
  onProgress?: (fraction: number) => void,
): Promise<FeedbackUploadResult> {
  onProgress?.(0.3);
  const sha = await sha256Hex(await file.arrayBuffer());
  await new Promise((r) => setTimeout(r, 300)); // 転送中の表示を見せる
  const res = await demo.uploadFeedbackFile(fileId, file, sha);
  onProgress?.(1);
  return { fileId, status: res.status, failureMessage: res.failureMessage, size: file.size };
}

export async function fetchFeedbackFileBlob(_token: string, fileId: string): Promise<Blob> {
  return demo.fetchFeedbackFile(fileId);
}

export async function downloadFeedbackFile(token: string, fileId: string, fileName: string) {
  saveBlob(await fetchFeedbackFileBlob(token, fileId), fileName);
}

function saveBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
