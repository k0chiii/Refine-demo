import { loadAuthorizedWork, markRevisionViewed } from "@mf100/application";
import { DomainError } from "@mf100/domain";
import { mutation, type FnDef } from "./define.ts";
import { object, vId } from "./validators.ts";

// apps/convex/convex/revisions.ts の写し（get は画面向けの読みで別の単位。closeExpired / remindDeadlines は cron で db.ts の runJobs が持つ）

export const revisions = {
  /** 校正者が版を開いた（pending → viewed） */
  "revisions:markViewed": mutation({
    auth: "user",
    args: object({ revisionId: vId }),
    handler: async (ctx, { revisionId }) => {
      const revision = await ctx.db.revisions.findById(revisionId);
      if (!revision) throw new DomainError("forbidden", { revisionId });
      await loadAuthorizedWork(ctx.db, ctx.principal!, revision.workId, "work.view");
      await markRevisionViewed(ctx.db, ctx.principal!, revisionId);
      return null;
    },
  }),
} satisfies Record<string, FnDef>;
