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
