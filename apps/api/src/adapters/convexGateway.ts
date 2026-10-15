import { api } from "@mf100/convex/api";
import type { Id } from "@mf100/convex/dataModel";
import { ConvexHttpClient } from "convex/browser";
import { ConvexError } from "convex/values";
import type { BackendGateway } from "../ports.ts";
import { GatewayError } from "../ports.ts";

/** Convex を利用者本人のトークンで呼ぶ。Hono は特権を持たず、常に利用者として振る舞う。 */
export function createConvexGateway(convexUrl: string): BackendGateway {
  const withAuth = (token: string) => {
    const client = new ConvexHttpClient(convexUrl);
    client.setAuth(token);
    return client;
  };
  const translate = (error: unknown): never => {
    if (error instanceof ConvexError) {
      const data = error.data as { code?: string; details?: unknown };
      throw new GatewayError(data.code ?? "convex_error", data.details ?? {});
    }
    throw error;
  };
  return {
    async itemForUpload(token, itemId) {
      return withAuth(token)
        .query(api.submissions.itemForUpload, { itemId: itemId as Id<"uploadItems"> })
        .catch(translate);
    },
    async markVerified(token, itemId, meta) {
      return withAuth(token)
        .mutation(api.submissions.markVerified, { itemId: itemId as Id<"uploadItems">, ...meta })
        .catch(translate);
    },
    async markFailed(token, itemId, message) {
      await withAuth(token)
        .mutation(api.submissions.markFailed, { itemId: itemId as Id<"uploadItems">, message })
        .catch(translate);
    },
    async authorizeArtifact(token, artifactId) {
      return withAuth(token)
        .query(api.artifacts.authorizeAccess, { artifactId: artifactId as Id<"artifacts"> })
        .catch(translate);
    },
    async feedbackFileForUpload(token, fileId) {
      return withAuth(token).query(api.feedback.fileForUpload, { fileId }).catch(translate);
    },
    async markFeedbackFileVerified(token, fileId, meta) {
      return withAuth(token)
        .mutation(api.feedback.markFileVerified, { fileId, ...meta })
        .catch(translate);
    },
    async markFeedbackFileFailed(token, fileId, message) {
      await withAuth(token)
        .mutation(api.feedback.markFileFailed, { fileId, message })
        .catch(translate);
    },
    async authorizeFeedbackFile(token, fileId) {
      return withAuth(token).query(api.feedback.authorizeFile, { fileId }).catch(translate);
    },
  };
}
