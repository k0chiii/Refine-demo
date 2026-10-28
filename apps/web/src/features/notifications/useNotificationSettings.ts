import type { api } from "@mf100/convex/api";
import type { FunctionReturnType } from "convex/server";

export type NotificationSettingsView = FunctionReturnType<typeof api.notificationPrefs.get>;

export function settingsMenuVisible(input: {
  pushUsable: boolean;
  settings: NotificationSettingsView | undefined;
}): boolean {
  void input;
  throw new Error("not implemented");
}
