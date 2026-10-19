import { api } from "@mf100/convex/api";
import { landingWorkspace } from "@mf100/domain";
import { createFileRoute, Navigate, redirect } from "@tanstack/react-router";
import { useQuery } from "convex/react";
import { readWorkspace, workspacePath } from "@/lib/workspace";
import { Loading } from "@/ui/Loading";

/**
 * `/` はホームではなく、入口（制作・校正）への振り分け（利用者決定 2026-10-19「ホームいらなくね？制作（ホーム）/校正（ホーム）」）。
 * - この端末で最後に使った入口があれば、読み込みを待たずにそこへ（beforeLoad）
 * - 初めてなら、校正のやり残し（割当の未完了・専門確認・校了待ち）があれば校正、無ければ制作（domain の defaultWorkspace）。
 *   材料はダッシュボードの問い合わせ（入口の画面も同じものを読む）
 */
export const Route = createFileRoute("/_app/")({
  beforeLoad: () => {
    const remembered = readWorkspace();
    if (remembered) throw redirect({ to: workspacePath[remembered], replace: true });
  },
  component: Landing,
});

function Landing() {
  const data = useQuery(api.dashboard.get, {});
  const target = landingWorkspace(
    null,
    data && {
      reviewsUnfinished: data.mine.review.length,
      checksPending: data.mine.checks.length,
      finalizeReady: data.mine.finalize.length,
    },
  );
  if (target) return <Navigate to={workspacePath[target]} replace />;
  return <Loading label="読み込んでいます" />;
}
