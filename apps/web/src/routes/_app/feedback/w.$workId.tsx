import { createFileRoute } from "@tanstack/react-router";
import { FeedbackSpaceView } from "@/features/feedback/FeedbackSpaceView";

export const Route = createFileRoute("/_app/feedback/w/$workId")({
  validateSearch: (s: Record<string, unknown>): { thread?: string } =>
    typeof s.thread === "string" && s.thread ? { thread: s.thread } : {},
  component: FeedbackSpace,
});

/** 制作物ごとの FB スペース（?thread= で開いているスレッド。広い画面は 紙面 と スレッド を並べる） */
function FeedbackSpace() {
  const { workId } = Route.useParams();
  const { thread } = Route.useSearch();
  return <FeedbackSpaceView workId={workId} {...(thread ? { threadId: thread } : {})} />;
}
