import { DomainError } from "../shared/DomainError.ts";
import type { ArtifactId, RevisionId } from "../shared/ids.ts";

export type ArtifactRole = "source" | "preview" | "external";
export type ArtifactType = "pdf" | "image" | "document" | "video" | "other" | "external_link";

/** アップロード実体の検証状態。verified になるまで版は提出確定できない（F-04 / A-02 / A-16）。 */
export type ArtifactStatus = "pending" | "uploaded" | "verified" | "failed";

/**
 * 添付の由来（画像・PDF がどこから来たか。docs/FIGMA_WEB_PROOFING.md §6.1）。校正の座標は従来どおり画像基準。
 * - figma: Figma の REST API で書き出したフレーム（fileKey・nodeId・ノード名・Figma 側の版・取得倍率・フレームの大きさ）。
 *   画像の 0..1 は `node_offset = {x: rect.x * box.width, y: rect.y * box.height}` で Figma のフレーム座標に戻せる
 * - web_snapshot: サイトのスクリーンショット（URL・端末・ビューポート・撮影時刻。撮影の自動化は承認後）
 */
export type ArtifactOrigin =
  | {
      kind: "figma";
      fileKey: string;
      nodeId: string;
      nodeName?: string;
      figmaVersion?: string;
      lastModified?: string;
      scale: number;
      box: { width: number; height: number };
    }
  | {
      kind: "web_snapshot";
      url: string;
      deviceId?: string;
      viewport: {
        width: number;
        height: number;
        dpr: number;
        orientation: "portrait" | "landscape";
      };
      userAgent?: string;
      fullPage: boolean;
      capturedAt: number;
    };

export interface Artifact {
  id: ArtifactId;
  revisionId: RevisionId;
  type: ArtifactType;
  role: ArtifactRole;
  fileName: string;
  mimeType: string;
  /** R2 のオブジェクトキー（外部リンクの場合は未設定）。 */
  objectKey?: string;
  externalUrl?: string;
  sha256?: string;
  size?: number;
  pageCount?: number;
  status: ArtifactStatus;
  failureMessage?: string;
  /** 由来（Figma から取り込んだ・サイトのスクリーンショット）。無ければ提出されたファイル */
  origin?: ArtifactOrigin;
}

/** ライブ表示（iframe）の対象になる添付: http(s) の外部リンク（Figma の URL は埋め込み表示なので除く） */
export function isWebLiveArtifact(
  a: Pick<Artifact, "role"> & { externalUrl?: string | undefined },
): boolean {
  return (
    a.role === "external" &&
    typeof a.externalUrl === "string" &&
    /^https?:\/\//i.test(a.externalUrl) &&
    !isFigmaUrl(a.externalUrl)
  );
}

/** Figma のファイル・プロトタイプの URL か（埋め込み表示とフレーム単位のコメントの対象） */
export function isFigmaUrl(url: string): boolean {
  return /^https:\/\/(?:www\.)?figma\.com\/(?:design|file|proto|board|slides)\//i.test(url);
}

/** 外部リンクは実体検証対象外。R2 添付はすべて verified であること。 */
export function assertArtifactsReadyForConfirm(artifacts: readonly Artifact[]): void {
  if (artifacts.length === 0) throw new DomainError("revision_no_artifacts");
  const notReady = artifacts.filter((a) => a.role !== "external" && a.status !== "verified");
  if (notReady.length > 0) {
    throw new DomainError("revision_artifacts_not_verified", {
      artifacts: notReady.map((a) => ({
        id: a.id,
        fileName: a.fileName,
        status: a.status,
        failureMessage: a.failureMessage,
      })),
    });
  }
}

/**
 * 紙面に出して範囲コメントを付けられる種類（PDF・画像・文章・動画）。.ai などは保管・ダウンロードだけ。
 * 並びは版を開いたときに選ぶ順（pickReviewArtifact）
 */
export const reviewableArtifactTypes: readonly ArtifactType[] = [
  "pdf",
  "image",
  "document",
  "video",
];

export function isReviewableArtifact(a: Pick<Artifact, "type" | "role">): boolean {
  return a.role !== "external" && reviewableArtifactTypes.includes(a.type);
}

/**
 * 版を開いたときに紙面に出す添付（利用者指示 2026-10-15: 画像の制作物は PDF と .ai を一緒に出すことがあり、
 * コメントは基本 PDF に付ける。.ai は手元で開きたい人がダウンロードする）。
 * 提出の順番によらず PDF → 画像 → 文章 → 動画 の順で選ぶ。`prefer`（制作物の媒体。動画の制作物なら video）が
 * あればその種類を先に選ぶ（動画に表紙の画像や絵コンテの PDF を添えて出しても、動画が出る）。
 * 紙面に出せる添付が無ければ、外部リンク以外の最初の添付。
 */
export function pickReviewArtifact<A extends Pick<Artifact, "type" | "role">>(
  artifacts: readonly A[],
  prefer?: ArtifactType,
): A | null {
  const order = prefer
    ? [prefer, ...reviewableArtifactTypes.filter((t) => t !== prefer)]
    : reviewableArtifactTypes;
  for (const type of order) {
    const hit = artifacts.find((a) => a.role !== "external" && a.type === type);
    if (hit) return hit;
  }
  return artifacts.find((a) => a.role !== "external") ?? null;
}

const SOURCE_FORMATS: Record<string, string> = {
  ai: "Illustrator",
  psd: "Photoshop",
  indd: "InDesign",
  eps: "EPS",
  fig: "Figma",
  sketch: "Sketch",
  xd: "Adobe XD",
  clip: "CLIP STUDIO",
};

/** 添付の形式の呼び名（ファイル一覧に出す）。拡張子で決め、知らない形式は拡張子を大文字にする */
export function artifactFormatLabel(a: Pick<Artifact, "type" | "fileName">): string {
  if (a.type === "pdf") return "PDF";
  if (a.type === "image") return "画像";
  if (a.type === "document") return "文章";
  if (a.type === "video") return "動画";
  if (a.type === "external_link") return "外部リンク";
  const ext = /\.([a-z0-9]+)$/i.exec(a.fileName)?.[1]?.toLowerCase() ?? "";
  return SOURCE_FORMATS[ext] ?? (ext ? ext.toUpperCase() : "ファイル");
}
