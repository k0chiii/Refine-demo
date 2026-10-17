import { api } from "@mf100/convex/api";
import { createFileRoute, Navigate } from "@tanstack/react-router";
import { useQuery } from "convex/react";
import { Loading } from "@/ui/Loading";

/** 旧 URL（版が主語）と通知からの導線。制作物が主語のエディタ URL へ転送する。 */
export const Route = createFileRoute("/_app/revisions/$revisionId")({
  validateSearch: (s: Record<string, unknown>): { thread?: string } =>
    typeof s.thread === "string" && s.thread ? { thread: s.thread } : {},
  component: () => {
    const { revisionId } = Route.useParams();
    const { thread } = Route.useSearch();
    const data = useQuery(api.revisions.get, { revisionId });
    if (data === undefined) return <Loading label="版を読み込んでいます" />;
    const n = data.revision.kind === "rough" ? 0 : data.revision.sequence;
    return (
      <Navigate
        to="/works/$workId/v/$n"
        params={{ workId: data.work.id, n: String(n) }}
        search={thread ? { thread } : {}}
        replace
      />
    );
  },
});
