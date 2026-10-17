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

// ---------------------------------------------------------------- Figma の取り込み（デモ: 同梱の見本 PNG を使う。ネットワーク無し）

export interface FigmaImportItemInput {
  itemId: string;
  fileKey: string;
  nodeId: string;
}
export interface FigmaImportItemResult {
  itemId: string;
  status: string;
  failureMessage: string | null;
  nodeName: string | null;
}

export async function figmaStatus(_token: string): Promise<{ enabled: boolean }> {
  return { enabled: true };
}

/**
 * 本番の Worker（/figma/import）と同じ手順を、Figma API の代わりに public/demo-figma の見本 PNG で踏む
 * （試行の開始 → 実体の保持 → ノード名などを添えて採用）。ノード名・大きさは見本の固定値
 */
export async function importFigmaFrames(
  _token: string,
  items: FigmaImportItemInput[],
): Promise<FigmaImportItemResult[]> {
  const out: FigmaImportItemResult[] = [];
  for (const [i, it] of items.entries()) {
    const sample = DEMO_FRAMES[i % DEMO_FRAMES.length]!;
    try {
      const res = await fetch(sample.path);
      if (!res.ok) throw new Error("見本の画像を読めませんでした");
      const bytes = await res.arrayBuffer();
      const file = new File([bytes], sample.fileName, { type: "image/png" });
      const sha = await sha256Hex(bytes);
      await new Promise((r) => setTimeout(r, 300));
      const done = await demo.uploadItem(it.itemId, file, sha, {
        nodeName: sample.nodeName,
        figmaVersion: "demo",
        lastModified: new Date().toISOString(),
        box: sample.box,
      });
      out.push({
        itemId: it.itemId,
        status: done.status,
        failureMessage: done.failureMessage,
        nodeName: sample.nodeName,
      });
    } catch (error) {
      out.push({
        itemId: it.itemId,
        status: "failed",
        failureMessage: error instanceof Error ? error.message : "取り込みに失敗しました",
        nodeName: null,
      });
    }
  }
  return out;
}

const DEMO_FRAMES = [
  {
    path: "/demo-figma/home-mobile.png",
    fileName: "home-mobile.png",
    nodeName: "ホーム（スマホ）",
    box: { width: 402, height: 874 },
  },
  {
    path: "/demo-figma/home-pc.png",
    fileName: "home-pc.png",
    nodeName: "ホーム（PC）",
    box: { width: 1440, height: 1600 },
  },
];
