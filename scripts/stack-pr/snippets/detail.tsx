import { api } from "@mf100/convex/api";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "convex/react";
import { workHint } from "@/lib/workHint";
import { AppBarSlot } from "@/ui/AppBarSlot";
import { Loading } from "@/ui/Loading";
import { M3eStep, M3eStepper } from "@/ui/m3e";

export const Route = createFileRoute("/_app/works/$workId/detail")({
  component: WorkDetailShell,
});

/**
 * 制作物詳細の骨組み（2 行見出し + ステッパー placeholder）。データは demo / Convex の works.get。
 */
function WorkDetailShell() {
  const { workId } = Route.useParams();
  const hint = workHint(workId);
  const data = useQuery(api.works.get, { workId });
  const title = data?.work.title ?? hint?.title ?? "制作物";
  const latest = data?.revisions
    ?.filter((r) => r.reviewState !== "void")
    .sort((a, b) => b.submittedAt - a.submittedAt)[0];
  const version = latest?.label ?? "—";

  return (
    <div className="detail-shell">
      <AppBarSlot slot="title">{title}</AppBarSlot>
      <header className="detail-shell__head">
        <div className="detail-shell__row detail-shell__row--title">
          <h1 className="headline-small detail-shell__title">{title}</h1>
          <span className="title-medium detail-shell__version">{version}</span>
        </div>
        <div className="detail-shell__row detail-shell__row--steps">
          {data === undefined ? (
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
    </div>
  );
}
