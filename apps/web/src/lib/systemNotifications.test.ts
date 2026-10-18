import { describe, expect, it } from "vite-plus/test";
import {
  readNotificationIds,
  shouldCloseSystemNotification,
  systemNotificationIds,
} from "./systemNotifications";

describe("端末の通知を既読にそろえて閉じる", () => {
  it("通知の ID は、まとめた通知なら ids、ふつうの通知なら id から取る", () => {
    expect(systemNotificationIds({ id: "a", ids: ["a", "b"] })).toEqual(["a", "b"]);
    expect(systemNotificationIds({ id: "a" })).toEqual(["a"]);
    expect(systemNotificationIds({ id: null })).toEqual([]);
    expect(systemNotificationIds(undefined)).toEqual([]);
    expect(systemNotificationIds({ ids: ["a", 1, ""] })).toEqual(["a"]);
  });

  it("含まれる通知がすべて既読になったときだけ閉じる", () => {
    const read = readNotificationIds([{ id: "a", readAt: 1 }, { id: "b" }, { id: "c", readAt: 2 }]);
    expect(read).toEqual(new Set(["a", "c"]));
    expect(shouldCloseSystemNotification(["a"], read, 1)).toBe(true);
    expect(shouldCloseSystemNotification(["a", "c"], read, 1)).toBe(true);
    // 1 件でも未読なら残す
    expect(shouldCloseSystemNotification(["a", "b"], read, 1)).toBe(false);
    // 一覧の範囲に無い通知は、既読とは分からないので残す
    expect(shouldCloseSystemNotification(["old"], read, 1)).toBe(false);
  });

  it("未読が 0 件なら閉じる。ID の無い通知は閉じない", () => {
    expect(shouldCloseSystemNotification(["old"], new Set(), 0)).toBe(true);
    expect(shouldCloseSystemNotification([], new Set(), 0)).toBe(false);
  });
});
