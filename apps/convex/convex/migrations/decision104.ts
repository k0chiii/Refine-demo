import { internalMutation } from "../_generated/server";

/** 104A: 既存 workPermissions の view を review に昇格（1 回だけ実行） */
export const upgradeViewPermissionGrants = internalMutation({
  args: {},
  handler: async (ctx) => {
    let n = 0;
    for (const g of await ctx.db.query("workPermissions").collect()) {
      if ((g.permission as string) !== "view") continue;
      await ctx.db.patch(g._id, { permission: "review" });
      n++;
    }
    return { upgraded: n };
  },
});
