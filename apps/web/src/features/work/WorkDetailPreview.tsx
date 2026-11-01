import { api } from "@mf100/convex/api";
import type { Id } from "@mf100/convex/dataModel";
import { pickReviewArtifact, type ArtifactType } from "@mf100/domain";
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
  const artifact = useMemo(() => {
    if (!data) return null;
    // 媒体に合う添付を優先する（紙面で校正できる種類だけ。Web はファイルを出さないので document 扱い）
    const m = data.work.mediaType;
    const prefer: ArtifactType | undefined =
      m === "pdf" || m === "image" || m === "video" ? m : m === "web" ? "document" : undefined;
    return pickReviewArtifact(data.artifacts, prefer);
  }, [data]);
  const blob = useArtifactBlob(artifact?.id ?? null, { persist: true });
  if (!revisionId || !data) return <Loading label="プレビューを読み込んでいます" caption />;
  if (artifact?.type !== "pdf" || !blob.download) {
    return <Loading label="PDF を取得しています" caption />;
  }
  return (
    <Suspense fallback={<Loading label="PDF を表示しています" caption />}>
      <PdfViewer
        download={blob.download}
        artifactId={artifact.id}
        threads={[]}
        activeThreadId={null}
        onSelectThread={() => {}}
        canComment={false}
        draft={null}
        onDraft={() => {}}
        page={1}
        scale={1}
        rotation={0}
      />
    </Suspense>
  );
}
