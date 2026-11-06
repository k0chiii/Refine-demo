import { describe, expect, it } from "vite-plus/test";
import { createCast, createHarness } from "../test/harness";
import { setupWork } from "../test/flows";
import { listMyWorks } from "./works.ts";

/** 105A: サインインした委員はすべての制作物を listMyWorks で返す */
describe("Convex: works.listMyWorks", () => {
  it("関係のない委員にも、登録された制作物がすべて見える", async () => {
    const t = createHarness();
    const cast = await createCast(t);
    await setupWork(t, cast, { title: "制作物 A" });
    await setupWork(t, cast, { title: "制作物 B" });
    const titles = await t.run(async (ctx) => {
      const works = await listMyWorks(ctx.db, {
        userId: cast.stranger.id,
        isSystemAdmin: false,
        groupIds: [],
        orgPermissions: ["*"],
      });
      return works.map((w) => w.title);
    });
    expect(titles).toContain("制作物 A");
    expect(titles).toContain("制作物 B");
  });
});
