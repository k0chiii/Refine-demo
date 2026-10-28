import { expect, test } from "../support/app";

// docs/UI_M3E.md §103（通知の設定の届け先）。デモには env が無いので何も送らず、Slack に問い合わせる流れにも頼らない
test.describe("通知の設定", { tag: "@core" }, () => {
  test("アカウントのメニューから開き、メールで受け取る設定が開き直しても保たれる", async ({
    app,
  }) => {
    await app.signInAs("mock-nogiku-creator");
    await expect(await app.openNotificationSettings()).toBeVisible();

    const email = app.notificationChannel("email");
    const slack = app.notificationChannel("slack");
    await expect(email).toHaveCount(1);
    await expect(slack).toHaveCount(1);
    await expect(email.locator(".notif-channel__address")).not.toBeEmpty();
    // 送れるメールアドレスが無い（no_address）ときだけ、Slack のスイッチは入れられない
    const slackStatus = await slack.getAttribute("data-status");
    expect(slackStatus).toBeTruthy();
    await expect(slack.locator("m3e-switch")).toHaveJSProperty(
      "disabled",
      slackStatus === "no_address",
    );

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
});
