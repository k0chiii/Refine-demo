import { expect, test } from "../support/app";

// docs/UI_M3E.md §105。デモには SLACK_BASE_URL が無いので何も送らない。選んだワークスペースは行の data-workspace-id で見る
test.describe("Slack のワークスペース", { tag: "@core" }, () => {
  test("管理者が登録し、削除して登録し直したものを、制作者が通知の設定で選ぶと開き直しても保たれる", async ({
    app,
  }) => {
    const teamId = "T0123ABCD";
    await app.signInAs("mock-nogiku-admin");
    await app.go("/admin?view=slack");
    const row = app.slackWorkspaceRow(teamId);
    await app.addSlackWorkspace("五月祭", teamId);
    await expect(row).toHaveCount(1);
    await app.removeSlackWorkspace(teamId);
    await expect(row).toHaveCount(0);
    await app.addSlackWorkspace("五月祭", teamId);
    await expect(row).toHaveCount(1);

    await app.signInAs("mock-nogiku-creator");
    await app.openNotificationSettings();
    const slack = app.notificationChannel("slack");
    await expect(slack).toHaveCount(1);
    await expect(slack).not.toHaveAttribute("data-workspace-id");
    const id = await app.pickSlackWorkspace();
    expect(id).toBeTruthy();
    await expect(slack).toHaveAttribute("data-workspace-id", id);
    await app.closeDialog();
    await app.openNotificationSettings();
    await expect(app.notificationChannel("slack")).toHaveAttribute("data-workspace-id", id);
  });
});
