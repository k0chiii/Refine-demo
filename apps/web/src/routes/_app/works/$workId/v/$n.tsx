import { createFileRoute } from "@tanstack/react-router";
import { Editor, validateEditorSearch } from "@/features/editor/Editor";

/** 版を指定して開く。`n` は 0 がラフ、1 以上が通常版の番号。 */
export const Route = createFileRoute("/_app/works/$workId/v/$n")({
  validateSearch: validateEditorSearch,
  component: () => {
    const { workId, n } = Route.useParams();
    const search = Route.useSearch();
    const version = Number.parseInt(n, 10);
    return (
      <Editor workId={workId} version={Number.isNaN(version) ? null : version} search={search} />
    );
  },
});
