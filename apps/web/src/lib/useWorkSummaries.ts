import { api } from "@mf100/convex/api";
import { usePaginatedQuery } from "convex/react";
import type { FunctionArgs, FunctionReturnType } from "convex/server";
import { useEffect, useRef } from "react";

type Filters = Omit<FunctionArgs<typeof api.works.listMinePage>, "paginationOpts">;
type Row = FunctionReturnType<typeof api.works.listMinePage>["page"][number];

/** Complete all cursor pages before reporting global counts or sorting. Keep the prior filter result while loading. */
export function useWorkSummaries(args: Filters | "skip") {
  const { results, status, loadMore } = usePaginatedQuery(api.works.listMinePage, args, {
    initialNumItems: 50,
  });
  const previous = useRef<Row[] | undefined>(undefined);
  useEffect(() => {
    if (args !== "skip" && status === "CanLoadMore") loadMore(50);
  }, [args, status, loadMore]);
  if (args === "skip") {
    previous.current = undefined;
    return undefined;
  }
  if (status === "Exhausted") previous.current = results;
  return previous.current;
}
