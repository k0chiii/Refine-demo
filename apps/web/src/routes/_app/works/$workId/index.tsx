import { createFileRoute } from "@tanstack/react-router";
import { Editor } from "@/features/editor/Editor";
import { validateEditorSearch } from "@/features/editor/search";

export const Route = createFileRoute("/_app/works/$workId/")({
  validateSearch: validateEditorSearch,
  component: () => {
    const { workId } = Route.useParams();
    const search = Route.useSearch();
    return <Editor workId={workId} version={null} search={search} />;
  },
});
