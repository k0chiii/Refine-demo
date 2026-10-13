import { buildDashboard } from "@mf100/application";
import { query } from "./_generated/server";
import { createReadContext } from "./lib/adapters.ts";
import { runUseCase } from "./lib/errors.ts";
import { requireUser } from "./lib/principal.ts";
import { listMyWorks } from "./works.ts";

/** ダッシュボード（U-00）: あなたの担当と、自分が関わる制作物で溜まっているもの。 */
export const get = query({
  args: {},
  handler: async (ctx) => {
    const { principal } = await requireUser(ctx);
    const works = await listMyWorks(ctx.db, principal);
    return runUseCase(() => buildDashboard(createReadContext(ctx.db), principal, works));
  },
});
