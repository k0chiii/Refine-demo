import { api } from "@mf100/convex/api";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "convex/react";
import { workHint } from "@/lib/workHint";
import { AppBarSlot } from "@/ui/AppBarSlot";
import { Loading } from "@/ui/Loading";
import { M3eStep, M3eStepper } from "@/ui/m3e";
import { M3eButton } from "@m3e/react/button";

export const Route = createFileRoute("/_app/works/$workId/detail")({
  component: WorkDetailShell,
});

/**
 * 制作物詳細の骨組み（2 行見出し + ステッパー placeholder）。データは demo / Convex の works.get。
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
          {workData === undefined ? (
            <Loading label="プレビューを読み込んでいます" />
          ) : (
            <>
              <div className="detail-shell__preview-frame" data-testid="detail-preview">
                <p className="body-medium" style={{ margin: 0 }}>
                  {title}
                </p>
                <p className="small muted" style={{ margin: "0.5rem 0 0" }}>
                  版 {version}
                </p>
              </div>
              <M3eButton variant="tonal" component={Link} to="/works/$workId" params={{ workId }}>
                校正画面を開く
              </M3eButton>
            </>
          )}
        </section>
        <aside className="detail-shell__comments" aria-label="コメント">
          <h2 className="title-small detail-shell__comments-h">コメント</h2>
          <p className="small muted" style={{ margin: 0 }}>
            詳細では一覧のみ。返信は校正画面で行います。
          </p>
        </aside>
      </main>
    </div>
  );
}
