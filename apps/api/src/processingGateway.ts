import type { FunctionArgs, FunctionReturnType } from "convex/server";
import type { internal } from "@mf100/convex/api";
export type ProcessingJob = FunctionReturnType<typeof internal.processing.inspect>;
type Operations = {
  cleanupCandidates: typeof internal.processing.cleanupCandidates;
  markCleaned: typeof internal.processing.markCleaned;
  inspect: typeof internal.processing.inspect;
  complete: typeof internal.processing.complete;
  fail: typeof internal.processing.fail;
  figmaComplete: typeof internal.processing.figmaComplete;
  streamSession: typeof internal.processing.streamSession;
};
export function processingGateway(siteUrl: string, secret: string) {
  if (secret.length < 32) throw new Error("processing_not_configured");
  return async <K extends keyof Operations>(
    operation: K,
    args: FunctionArgs<Operations[K]>,
  ): Promise<FunctionReturnType<Operations[K]>> => {
    const response = await fetch(`${siteUrl.replace(/\/$/, "")}/internal/processing`, {
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(30_000),
      headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" },
      body: JSON.stringify({ operation, args }),
    });
    if (!response.ok)
      throw new Error(
        response.status === 409 ? "processing_rejected" : "processing_service_unavailable",
      );
    return response.json();
  };
}
