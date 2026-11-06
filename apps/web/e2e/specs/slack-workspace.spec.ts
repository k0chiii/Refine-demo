import { expect, test } from "../support/app";

test.describe("Slack のワークスペース", { tag: "@core" }, () => {
  test("管理の Slack タブと通知設定の Slack 行は出ない", async ({ app }) => {
    await app.signInAs("mock-nogiku-admin");
    await app.go("/admin?view=slack");
    await expect(app.page.getByRole("tab", { name: "Slack" })).toHaveCount(0);
    await expect(app.slackWorkspaceRow("T0123ABCD")).toHaveCount(0);

    await app.signInAs("mock-nogiku-creator");
    await app.openNotificationSettings();
    await expect(app.notificationChannel("slack")).toHaveCount(0);
  });
});
