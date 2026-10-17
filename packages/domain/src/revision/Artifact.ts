import { DomainError } from "../shared/DomainError.ts";
import type { ArtifactId, RevisionId } from "../shared/ids.ts";

export type ArtifactRole = "source" | "preview" | "external";
export type ArtifactType = "pdf" | "image" | "document" | "other" | "external_link";

/** アップロード実体の検証状態。verified になるまで版は提出確定できない（F-04 / A-02 / A-16）。 */
export type ArtifactStatus = "pending" | "uploaded" | "verified" | "failed";

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

/** 紙面に出して範囲コメントを付けられる種類（PDF・画像・文章）。.ai などは保管・ダウンロードだけ */
export const reviewableArtifactTypes: readonly ArtifactType[] = ["pdf", "image", "document"];

export function isReviewableArtifact(a: Pick<Artifact, "type" | "role">): boolean {
  return a.role !== "external" && reviewableArtifactTypes.includes(a.type);
}

/**
 * 版を開いたときに紙面に出す添付（利用者指示 2026-10-15: 画像の制作物は PDF と .ai を一緒に出すことがあり、
 * コメントは基本 PDF に付ける。.ai は手元で開きたい人がダウンロードする）。
 * 提出の順番によらず PDF → 画像 → 文章 の順で選ぶ。紙面に出せる添付が無ければ、外部リンク以外の最初の添付。
 */
export function pickReviewArtifact<A extends Pick<Artifact, "type" | "role">>(
  artifacts: readonly A[],
): A | null {
  for (const type of reviewableArtifactTypes) {
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
  if (a.type === "external_link") return "外部リンク";
  const ext = /\.([a-z0-9]+)$/i.exec(a.fileName)?.[1]?.toLowerCase() ?? "";
  return SOURCE_FORMATS[ext] ?? (ext ? ext.toUpperCase() : "ファイル");
}
