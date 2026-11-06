import { grantWorkPermission, revokeWorkPermission } from "@mf100/application";
import { z } from "zod";
import { mutation, type FnDef } from "./define.ts";
import { object, vId, vPermissionLevel } from "./validators.ts";

// apps/convex/convex/acl.ts の写し（use case の薄い包みだけ。list / searchUsers などの画面向けの読みは別の単位）

export const acl = {
  /** 作品の閲覧 ACL 付与（U-08 / A-19）。システム管理者のみ */
  "acl:grant": mutation({
    auth: "user",
    args: object({ workId: vId, userIds: z.array(vId), permission: vPermissionLevel }),
    handler: async (ctx, args) => {
      await grantWorkPermission(ctx.db, ctx.principal!, args);
      return null;
    },
  }),

  "acl:revoke": mutation({
    auth: "user",
    args: object({ workId: vId, userId: vId }),
    handler: async (ctx, args) => revokeWorkPermission(ctx.db, ctx.principal!, args),
  }),
} satisfies Record<string, FnDef>;
