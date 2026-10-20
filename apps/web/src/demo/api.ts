/** `@/integrations/api` の差し替え（デモモード）: Hono/R2 の代わりにメモリ上の Blob を使う。 */
import { createCacheStorePersistence } from "@/lib/artifactCacheStore";
import {
  ArtifactError,
  ArtifactFiles,
  type ArtifactTransport,
  type OpenOptions,
} from "@/lib/artifactFiles";
import { defaultFileCachePolicy } from "@/lib/fileCachePolicy";
import { messageForCode } from "@/lib/errors";
import {
  UploadTooLargeError,
  encodeForUpload,
  sha256Hex,
  type EncodedUpload,
  type UploadPhase,
} from "@/lib/uploadEncoding";
import { demo } from "./backend";

export const API_URL = "demo://";

export { sha256Hex };

/** 本番と同じ用意（ダウンロード専用の原本は gzip）。圧縮しても上限に収まらないときは理由つきで断る */
async function encodeOrExplain(
  file: File,
  onPhase?: (phase: UploadPhase) => void,
): Promise<EncodedUpload> {
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
/** デモの転送の記録（E2E が「圧縮して上げたか・何バイトで置いたか」を確かめる） */
const demoUploads: Array<{
  fileName: string;
  encoding: string;
  originalSize: number;
  storedSize: number;
}> = [];
(globalThis as { __mf100DemoUploads?: typeof demoUploads }).__mf100DemoUploads = demoUploads;
const gzipOf = (u: EncodedUpload) =>
  u.encoding === "gzip" ? { body: u.body, originalSize: u.originalSize } : undefined;

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
  onPhase?: (phase: UploadPhase) => void,
): Promise<UploadResult> {
  const upload = await encodeOrExplain(file, onPhase);
  onProgress?.(0.3);
  await new Promise((r) => setTimeout(r, 300)); // 転送中の表示を見せる
  const res = await demo.uploadItem(itemId, file, upload.sha256, undefined, gzipOf(upload));
  demoUploads.push({
    fileName: file.name,
    encoding: upload.encoding,
    originalSize: upload.originalSize,
    storedSize: upload.body.size,
  });
  onProgress?.(1);
  return {
    itemId,
    status: res.status,
    failureMessage: res.failureMessage,
    size: upload.originalSize,
  };
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

const createDemoTransport = (fetchBlob: (id: string) => Promise<Blob>): ArtifactTransport => ({
  async request({ artifactId, start, end, ifNoneMatch, ifRange, signal }) {
    const { latencyMs = 0, bytesPerSec = 0 } = demoNet();
    if (latencyMs) await sleep(latencyMs);
    let blob: Blob;
    try {
      blob = await fetchBlob(artifactId); // 認可は Convex の authorize*（毎回）
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
});
const demoTransport = createDemoTransport((id) => demo.fetchArtifact(id));

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

// ---------------------------------------------------------------- コメント・返信の添付（本番の /comment-files/* と同じ流れ）

export interface CommentUploadResult {
  fileId: string;
  status: string;
  failureMessage: string | null;
  size: number;
  thumb: boolean;
}

export interface CommentUploadOptions {
  thumb?: Blob | null;
  onProgress?: (fraction: number) => void;
  signal?: AbortSignal;
  onPhase?: (phase: UploadPhase) => void;
}

export async function uploadCommentFile(
  _token: string,
  fileId: string,
  file: File,
  options: CommentUploadOptions = {},
): Promise<CommentUploadResult> {
  const upload = await encodeOrExplain(file, options.onPhase);
  options.onProgress?.(0);
  // 転送中の表示を見せる（本番の XHR の進み具合のまね）
  for (const step of [0.3, 0.7]) {
    await new Promise((r) => setTimeout(r, 120));
    if (options.signal?.aborted) throw new DOMException("aborted", "AbortError");
    options.onProgress?.(step);
  }
  const res = await demo.uploadCommentFile(fileId, file, upload.sha256, gzipOf(upload));
  demoUploads.push({
    fileName: file.name,
    encoding: upload.encoding,
    originalSize: upload.originalSize,
    storedSize: upload.body.size,
  });
  options.onProgress?.(1);
  let thumb = false;
  if (options.thumb && res.status === "verified") {
    try {
      await demo.uploadCommentThumb(fileId, options.thumb);
      thumb = true;
    } catch {
      // サムネイルの失敗は添付の失敗にしない
    }
  }
  return {
    fileId,
    status: res.status,
    failureMessage: res.failureMessage,
    size: upload.originalSize,
    thumb,
  };
}

const demoCommentTransport = createDemoTransport((id) =>
  id.startsWith("thumb:")
    ? demo.fetchCommentFile(id.slice(6), "thumb")
    : demo.fetchCommentFile(id, "original"),
);
const commentStore = (revalidate: boolean) =>
  new ArtifactFiles({
    transport: demoCommentTransport,
    persistence: createCacheStorePersistence(),
    subjectOf: () => `${demo.userId ?? "demo"}@${demoLoadId}`,
    policy: defaultFileCachePolicy,
    revalidate,
  });
export const commentThumbFiles = commentStore(false);
export const commentOriginalFiles = commentStore(true);

export function fetchCommentThumbBlob(
  token: string,
  fileId: string,
  opts?: OpenOptions,
): Promise<Blob> {
  return commentThumbFiles.blob(token, `thumb:${fileId}`, opts);
}

export function fetchCommentFileBlob(
  token: string,
  fileId: string,
  opts?: OpenOptions,
): Promise<Blob> {
  return commentOriginalFiles.blob(token, fileId, opts);
}

export async function downloadCommentFile(token: string, fileId: string, fileName: string) {
  saveBlob(await fetchCommentFileBlob(token, fileId), fileName);
}

export function setFileTokenProvider(fn: (() => string | null) | null) {
  for (const files of [artifactFiles, commentThumbFiles, commentOriginalFiles])
    files.setTokenProvider(fn);
}

export async function clearFileStores(token: string | null): Promise<void> {
  const keep = token ? artifactFiles.subjectFor(token) : undefined;
  await Promise.all(
    [artifactFiles, commentThumbFiles, commentOriginalFiles].map((files) => files.clear(keep)),
  );
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
