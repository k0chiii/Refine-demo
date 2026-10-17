import { createFileRoute } from "@tanstack/react-router";
import { FeedbackSpaceView } from "@/features/feedback/FeedbackSpaceView";

export const Route = createFileRoute("/_app/feedback/")({
  component: FeedbackSpaces,
});

/**
 * フィードバック（FB。制作の相談・話し合い。解決はしない）の入口: 制作物ごとの FB スペースの一覧。
 * 広い画面は縦に 3 列（スペース・紙面・スレッド）の左だけが埋まり、制作物を選ぶと中央と右が開く。
 */
function FeedbackSpaces() {
  return <FeedbackSpaceView />;
}
