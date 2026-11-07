/**
 * `@/integrations/api`（本番）と `demo/api.ts`（デモの差し替え）が共有する型。
 * デモは `@/integrations/api` をこの別ファイルでなく demo/api.ts へ向けるので、型だけをここに出して循環を避ける。
 */
import type { UploadPhase } from "@/lib/uploadEncoding";

export interface UploadResult {
  itemId: string;
  status: string;
  failureMessage: string | null;
  size: number;
}

export interface CommentUploadResult {
  fileId: string;
  status: string;
  failureMessage: string | null;
  size: number;
  /** サムネイルも置けたか（置けなくても添付は有効。一覧は原本で代替する） */
  thumb: boolean;
}

export interface CommentUploadOptions {
  /** 一覧用のサムネイル（attachmentCompress が作る WebP）。無ければ送らない */
  thumb?: Blob | null;
  /** 原本の送信の進み具合（0〜1。実際に送った量。圧縮・ハッシュの計算が済んでから動き出す） */
  onProgress?: (fraction: number) => void;
  /** 中止（本文の送信を打ち切る） */
  signal?: AbortSignal;
  onPhase?: (phase: UploadPhase) => void;
}

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
