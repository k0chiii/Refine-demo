import { loadAuthorizedWork } from "@mf100/application";
import { DomainError } from "@mf100/domain";
import { z } from "zod";
import { query, type FnDef } from "./define.ts";
import { object } from "./validators.ts";

// apps/convex/convex/artifacts.ts の写し

export const artifacts = {
  /**
   * 添付への読み取り認可（§9.1 / A-11）。Worker が利用者の主体でこれを呼び、許可された場合だけ R2 から配信する。
   * 署名付き URL は発行しない（権限剥奪後に残らない）。外部リンク・実体の無い添付は配信するものが無いので forbidden
   */
  "artifacts:authorizeAccess": query({
    auth: "user",
    args: object({ artifactId: z.string() }),
    handler: async (ctx, { artifactId }) => {
      const artifact = await ctx.db.artifacts.findById(artifactId);
      if (!artifact) throw new DomainError("forbidden", { artifactId });
      const revision = await ctx.db.revisions.findById(artifact.revisionId);
      if (!revision) throw new DomainError("forbidden", { artifactId });
      await loadAuthorizedWork(ctx.db, ctx.principal!, revision.workId, "work.view");
      if (artifact.role === "external" || !artifact.objectKey)
        throw new DomainError("forbidden", { artifactId, reason: "not_a_stored_object" });
      return {
        objectKey: artifact.objectKey,
        mimeType: artifact.mimeType,
        fileName: artifact.fileName,
        size: artifact.size ?? null,
      };
    },
  }),
} satisfies Record<string, FnDef>;
