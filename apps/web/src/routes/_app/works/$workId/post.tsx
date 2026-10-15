import { createFileRoute } from "@tanstack/react-router";
import { useRecordOpened } from "@/features/home/PinButton";
import { PostEditor } from "@/features/social/PostEditor";

/** SNS 投稿の編集（Instagram / X のプレビュー付き）。下書きを作り、版として提出する */
export const Route = createFileRoute("/_app/works/$workId/post")({
  component: () => {
    const { workId } = Route.useParams();
    useRecordOpened(workId);
    return <PostEditor workId={workId} />;
  },
});
