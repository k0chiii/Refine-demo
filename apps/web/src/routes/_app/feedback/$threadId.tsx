import { api } from "@mf100/convex/api";
import { createFileRoute, Navigate } from "@tanstack/react-router";
import { useQuery } from "convex/react";
import { Loading } from "@/ui/Loading";

/**
 * 旧 FB のスレッドのリンク。FB はコメントへ統合した（docs/UI_M3E.md §95）ので、移し先のコメントを開く。
 * 移し先が見つからない（移していない・削除された・見られない）ときは制作物の一覧へ。
 */
export const Route = createFileRoute("/_app/feedback/$threadId")({
  component: FeedbackLink,
});

function FeedbackLink() {
  const { threadId } = Route.useParams();
  const target = useQuery(api.comments.migratedFromFeedback, { feedbackThreadId: threadId });
  if (target === undefined) return <Loading label="読み込んでいます" />;
  if (target === null) return <Navigate to="/works" replace />;
  return (
    <Navigate
      to="/revisions/$revisionId"
      params={{ revisionId: target.revisionId }}
      search={{ thread: target.threadId }}
      replace
    />
  );
}
