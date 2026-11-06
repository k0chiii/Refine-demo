import { beginItemUpload } from "@mf100/application";
import { z } from "zod";
import { mutation, type FnDef } from "./define.ts";
import { object } from "./validators.ts";

export const submissions = {
  /**
   * 転送の開始: この試行だけが書き込む R2 キーを払い出す（PUT の前）。
   * Convex では internalMutation を http.ts が引く（X-MF100-Service-Key + 利用者の JWT）。項目の持ち主かは use case が確かめる
   */
  "submissions:beginUpload": mutation({
    auth: { service: "MF100_UPLOAD_SECRET", withUser: true },
    args: object({ itemId: z.string() }),
    handler: async (ctx, args) => beginItemUpload(ctx.db, ctx.principal!, args),
  }),
} satisfies Record<string, FnDef>;
