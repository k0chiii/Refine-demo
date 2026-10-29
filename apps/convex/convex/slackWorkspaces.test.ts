import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { api } from "./_generated/api";
import { createCast, createHarness, type Harness } from "../test/harness";

const code = (c: string) => expect.objectContaining({ data: expect.objectContaining({ code: c }) });

beforeEach(() => {
  // Slack を選ぶと引きに行く予約ができる。裏で走らせない
  vi.useFakeTimers({ toFake: ["setTimeout"] });
});

afterEach(() => {
  vi.useRealTimers();
});

const audits = (t: Harness) =>
  t.run(async (ctx) =>
    (await ctx.db.query("auditEvents").collect()).filter((a) => a.entityType === "slack_workspace"),
  );

describe("Convex 統合: Slack のワークスペース（管理画面「Slack」）", () => {
  it("システム管理者が登録・削除し、監査に残す。誰でも一覧でき、同じ team_id は登録できない", async () => {
    const t = createHarness();
    const cast = await createCast(t);
    const ws = await cast.admin.as.mutation(api.slackWorkspaces.add, {
      name: " 五月祭 ",
      teamId: "t0123abcd",
    });
    expect(ws).toEqual({ id: expect.any(String), name: "五月祭", teamId: "T0123ABCD" });
    expect(await cast.creator.as.query(api.slackWorkspaces.list, {})).toEqual([ws]);
    await expect(
      cast.admin.as.mutation(api.slackWorkspaces.add, { name: "別名", teamId: "T0123ABCD" }),
    ).rejects.toEqual(code("slack_workspace_duplicate"));
    await expect(
      cast.admin.as.mutation(api.slackWorkspaces.add, { name: "駒場祭", teamId: "C0123" }),
    ).rejects.toEqual(code("slack_workspace_invalid"));

    await cast.admin.as.mutation(api.slackWorkspaces.remove, { id: ws.id });
    await cast.admin.as.mutation(api.slackWorkspaces.remove, { id: ws.id });
    expect(await cast.creator.as.query(api.slackWorkspaces.list, {})).toEqual([]);
    expect((await audits(t)).map((a) => [a.entityId, a.operation, a.actorId])).toEqual([
      [ws.id, "add_slack_workspace", cast.admin.id],
      [ws.id, "remove_slack_workspace", cast.admin.id],
    ]);
  });

  it("システム管理者でなければ登録も削除もできない", async () => {
    const t = createHarness();
    const cast = await createCast(t);
    await expect(
      cast.manager.as.mutation(api.slackWorkspaces.add, { name: "五月祭", teamId: "T0MAY" }),
    ).rejects.toEqual(code("forbidden"));
    const ws = await cast.admin.as.mutation(api.slackWorkspaces.add, {
      name: "五月祭",
      teamId: "T0MAY",
    });
    await expect(
      cast.manager.as.mutation(api.slackWorkspaces.remove, { id: ws.id }),
    ).rejects.toEqual(code("forbidden"));
    expect(await cast.manager.as.query(api.slackWorkspaces.list, {})).toEqual([ws]);
  });

  it("ID でないもの・もう無いものを消しても何もしない", async () => {
    const t = createHarness();
    const cast = await createCast(t);
    await cast.admin.as.mutation(api.slackWorkspaces.remove, { id: "not-an-id" });
    expect(await audits(t)).toEqual([]);
  });

  it("通知の設定でワークスペースを選び、1 つだけなら Slack をオンにしたときに選ばれる。登録に無いものは選べない", async () => {
    const t = createHarness();
    const cast = await createCast(t);
    const may = await cast.admin.as.mutation(api.slackWorkspaces.add, {
      name: "五月祭",
      teamId: "T0MAY",
    });
    const slackOf = async () =>
      (await cast.creator.as.query(api.notificationPrefs.get, {})).destinations.slack;
    expect(await slackOf()).toMatchObject({
      workspaceId: null,
      workspaces: [{ id: may.id, name: "五月祭" }],
    });
    await cast.creator.as.mutation(api.notificationPrefs.update, { channels: ["slack"] });
    expect(await slackOf()).toMatchObject({ on: true, workspaceId: may.id });

    const komaba = await cast.admin.as.mutation(api.slackWorkspaces.add, {
      name: "駒場祭",
      teamId: "T0KOMABA",
    });
    await cast.creator.as.mutation(api.notificationPrefs.update, { slackWorkspaceId: komaba.id });
    expect(await slackOf()).toMatchObject({
      workspaceId: komaba.id,
      workspaces: [
        { id: may.id, name: "五月祭" },
        { id: komaba.id, name: "駒場祭" },
      ],
    });
    const gone = await cast.admin.as.mutation(api.slackWorkspaces.add, {
      name: "消えた",
      teamId: "T0GONE",
    });
    await cast.admin.as.mutation(api.slackWorkspaces.remove, { id: gone.id });
    for (const slackWorkspaceId of ["not-an-id", gone.id])
      await expect(
        cast.creator.as.mutation(api.notificationPrefs.update, { slackWorkspaceId }),
      ).rejects.toEqual(code("notification_prefs_invalid"));
    await cast.creator.as.mutation(api.notificationPrefs.update, { slackWorkspaceId: null });
    expect(await slackOf()).toMatchObject({ workspaceId: null });
  });
});
