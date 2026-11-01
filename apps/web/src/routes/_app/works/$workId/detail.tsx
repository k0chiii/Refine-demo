import { api } from "@mf100/convex/api";
import { isReviewableArtifact } from "@mf100/domain";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "convex/react";
import { Suspense, useMemo, useState } from "react";
import { PdfViewer } from "@/features/annotation/lazyViewers";
import { useArtifactBlob } from "@/features/annotation/useArtifactBlob";
import { ThreadCard } from "@/features/review/ThreadCard";
import { workHint } from "@/lib/workHint";
import { AppBarSlot } from "@/ui/AppBarSlot";
import { Loading } from "@/ui/Loading";
import { M3eStep, M3eStepper } from "@/ui/m3e";
import { M3eButton } from "@m3e/react/button";

export const Route = createFileRoute("/_app/works/$workId/detail")({
  component: WorkDetailShell,
});

/**
 * 制作物詳細（決定 73A）: 大きなプレビュー + コメント列。データは works.get / revisions.get。
 */
function WorkDetailShell() {
  const { workId } = Route.useParams();
  const hint = workHint(workId);
  const workData = useQuery(api.works.get, { workId });
  const title = workData?.work.title ?? hint?.title ?? "制作物";
  const acceptingRev = workData?.revisions?.find((r) => r.id === workData.acceptingRevisionId);
  const version =
    acceptingRev != null
      ? acceptingRev.kind === "rough"
        ? "ラフ"
        : `版 ${acceptingRev.sequence}`
      : "—";
  const revisionId = workData?.acceptingRevisionId ?? null;

  return (
    <div className="detail-shell">
      <AppBarSlot slot="title">{title}</AppBarSlot>
      <header className="detail-shell__head">
        <div className="detail-shell__row detail-shell__row--title">
          <h1 className="headline-small detail-shell__title">{title}</h1>
          <span className="title-medium detail-shell__version">{version}</span>
        </div>
        <div className="detail-shell__row detail-shell__row--steps">
          {workData === undefined ? (
            <Loading label="制作物を読み込んでいます" />
          ) : (
            <M3eStepper className="detail-shell__stepper" aria-label="進行">
              <M3eStep>未提出</M3eStep>
              <M3eStep>校正中</M3eStep>
              <M3eStep>校了</M3eStep>
            </M3eStepper>
          )}
        </div>
      </header>
      <main className="detail-shell__main">
        <section className="detail-shell__preview" aria-label="プレビュー">
          {workData === undefined || !revisionId ? (
            <Loading label="プレビューを読み込んでいます" />
          ) : (
            <>
              <DetailPreviewFrame revisionId={revisionId} />
              <Link to="/works/$workId" params={{ workId }} className="detail-shell__open-ws">
                <M3eButton variant="tonal">校正画面を開く</M3eButton>
              </Link>
            </>
          )}
        </section>
        <aside className="detail-shell__comments" aria-label="コメント">
          <h2 className="title-small detail-shell__comments-h">コメント</h2>
          {workData === undefined || !revisionId ? (
            <Loading label="コメントを読み込んでいます" />
          ) : (
            <DetailCommentsList revisionId={revisionId} />
          )}
        </aside>
      </main>
    </div>
  );
}

function DetailPreviewFrame({ revisionId }: { revisionId: string }) {
  const data = useQuery(api.revisions.get, { revisionId });
  const artifact = useMemo(() => {
    const list = data?.artifacts ?? [];
    return (
      list.find((a) => a.type === "pdf" && a.role !== "external") ??
      list.find((a) => isReviewableArtifact(a)) ??
      null
    );
  }, [data?.artifacts]);
  const persist = data?.work.confidentiality !== "restricted";
  const blob = useArtifactBlob(artifact && artifact.role !== "external" ? artifact.id : null, {
    persist,
  });
  const [page, setPage] = useState(1);

  if (data === undefined) {
    return <Loading label="プレビューを読み込んでいます" />;
  }

  const pdfReady = artifact?.type === "pdf" ? Boolean(blob.download ?? blob.blob) : Boolean(blob.blob);

  return (
    <div
      className={`detail-shell__preview-frame${artifact?.type === "pdf" && pdfReady ? " detail-shell__preview-frame--pdf" : ""}`}
      data-testid="detail-preview"
    >
      {artifact?.type === "pdf" && pdfReady ? (
        <Suspense fallback={<Loading label="PDF を読み込んでいます" />}>
          <PdfViewer
            download={blob.download}
            blob={blob.blob}
            artifactId={artifact.id}
            threads={[]}
            activeThreadId={null}
            onSelectThread={() => undefined}
            canComment={false}
            draft={null}
            onDraft={() => undefined}
            page={page}
            onPageChange={setPage}
            scale={1}
            rotation={0}
          />
        </Suspense>
      ) : artifact && !pdfReady && !blob.error ? (
        <Loading label="ファイルを取得しています" />
      ) : (
        <p className="body-medium muted" style={{ margin: 0 }}>
          添付がありません
        </p>
      )}
    </div>
  );
}

function DetailCommentsList({ revisionId }: { revisionId: string }) {
  const data = useQuery(api.revisions.get, { revisionId });
  const now = Date.now();

  if (data === undefined) {
    return <Loading label="コメントを読み込んでいます" />;
  }

  if (data.threads.length === 0) {
    return (
      <p className="small muted" style={{ margin: 0 }}>
        コメントはありません
      </p>
    );
  }

  return (
    <div className="comments detail-shell__comments-list">
      {data.threads.map((t, index) => (
        <ThreadCard
          key={t.id}
          thread={t}
          index={index + 1}
          active={false}
          canDecide={false}
          canReply={false}
          confidentiality={data.work.confidentiality}
          now={now}
          className="detail-shell__thread thread"
          onSelect={() => undefined}
          onOpen={() => undefined}
          onResolve={async () => undefined}
          onDecideStart={() => undefined}
        />
      ))}
    </div>
  );
}
