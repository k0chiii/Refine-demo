import { createFileRoute } from "@tanstack/react-router";
import { useRecordOpened } from "@/features/home/PinButton";
import { WriteEditor } from "@/features/writing/WriteEditor";

/** 文章エディタ。下書きを書き、版として提出する（Google ドキュメント相当。docs/EDITOR_RESEARCH.md） */
export const Route = createFileRoute("/_app/works/$workId/write")({
  component: () => {
    const { workId } = Route.useParams();
    useRecordOpened(workId);
    return <WriteEditor workId={workId} />;
  },
});
