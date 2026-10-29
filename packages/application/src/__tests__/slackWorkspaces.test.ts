import { describe, expect, it } from "vite-plus/test";
import {
  addSlackWorkspace,
  listSlackWorkspaces,
  removeSlackWorkspace,
} from "../usecases/slackWorkspaces.ts";
import { createInMemoryContext } from "../testing/inMemory.ts";
import { principals } from "../testing/scenario.ts";

const code = (c: string) => expect.objectContaining({ code: c });
const admin = principals.sysadmin;

describe("Slack のワークスペースの登録（管理画面「Slack」）", () => {
  it("システム管理者が登録し、誰でも名前の順に一覧できる。登録は監査に残す", async () => {
    const ctx = createInMemoryContext();
    const komaba = await addSlackWorkspace(ctx, admin, { name: "駒場祭", teamId: "t0komaba" });
    await addSlackWorkspace(ctx, admin, { name: "MF", teamId: "T0MF" });
    await addSlackWorkspace(ctx, admin, { name: " 五月祭 ", teamId: "T0MAY" });
    expect(komaba).toEqual({ id: expect.any(String), name: "駒場祭", teamId: "T0KOMABA" });
    const list = await listSlackWorkspaces(ctx, principals.stranger);
    expect(list.map((w) => [w.name, w.teamId])).toEqual([
      ["MF", "T0MF"],
      ["五月祭", "T0MAY"],
      ["駒場祭", "T0KOMABA"],
    ]);
    expect(ctx.state.audit.find((a) => a.entityId === komaba.id)).toMatchObject({
      entityType: "slack_workspace",
      operation: "add_slack_workspace",
      actorId: admin.userId,
      after: komaba,
    });
  });

  it("システム管理者でなければ登録も削除もできない", async () => {
    const ctx = createInMemoryContext();
    await expect(
      addSlackWorkspace(ctx, principals.manager, { name: "五月祭", teamId: "T0MAY" }),
    ).rejects.toEqual(code("forbidden"));
    const ws = await addSlackWorkspace(ctx, admin, { name: "五月祭", teamId: "T0MAY" });
    await expect(removeSlackWorkspace(ctx, principals.manager, ws.id)).rejects.toEqual(
      code("forbidden"),
    );
    expect(await listSlackWorkspaces(ctx, principals.manager)).toEqual([ws]);
  });

  it("同じ team_id は大文字小文字によらず二度登録できず、形の正しくない入力も登録しない", async () => {
    const ctx = createInMemoryContext();
    await addSlackWorkspace(ctx, admin, { name: "五月祭", teamId: "T0MAY" });
    await expect(addSlackWorkspace(ctx, admin, { name: "別名", teamId: " t0may" })).rejects.toEqual(
      code("slack_workspace_duplicate"),
    );
    await expect(
      addSlackWorkspace(ctx, admin, { name: "駒場祭", teamId: "U0123" }),
    ).rejects.toEqual(code("slack_workspace_invalid"));
    expect(await listSlackWorkspaces(ctx, admin)).toHaveLength(1);
  });

  it("削除は監査に残し、もう無いものを消しても何もしない", async () => {
    const ctx = createInMemoryContext();
    const ws = await addSlackWorkspace(ctx, admin, { name: "五月祭", teamId: "T0MAY" });
    await removeSlackWorkspace(ctx, admin, ws.id);
    await removeSlackWorkspace(ctx, admin, ws.id);
    expect(await listSlackWorkspaces(ctx, admin)).toEqual([]);
    expect(ctx.state.audit.filter((a) => a.entityId === ws.id).map((a) => a.operation)).toEqual([
      "add_slack_workspace",
      "remove_slack_workspace",
    ]);
    expect(ctx.state.audit.at(-1)).toMatchObject({ before: ws, actorId: admin.userId });
    // 消した後は同じ team_id をまた登録できる
    await addSlackWorkspace(ctx, admin, { name: "五月祭", teamId: "T0MAY" });
  });
});
