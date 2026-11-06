import { FigmaApiError, type FigmaClient, type ObjectStore, type UploadOps } from "./ports.ts";

/** ブラウザから来る取り込みの指示（項目は Convex の prepare で由来 figma 付きに作ってある） */
export interface FigmaImportItem {
  itemId: string;
  fileKey: string;
  /** 「1:2」 */
  nodeId: string;
}

export interface FigmaImportResult {
  itemId: string;
  status: "verified" | "failed";
  failureMessage: string | null;
  nodeName: string | null;
}

export interface FigmaImportDeps {
  figma: FigmaClient;
  uploads: UploadOps;
  store: ObjectStore;
  /** 書き出しの倍率（domain の FigmaPolicy.renderScale） */
  scale: number;
  /** 429 のあとに待つ（テストでは即時） */
  sleep?: (ms: number) => Promise<void>;
}

const FILE_KEY = /^[A-Za-z0-9]{10,128}$/;
const NODE_ID = /^\d+:\d+$/;
const MAX_ITEMS = 50;
const RETRY_AFTER_MAX_SEC = 20;

/**
 * Figma のフレームを画像にして、版の提出物として R2 に入れる（docs/FIGMA_WEB_PROOFING.md FG-05・§6.2）。
 * - ファイルごとに `nodes` と `images` を 1 回ずつ（1 版＝1 ファイルなら 1 リクエスト。レート制限に収める）
 * - 画像はブラウザからの PUT と同じ道（試行の開始 → R2 に保存（sha256 を R2 が確かめる）→ 採用）を通す。
 *   よって項目は普通のアップロードと同じく verified になり、確定・配信・清掃も同じ
 * - 429 は Retry-After を 1 回だけ尊重して待つ。失敗は項目を failed にして理由を残す（F-04 と同じ）
 * - 業務の判断（持ち主か・受付中か）は Convex（UploadOps）が行う。ここは取得と転送だけ
 */
export async function importFigmaFrames(
  deps: FigmaImportDeps,
  token: string,
  items: readonly FigmaImportItem[],
): Promise<FigmaImportResult[]> {
  const sleep = deps.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  const results = new Map<string, FigmaImportResult>();
  const fail = (it: FigmaImportItem, message: string) =>
    results.set(it.itemId, {
      itemId: it.itemId,
      status: "failed",
      failureMessage: message,
      nodeName: null,
    });

  const valid = items.slice(0, MAX_ITEMS).filter((it) => {
    if (!FILE_KEY.test(it.fileKey) || !NODE_ID.test(it.nodeId)) {
      fail(it, "Figma の URL を解釈できませんでした（ファイルキーかノード ID が不正）");
      return false;
    }
    return true;
  });
  const byFile = new Map<string, FigmaImportItem[]>();
  for (const it of valid) byFile.set(it.fileKey, [...(byFile.get(it.fileKey) ?? []), it]);

  /** 429 なら Retry-After だけ待って 1 回やり直す */
  const withRetry = async <T>(fn: () => Promise<T>): Promise<T> => {
    try {
      return await fn();
    } catch (error) {
      if (error instanceof FigmaApiError && error.status === 429) {
        const wait = Math.min(error.retryAfterSec ?? 5, RETRY_AFTER_MAX_SEC);
        await sleep(wait * 1000);
        return fn();
      }
      throw error;
    }
  };

  for (const [fileKey, group] of byFile) {
    const ids = [...new Set(group.map((g) => g.nodeId))];
    let meta: Awaited<ReturnType<FigmaClient["getNodes"]>>;
    let images: Map<string, string | null>;
    try {
      meta = await withRetry(() => deps.figma.getNodes(fileKey, ids));
      images = await withRetry(() => deps.figma.renderImages(fileKey, ids, deps.scale));
    } catch (error) {
      const message = describeFigmaError(error);
      for (const it of group) await failItem(deps, token, it, message, fail);
      continue;
    }
    for (const it of group) {
      const node = meta.nodes.get(it.nodeId);
      const url = images.get(it.nodeId) ?? null;
      if (!node) {
        await failItem(
          deps,
          token,
          it,
          "Figma にそのノードが見つかりません（削除された・URL のノード ID が違う）",
          fail,
        );
        continue;
      }
      if (!url) {
        await failItem(
          deps,
          token,
          it,
          `Figma がフレーム「${node.name}」を画像にできませんでした`,
          fail,
        );
        continue;
      }
      try {
        const bytes = await deps.figma.download(url);
        const sha256 = await sha256Hex(bytes);
        const target = await deps.uploads.begin(token, it.itemId);
        try {
          await deps.store.put(target.objectKey, bytes, {
            contentType: "image/png",
            sha256Hex: sha256,
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : "R2 への保存に失敗しました";
          await deps.store.delete(target.objectKey).catch(() => undefined);
          await deps.uploads.fail(token, target.attemptId, message).catch(() => undefined);
          fail(it, message);
          continue;
        }
        const done = await deps.uploads.complete(token, target.attemptId, {
          size: bytes.byteLength,
          sha256,
          figma: {
            nodeName: node.name,
            box: node.box ?? { width: 0, height: 0 },
            ...(meta.version ? { figmaVersion: meta.version } : {}),
            ...(meta.lastModified ? { lastModified: meta.lastModified } : {}),
          },
        });
        if (done.status !== "verified")
          await deps.store.delete(target.objectKey).catch(() => undefined);
        results.set(it.itemId, {
          itemId: it.itemId,
          status: done.status === "verified" ? "verified" : "failed",
          failureMessage: done.failureMessage,
          nodeName: node.name,
        });
      } catch (error) {
        // 試行の開始・採用で Convex が拒否した（他人の項目・受付終了）か、画像の取得に失敗した
        await failItem(deps, token, it, describeFigmaError(error), fail, false);
      }
    }
  }
  return items.map(
    (it) =>
      results.get(it.itemId) ?? {
        itemId: it.itemId,
        status: "failed",
        failureMessage: "取り込みの対象になりませんでした（1 回に取り込めるのは 50 枚まで）",
        nodeName: null,
      },
  );
}

/** 項目を failed にする（試行を開いて閉じる。Convex が拒否するものは記録せず結果だけ返す） */
async function failItem(
  deps: FigmaImportDeps,
  token: string,
  it: FigmaImportItem,
  message: string,
  fail: (it: FigmaImportItem, message: string) => void,
  record = true,
) {
  fail(it, message);
  if (!record) return;
  try {
    const target = await deps.uploads.begin(token, it.itemId);
    await deps.uploads.fail(token, target.attemptId, message);
  } catch {
    // 項目が無い・受付終了: 結果にだけ残す
  }
}

export function describeFigmaError(error: unknown): string {
  if (error instanceof FigmaApiError) {
    if (error.status === 429)
      return "Figma の API の回数制限にかかりました。しばらく待ってから再試行してください";
    if (error.status === 403 || error.status === 401)
      return "Figma のトークンにこのファイルを読む権限がありません（ファイルの共有設定とトークンのスコープ file_content:read を確認）";
    if (error.status === 404)
      return "Figma にそのファイルが見つかりません（URL のファイルキーを確認）";
    return `Figma の API が応答しませんでした（${error.status}）`;
  }
  if (error instanceof Error && error.name === "GatewayError")
    return `取り込みを受け付けられませんでした（${error.message}）`;
  return error instanceof Error ? error.message : "Figma から取り込めませんでした";
}

async function sha256Hex(buf: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", buf);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
