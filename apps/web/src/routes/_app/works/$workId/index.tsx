import { createFileRoute } from "@tanstack/react-router";
import { Editor, validateEditorSearch } from "@/features/editor/Editor";

export const Route = createFileRoute("/_app/works/$workId/")({
  validateSearch: validateEditorSearch,
  component: () => {
    const { workId } = Route.useParams();
    const search = Route.useSearch();
    return <Editor workId={workId} version={null} search={search} />;
  },
});
