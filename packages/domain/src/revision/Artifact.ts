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
      artifacts: notReady.map((a) => ({ id: a.id, fileName: a.fileName, status: a.status, failureMessage: a.failureMessage })),
    });
  }
}
