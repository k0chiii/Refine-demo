import { api } from "@mf100/convex/api";
import type { Id } from "@mf100/convex/dataModel";
import { pickReviewArtifact } from "@mf100/domain";
import { Suspense, useMemo } from "react";
import { useQuery } from "convex/react";
import { PdfViewer } from "@/features/annotation/lazyViewers";
import { useArtifactBlob } from "@/features/annotation/useArtifactBlob";
import { Loading } from "@/ui/Loading";

/** 詳細画面の PDF プレビュー（採用中または最新版の添付） */
export function WorkDetailPreview({
  workId,
  revisionId,
}: {
  workId: Id<"works">;
  revisionId: Id<"revisions"> | null;
}) {
  const data = useQuery(api.revisions.get, revisionId ? { revisionId } : "skip");
  const artifact = useMemo(
    () => (data ? pickReviewArtifact(data.artifacts, data.work.mediaType) : null),
    [data],
  );
  const blob = useArtifactBlob(artifact?.id ?? null, { persist: true });
  if (!revisionId || !data) return <Loading label="プレビューを読み込んでいます" caption />;
  if (artifact?.type !== "pdf" || !blob.download) {
    return <Loading label="PDF を取得しています" caption />;
  }
  return (
    <Suspense fallback={<Loading label="PDF を表示しています" caption />}>
      <PdfViewer
        className="detail-shell__pdf"
        download={blob.download}
        label={`${data.revision.label}の添付`}
      />
    </Suspense>
  );
}
