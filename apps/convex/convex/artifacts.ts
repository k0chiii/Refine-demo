import { loadAuthorizedWork } from "@mf100/application";
import { DomainError } from "@mf100/domain";
import { v } from "convex/values";
import { query } from "./_generated/server";
import { createReadContext } from "./lib/adapters.ts";
import { runUseCase } from "./lib/errors.ts";
import { requireUser } from "./lib/principal.ts";

/**
 * 添付への読み取り認可（§9.1 / A-11）。Hono が利用者のトークンでこのクエリを呼び、許可された場合だけ R2 から配信する。
 * 署名付き URL は発行しない（権限剥奪後に残らない）。
 */
export const authorizeAccess = query({
  args: { artifactId: v.id("artifacts") },
  handler: async (ctx, { artifactId }) => {
    const { principal } = await requireUser(ctx);
    const app = createReadContext(ctx.db);
    return runUseCase(async () => {
      const artifact = await app.artifacts.findById(artifactId);
      if (!artifact) throw new DomainError("forbidden", { artifactId });
      const revision = await app.revisions.findById(artifact.revisionId);
      if (!revision) throw new DomainError("forbidden", { artifactId });
      await loadAuthorizedWork(app, principal, revision.workId, "work.view");
      if (artifact.role === "external" || !artifact.objectKey) throw new DomainError("forbidden", { artifactId, reason: "not_a_stored_object" });
      return { objectKey: artifact.objectKey, mimeType: artifact.mimeType, fileName: artifact.fileName, size: artifact.size ?? null };
    });
  },
});
