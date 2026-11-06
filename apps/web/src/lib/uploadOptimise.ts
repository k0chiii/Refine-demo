import {
  PDF_SIGNATURE_WINDOW,
  PNG_OPTIMISE_TIME_BUDGET_MS,
  planUploadOptimisation,
} from "@mf100/domain";
import type { PngWorkerRequest, PngWorkerResponse } from "./pngOptimise.core";

/**
 * アップロード前の可逆な最適化のうち、ファイルの中身を作り直すもの（PNG）。利用者指示 2026-10-19「劣化ゼロだけ」。
 * 画素が 1 つも変わらない PNG に作り直し、時間の上限・小さくなった割合の閾値を満たさなければ元のファイルを上げる。
 * - 動的 import で読む呼び出し側（SubmitDialog・コメントの添付）から使う。WASM は最初の PNG のときだけ Worker が読む
 * - 作り直した File は元と同じ名前・MIME で、準備（申告サイズ）の前に差し替える。申告も実体も作り直した後の PNG になる
 * gzip は転送のときに行う（uploadEncoding.ts。申告サイズは元のまま）。
 */

/** 1 つの PNG を Worker で最適化する。時間の上限を超えたら Worker ごと終了し、null（元のまま）にする */
class PngOptimiser {
  private worker: Worker | null = null;
  private seq = 0;

  async run(bytes: ArrayBuffer, budgetMs: number): Promise<Uint8Array | null> {
    if (typeof Worker === "undefined") return null;
    const worker = (this.worker ??= new Worker(
      new URL("./pngOptimise.worker.ts", import.meta.url),
      {
        type: "module",
      },
    ));
    const id = ++this.seq;
    return new Promise<Uint8Array | null>((resolve) => {
      const done = (value: Uint8Array | null) => {
        clearTimeout(timer);
        worker.removeEventListener("message", onMessage);
        worker.removeEventListener("error", onError);
        resolve(value);
      };
      const onMessage = (e: MessageEvent<PngWorkerResponse>) => {
        if (e.data.id !== id) return;
        done(e.data.kind === "optimised" ? new Uint8Array(e.data.bytes) : null);
      };
      const onError = () => {
        this.dispose();
        done(null);
      };
      const timer = setTimeout(() => {
        this.dispose(); // 時間切れ: 重い処理ごと打ち切る（次の PNG は新しい Worker で）
        done(null);
      }, budgetMs);
      worker.addEventListener("message", onMessage);
      worker.addEventListener("error", onError);
      const request: PngWorkerRequest = { id, bytes };
      worker.postMessage(request, [bytes]);
    });
  }

  dispose() {
    this.worker?.terminate();
    this.worker = null;
  }
}

export interface OptimiseHooks {
  /** 最適化を始めるときに 1 回（「圧縮しています」を出す合図）。最適化する PNG が無ければ呼ばない */
  onStart?: () => void;
}

/**
 * 提出するファイルのうち PNG を可逆に作り直した並びを返す（他のファイルはそのまま）。失敗・時間切れ・得が小さいときは元の File。
 * ファイルごとに時間の上限（PNG_OPTIMISE_TIME_BUDGET_MS）がある。
 */
export async function optimiseFilesForUpload(
  files: readonly File[],
  hooks: OptimiseHooks = {},
): Promise<File[]> {
  const optimiser = new PngOptimiser();
  let started = false;
  try {
    const out: File[] = [];
    for (const file of files) {
      out.push(await optimiseOne(file));
    }
    return out;
  } finally {
    optimiser.dispose();
  }

  async function optimiseOne(file: File): Promise<File> {
    try {
      const head = new Uint8Array(await file.slice(0, PDF_SIGNATURE_WINDOW).arrayBuffer());
      const plan = planUploadOptimisation(
        { fileName: file.name, mimeType: file.type, size: file.size },
        head,
      );
      if (plan !== "png") return file;
      if (!started) {
        started = true;
        hooks.onStart?.();
      }
      const bytes = await optimiser.run(await file.arrayBuffer(), PNG_OPTIMISE_TIME_BUDGET_MS);
      if (!bytes) return file;
      return new File([bytes as BlobPart], file.name, {
        type: file.type || "image/png",
        lastModified: file.lastModified,
      });
    } catch {
      return file; // 最適化は付加的なもの。どんな失敗でも元のファイルをそのまま上げる
    }
  }
}
