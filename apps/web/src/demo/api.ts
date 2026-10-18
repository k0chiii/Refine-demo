/** `@/integrations/api` の差し替え（デモモード）: Hono/R2 の代わりにメモリ上の Blob を使う。 */
import { createCacheStorePersistence } from "@/lib/artifactCacheStore";
import {
  ArtifactError,
  ArtifactFiles,
  type ArtifactTransport,
  type OpenOptions,
} from "@/lib/artifactFiles";
import { defaultFileCachePolicy } from "@/lib/fileCachePolicy";
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

/**
 * 擬似回線（E2E・計測用）。`globalThis.__mf100DemoNet = { latencyMs, bytesPerSec }` を先に置くと、添付の取得が
 * 往復の遅れと帯域に従って届く（既定は即時）。本番の Worker と同じく Range / ETag / 304 に応じる
 */
type DemoNet = { latencyMs?: number; bytesPerSec?: number };
const demoNet = (): DemoNet => (globalThis as { __mf100DemoNet?: DemoNet }).__mf100DemoNet ?? {};
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const DEMO_CHUNK = 32 * 1024;
/** デモの通信回数（E2E が「同じ添付を何回取りに行ったか」を数える） */
const demoRequests: Array<{ artifactId: string; start?: number; end?: number; status: number }> =
  [];
(globalThis as { __mf100DemoRequests?: typeof demoRequests }).__mf100DemoRequests = demoRequests;

const demoTransport: ArtifactTransport = {
  async request({ artifactId, start, end, ifNoneMatch, ifRange, signal }) {
    const { latencyMs = 0, bytesPerSec = 0 } = demoNet();
    if (latencyMs) await sleep(latencyMs);
    let blob: Blob;
    try {
      blob = await demo.fetchArtifact(artifactId); // 認可は Convex の authorizeAccess（毎回）
    } catch {
      demoRequests.push({ artifactId, status: 403 });
      throw new ArtifactError(403);
    }
    const etag = `"demo-${artifactId}-${blob.size}"`;
    if (ifNoneMatch && ifNoneMatch === etag) {
      demoRequests.push({ artifactId, status: 304 });
      return {
        status: 304,
        etag,
        contentType: blob.type || null,
        total: blob.size,
        start: 0,
        rangeSupported: true,
        body: null,
      };
    }
    const ranged = start !== undefined && (!ifRange || ifRange === etag);
    const from = ranged ? start : 0;
    const to = ranged ? Math.min(end === undefined ? blob.size : end + 1, blob.size) : blob.size;
    demoRequests.push({
      artifactId,
      status: ranged ? 206 : 200,
      ...(ranged ? { start: from, end: to - 1 } : {}),
    });
    let offset = from;
    const body = new ReadableStream<Uint8Array>({
      async pull(controller) {
        if (signal?.aborted) return controller.error(new DOMException("aborted", "AbortError"));
        if (offset >= to) return controller.close();
        const next = Math.min(offset + DEMO_CHUNK, to);
        if (bytesPerSec) await sleep(((next - offset) / bytesPerSec) * 1000);
        controller.enqueue(new Uint8Array(await blob.slice(offset, next).arrayBuffer()));
        offset = next;
      },
    });
    return {
      status: ranged ? 206 : 200,
      etag,
      contentType: blob.type || null,
      total: blob.size,
      start: from,
      rangeSupported: true,
      body,
    };
  },
};

/**
 * デモのデータは読み込みのたびに作り直される（添付 ID が同じでも中身は別）ので、端末の写しの持ち主に読み込みごとの印を足し、
 * 前の読み込みの写しは使わない。同じ読み込みの中では本番と同じ経路（メモリ → Cache Storage → 通信）を通る
 */
const demoLoadId = Math.random().toString(36).slice(2, 8);
export const artifactFiles = new ArtifactFiles({
  transport: demoTransport,
  persistence: createCacheStorePersistence(),
  subjectOf: () => `${demo.userId ?? "demo"}@${demoLoadId}`,
  policy: defaultFileCachePolicy,
});
(globalThis as { __mf100Files?: ArtifactFiles }).__mf100Files = artifactFiles;

export function fetchArtifactBlob(
  token: string,
  artifactId: string,
  opts?: OpenOptions,
): Promise<Blob> {
  return artifactFiles.blob(token, artifactId, opts);
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
