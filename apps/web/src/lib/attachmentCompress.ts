import {
  ATTACHMENT_COMPRESS_TIME_BUDGET_MS,
  guessImageMime,
  isAnimatedGif,
  isCompressibleImage,
  renamedFor,
} from "./attachmentCompress.core";
import type { CompressedImage, CompressOptions } from "./attachmentCompress.engine";
import type { CompressWorkerRequest, CompressWorkerResponse } from "./attachmentCompress.worker";

/**
 * コメント・返信の添付を送る前の用意（利用者決定 2026-10-20「添付はできる限り圧縮して良い」）。
 * - 画像（PNG・JPEG・WebP・AVIF・復号できる HEIC）: 長辺 2560 px 以内に縮め、WebP（使える環境では AVIF も試す）に作り直して、
 *   元を含めていちばん小さいものを送る。メタデータ（位置情報など）は作り直した画像には残らない。一覧用のサムネイルも作る。
 *   アニメーション GIF と SVG は作り直さない（SVG は画像として扱わない）。
 * - PDF・文書・その他: そのまま。ダウンロード専用のものを可逆に gzip するのは送るときの用意（lib/uploadEncoding）。
 * 重い処理は Worker（OffscreenCanvas）で行い、使えない環境ではメインスレッドのキャンバスで行う。
 * 失敗・時間切れのときは元のファイルをそのまま送る（圧縮は付加的なもの）。
 */

export interface PreparedAttachment {
  /** 送るファイル（作り直した画像、または元のファイル） */
  file: File;
  /** 利用者が選んだ元の名前・大きさ（作り直す前） */
  originalName: string;
  originalSize: number;
  /** 画像のときの、送るファイルの幅・高さ（px） */
  width?: number;
  height?: number;
  /** 一覧用サムネイル（画像だけ。作れなければ null） */
  thumb: Blob | null;
  /** 作り直した画像を送るか */
  recompressed: boolean;
  /** 変換を行った場所（計測・E2E 用）。画像でない・変換できなかったときは none */
  via: "worker" | "main" | "none";
}

/** Worker を起動できない・起動後に壊れた（メインスレッドの代替に回す）。時間切れとは区別する */
class WorkerUnavailable extends Error {}

class CompressWorker {
  private worker: Worker | null = null;
  private seq = 0;
  /** 変換は 1 枚ずつ（メモリの上限を守る） */
  private chain: Promise<unknown> = Promise.resolve();

  broken = false;

  available(): boolean {
    return !this.broken && typeof Worker !== "undefined" && typeof OffscreenCanvas !== "undefined";
  }

  run(blob: Blob, options: CompressOptions): Promise<CompressedImage | null> {
    const next = this.chain.then(() => this.runOne(blob, options));
    this.chain = next.catch(() => undefined);
    return next;
  }

  private runOne(blob: Blob, options: CompressOptions): Promise<CompressedImage | null> {
    let worker: Worker;
    try {
      worker = this.worker ??= new Worker(
        new URL("./attachmentCompress.worker.ts", import.meta.url),
        { type: "module" },
      );
    } catch {
      this.broken = true;
      return Promise.reject(new WorkerUnavailable());
    }
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      const done = (value: CompressedImage | null) => {
        clearTimeout(timer);
        worker.removeEventListener("message", onMessage);
        worker.removeEventListener("error", onError);
        resolve(value);
      };
      const onMessage = (e: MessageEvent<CompressWorkerResponse>) => {
        if (e.data.id !== id) return;
        done(e.data.ok ? e.data.result : null);
      };
      const onError = () => {
        this.broken = true;
        this.dispose();
        clearTimeout(timer);
        worker.removeEventListener("message", onMessage);
        worker.removeEventListener("error", onError);
        reject(new WorkerUnavailable());
      };
      const timer = setTimeout(() => {
        this.dispose(); // 時間切れ: 重い処理ごと打ち切る（次の画像は新しい Worker で）
        done(null);
      }, ATTACHMENT_COMPRESS_TIME_BUDGET_MS);
      worker.addEventListener("message", onMessage);
      worker.addEventListener("error", onError);
      const request: CompressWorkerRequest = { id, blob, options };
      worker.postMessage(request);
    });
  }

  dispose() {
    this.worker?.terminate();
    this.worker = null;
  }
}

const compressWorker = new CompressWorker();

/** Worker か OffscreenCanvas が使えない環境の代替（メインスレッド。engine と env は動的に読む） */
async function runOnMainThread(
  blob: Blob,
  options: CompressOptions,
): Promise<CompressedImage | null> {
  try {
    const [{ compressImage }, { createCanvasEnv }] = await Promise.all([
      import("./attachmentCompress.engine"),
      import("./attachmentCompress.env"),
    ]);
    return await compressImage(blob, createCanvasEnv("dom"), options);
  } catch {
    return null;
  }
}

async function recodeModeFor(file: File, mime: string): Promise<CompressOptions["recode"]> {
  if (mime === "image/heic" || mime === "image/heif" || mime === "image/bmp") return "force";
  if (mime === "image/gif") {
    // 先頭の一部だけ読んで動く GIF かを調べる（途中で終わっていたら動くものとみなして触らない）
    const head = new Uint8Array(await file.slice(0, 2_000_000).arrayBuffer());
    return isAnimatedGif(head) ? "never" : "auto";
  }
  return "auto";
}

/** 添付 1 つを送れる形にする。画像でなければそのまま（thumb なし） */
export async function prepareAttachment(file: File): Promise<PreparedAttachment> {
  const passthrough = (over: Partial<PreparedAttachment> = {}): PreparedAttachment => ({
    file,
    originalName: file.name,
    originalSize: file.size,
    thumb: null,
    recompressed: false,
    via: "none",
    ...over,
  });
  if (!isCompressibleImage(file)) return passthrough();

  const mime = guessImageMime(file);
  const typed = file.type === mime ? file : new File([file], file.name, { type: mime });
  const options: CompressOptions = {
    originalSize: file.size,
    recode: await recodeModeFor(file, mime),
  };
  let result: CompressedImage | null = null;
  let via: PreparedAttachment["via"] = "worker";
  try {
    result = compressWorker.available() ? await compressWorker.run(file, options) : null;
    if (!compressWorker.available() && result === null) {
      via = "main";
      result = await runOnMainThread(file, options);
    }
  } catch (error) {
    // Worker を使えなかったときだけ、メインスレッドの代替で試す（時間切れの重い画像は試さない）
    via = "main";
    result = error instanceof WorkerUnavailable ? await runOnMainThread(file, options) : null;
  }
  if (!result) return passthrough({ file: typed });

  if (result.body) {
    const out = new File([result.body.blob], renamedFor(file.name, result.body.type), {
      type: result.body.type,
    });
    return passthrough({
      file: out,
      width: result.width,
      height: result.height,
      thumb: result.thumb?.blob ?? null,
      recompressed: true,
      via,
    });
  }
  return passthrough({
    file: typed,
    width: result.width,
    height: result.height,
    thumb: result.thumb?.blob ?? null,
    via,
  });
}
