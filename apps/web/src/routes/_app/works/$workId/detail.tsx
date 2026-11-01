import { api } from "@mf100/convex/api";
import type { Id } from "@mf100/convex/dataModel";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "convex/react";
import { WorkDetailPreview } from "@/features/work/WorkDetailPreview";
import { workHint } from "@/lib/workHint";
import { AppBarSlot } from "@/ui/AppBarSlot";
import { Loading } from "@/ui/Loading";
import { M3eStep, M3eStepper } from "@/ui/m3e";
import { M3eButton } from "@m3e/react/button";

export const Route = createFileRoute("/_app/works/$workId/detail")({
  component: WorkDetailShell,
});

function DetailCommentList({ revisionId }: { revisionId: Id<"revisions"> | null }) {
  const data = useQuery(api.revisions.get, revisionId ? { revisionId } : "skip");
  if (!revisionId || !data) {
    return <Loading label="コメントを読み込んでいます" caption />;
  }
  if (data.threads.length === 0) {
    return (
      <p className="small muted" style={{ margin: 0 }}>
        コメントはありません
      </p>
    );
  }
  return (
    <ul className="detail-shell__comment-list">
      {data.threads.map((t) => (
        <li key={t.id} className="detail-shell__comment-item body-small">
          {t.body}
        </li>
      ))}
    </ul>
  );
}

function WorkDetailShell() {
  const { workId } = Route.useParams();
  const hint = workHint(workId);
  const workData = useQuery(api.works.get, { workId: workId as Id<"works"> });
  const title = workData?.work.title ?? hint?.title ?? "制作物";
  const acceptingRev = workData?.revisions?.find((r) => r.id === workData.acceptingRevisionId);
  const previewRev =
    acceptingRev ??
    [...(workData?.revisions ?? [])]
      .filter((r) => r.reviewState !== "void")
      .sort((a, b) => b.sequence - a.sequence)[0] ??
    null;
  const version =
    acceptingRev != null
      ? acceptingRev.kind === "rough"
        ? "ラフ"
        : `版 ${acceptingRev.sequence}`
      : "—";

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
          <div className="detail-shell__preview-frame" data-testid="detail-preview">
            {previewRev ? (
              <WorkDetailPreview
                workId={workId as Id<"works">}
                revisionId={previewRev.id as Id<"revisions">}
              />
            ) : (
              <p className="body-medium muted">提出された版がありません</p>
            )}
          </div>
          <Link to="/works/$workId" params={{ workId }} className="detail-shell__open-ws">
            <M3eButton variant="tonal">校正画面を開く</M3eButton>
          </Link>
        </section>
        <aside className="detail-shell__comments" aria-label="コメント">
          <h2 className="title-small detail-shell__comments-h">コメント</h2>
          <DetailCommentList revisionId={(previewRev?.id as Id<"revisions"> | undefined) ?? null} />
        </aside>
      </main>
    </div>
  );
}
