import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vite-plus/test";

describe("Web Push redelivery", () => {
  it("keeps the notification count and suppresses a second alert for the same delivery", async () => {
    const show = vi.fn();
    let previous: Record<string, unknown> | null = null;
    const listeners = new Map<string, (event: unknown) => void>();
    const source = readFileSync(new URL("../../pwa/sw.template.js", import.meta.url), "utf8")
      .replace("__VERSION__", '"test"')
      .replace("__PRECACHE__", "[]")
      .replace("__PRELOAD__", "[]")
      .replace("__CARRY__", "[]");
    runInNewContext(source, {
      URL,
      console,
      self: {
        location: new URL("https://app.invalid"),
        clients: { matchAll: async () => [] },
        navigator: {},
        addEventListener: (name: string, handler: (event: unknown) => void) =>
          listeners.set(name, handler),
        registration: {
          getNotifications: async () => (previous ? [previous] : []),
          showNotification: async (title: string, options: Record<string, unknown>) => {
            show(title, options);
            previous = { title, ...options };
          },
        },
      },
    });
    const deliver = async (id: string) => {
      let completion: Promise<unknown> | undefined;
      listeners.get("push")!({
        data: { json: () => ({ id, tag: "thread", title: "title", body: "body" }) },
        waitUntil: (task: Promise<unknown>) => {
          completion = task;
        },
      });
      await completion;
    };
    await deliver("notification-1");
    await deliver("notification-1");
    expect(show.mock.calls[1]![1]).toMatchObject({
      silent: true,
      renotify: false,
      data: { count: 1, ids: ["notification-1"] },
    });
    await deliver("notification-2");
    expect(show.mock.calls[2]![1]).toMatchObject({ data: { count: 2 } });
  });
});
