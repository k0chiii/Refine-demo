import { createFileRoute } from "@tanstack/react-router";
import { Editor } from "@/features/editor/Editor";
import { EditorPending } from "@/features/editor/EditorPending";
import { validateEditorSearch } from "@/features/editor/search";

export const Route = createFileRoute("/_app/works/$workId/")({
  validateSearch: validateEditorSearch,
  // 画面のコードを取りに行くあいだも、すぐ同じ枠と指標を出す（押してから空白にならない。docs/UI_M3E.md §65）
  pendingMs: 0,
  pendingMinMs: 0,
  pendingComponent: () => <EditorPending workId={Route.useParams().workId} />,
  component: () => {
    const { workId } = Route.useParams();
    const search = Route.useSearch();
    return <Editor workId={workId} version={null} search={search} />;
  },
});
