import type { api } from "@mf100/convex/api";
import type { FunctionReturnType } from "convex/server";

/** 版の画面のスレッド 1 件（revisions.get の threads の要素） */
export type Thread = FunctionReturnType<typeof api.revisions.get>["threads"][number];

export const closedResolutions = ["rejected", "resolved", "deferred"];
export const isClosed = (t: { resolution: string }) => closedResolutions.includes(t.resolution);
