import { expect, test } from "../support/app";

// docs/UI_M3E.md §103（通知の設定の届け先）・§110（Slack のメールアドレス）・§112（テスト通知）。デモには env が無いので何も送らず、
// Slack に問い合わせる流れにも頼らない
test.describe("通知の設定", { tag: "@core" }, () => {
  test("アカウントのメニューから開き、メールで受け取る設定が開き直しても保たれる", async ({
    app,
  }) => {
    await app.signInAs("mock-nogiku-creator");
    await expect(await app.openNotificationSettings()).toBeVisible();

    const email = app.notificationChannel("email");
    await expect(email).toHaveCount(1);
    await expect(email.locator(".notif-channel__address")).not.toBeEmpty();
    // Slack 通知 UI は 2026-10-30 判断で非表示（コードは残す）
    await expect(app.notificationChannel("slack")).toHaveCount(0);

    await expect(email.locator("m3e-switch")).toHaveJSProperty("checked", false);
    await email.locator("m3e-switch").click();
    await expect(email.locator("m3e-switch")).toHaveJSProperty("checked", true);
    await app.closeDialog();
    await app.openNotificationSettings();
    await expect(app.notificationChannel("email").locator("m3e-switch")).toHaveJSProperty(
      "checked",
      true,
    );
  });

  test.skip("Slack のメールアドレス（UI 非表示のためスキップ）", async ({ app }) => {
    await app.signInAs("mock-nogiku-admin");
    await app.go("/admin?view=slack");
    await app.addSlackWorkspace("五月祭", "T0123ABCD");
    await expect(app.slackWorkspaceRow("T0123ABCD")).toHaveCount(1);
    const nogiku = "creator@mf100.example-org.jp";
    const custom = "creator@slack-profile.example-org.jp";
    await app.setNogikuEmail("mock-nogiku-creator", nogiku);

    await app.signInAs("mock-nogiku-creator");
    await app.openNotificationSettings();
    const slack = app.notificationChannel("slack");
    const address = slack.locator(".notif-channel__address");
    await slack.locator("m3e-switch").click();
    await expect(slack.locator("m3e-switch")).toHaveJSProperty("checked", true);
    await expect(address).toHaveText(nogiku);

    await app.setSlackEmail(custom);
    await expect(address).toHaveText(custom);
    await app.closeDialog();
    await app.openNotificationSettings();
    await expect(app.slackEmailInput()).toHaveValue(custom);
    await expect(address).toHaveText(custom);

    await app.setSlackEmail("");
    await expect(address).toHaveText(nogiku);
    await app.closeDialog();
    await app.openNotificationSettings();
    await expect(app.slackEmailInput()).toHaveValue("");
    await expect(address).toHaveText(nogiku);
  });

  test("テスト通知を送るとボタンが押せなくなり、ベルにテスト通知が届く", async ({ app }) => {
    await app.signInAs("mock-nogiku-creator");
    await app.openNotificationSettings();
    const send = app.sendTestNotificationButton();
    await expect(send).toHaveJSProperty("disabled", false);
    await send.click();
    // 1 分は押せない（2 回目は送らない）
    await expect(send).toHaveJSProperty("disabled", true);
    await app.closeDialog();

    const rows = await app.notifications();
    await expect(rows.and(app.page.locator('[data-kind="test"]'))).toHaveCount(1);
  });
});
