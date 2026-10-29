import { describe, expect, it } from "vite-plus/test";
import { settingsMenuVisible, type NotificationSettingsView } from "./useNotificationSettings";

const settings = (email: boolean, slack: boolean): NotificationSettingsView => ({
  showPreview: true,
  mutedCategories: [],
  channels: [],
  destinations: {
    email: { available: email, on: false, address: "a@mf100.jp", status: "ready" },
    slack: {
      available: slack,
      on: false,
      address: "a@mf100.jp",
      status: "unresolved",
      workspaceId: null,
      workspaces: [],
    },
  },
});

describe("settingsMenuVisible", () => {
  it("この端末への通知が使えれば、設定を読む前でも出す", () => {
    expect(settingsMenuVisible({ pushUsable: true, settings: undefined })).toBe(true);
    expect(settingsMenuVisible({ pushUsable: true, settings: settings(false, false) })).toBe(true);
  });

  it("端末への通知が使えなければ、メールか Slack のどちらかが使えるときだけ出す", () => {
    expect(settingsMenuVisible({ pushUsable: false, settings: settings(true, false) })).toBe(true);
    expect(settingsMenuVisible({ pushUsable: false, settings: settings(false, true) })).toBe(true);
    expect(settingsMenuVisible({ pushUsable: false, settings: settings(true, true) })).toBe(true);
    expect(settingsMenuVisible({ pushUsable: false, settings: settings(false, false) })).toBe(
      false,
    );
  });

  it("端末への通知が使えず設定もまだ読めていなければ出さない", () => {
    expect(settingsMenuVisible({ pushUsable: false, settings: undefined })).toBe(false);
  });
});
