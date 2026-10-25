import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { createCast, createHarness } from "../test/harness";
import { setupWork, submitFiles } from "../test/flows";
import { base64urlEncode } from "./lib/webpush.ts";

const pdf = [{ fileName: "a.pdf", mimeType: "application/pdf", type: "pdf" as const }];

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

async function vapidEnv() {
  const pair = (await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, [
    "sign",
  ])) as CryptoKeyPair;
  vi.stubEnv(
    "VAPID_PUBLIC_KEY",
    base64urlEncode(new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey))),
  );
  vi.stubEnv("VAPID_PRIVATE_KEY", (await crypto.subtle.exportKey("jwk", pair.privateKey)).d!);
  vi.stubEnv("VAPID_SUBJECT", "mailto:ops@example.invalid");
}

/** ブラウザの購読と同じ形（本物の鍵） */
async function device(n: number) {
  const pair = (await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, [
    "deriveBits",
  ])) as CryptoKeyPair;
  return {
    endpoint: `https://fcm.googleapis.com/fcm/send/device-${n}`,
    p256dh: base64urlEncode(new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey))),
    auth: base64urlEncode(crypto.getRandomValues(new Uint8Array(16))),
  };
}

/** 端末への送信の予約（push:enqueue。取り消して置き換えた分は数えない）。args は { notificationIds } */
async function scheduledDeliveries(t: ReturnType<typeof createHarness>) {
  return t.run(async (ctx) =>
    (await ctx.db.system.query("_scheduled_functions").collect()).filter(
      (f) => f.name.startsWith("push:enqueue") && f.state.kind !== "canceled",
    ),
  );
}
const firstNotificationId = (f: { args: unknown[] }) =>
  (f.args[0] as { notificationIds: string[] }).notificationIds[0]!;

describe("Convex 統合: 端末への通知（Web Push）", () => {
  it("鍵が無い環境では使えない（config が null・送信を予約しない）", async () => {
    const t = createHarness();
    const cast = await createCast(t);
    expect(await cast.reviewer.as.query(api.push.config, {})).toBeNull();
    await cast.reviewer.as.mutation(api.push.subscribe, await device(1));
    const workId = await setupWork(t, cast);
    await submitFiles(cast, workId, pdf);
    await cast.manager.as.mutation(api.reviews.setReviewers, {
      workId,
      reviewerIds: [cast.reviewer.id],
    });
    expect(await scheduledDeliveries(t)).toHaveLength(0);
  });

  it("通知ができると端末を登録した人にだけ送信を予約し、送った結果で購読を整理する", async () => {
    // 予約した送信が裏で走らないよう時計を止め、ここで 1 回ずつ呼ぶ
    vi.useFakeTimers({ toFake: ["setTimeout"] });
    await vapidEnv();
    const t = createHarness();
    const cast = await createCast(t);
    expect(await cast.reviewer.as.query(api.push.config, {})).toEqual({
      publicKey: process.env.VAPID_PUBLIC_KEY,
    });
    const d1 = await device(1);
    const d2 = await device(2);
    await cast.reviewer.as.mutation(api.push.subscribe, { ...d1, device: "iPhone" });
    await cast.reviewer.as.mutation(api.push.subscribe, d2);
    expect(await cast.reviewer.as.query(api.push.status, { endpoint: d1.endpoint })).toBe(true);
    expect(await cast.stranger.as.query(api.push.status, { endpoint: d1.endpoint })).toBe(false);

    const workId = await setupWork(t, cast, { title: "夏のポスター" });
    await submitFiles(cast, workId, pdf);
    await cast.manager.as.mutation(api.reviews.setReviewers, {
      workId,
      reviewerIds: [cast.reviewer.id],
    });
    const scheduled = await scheduledDeliveries(t);
    expect(scheduled).toHaveLength(1); // 端末を登録したのは reviewer だけ
    const notificationId = firstNotificationId(scheduled[0]!);

    // 1 台目は届き、2 台目は宛先が無くなっている（410）
    const fetch = vi.fn(
      async (url: string) => new Response(null, { status: url === d1.endpoint ? 201 : 410 }),
    );
    vi.stubGlobal("fetch", fetch);
    expect(await t.action(internal.pushNode.deliver, { notificationId })).toBe(1);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(await cast.reviewer.as.query(api.push.status, { endpoint: d2.endpoint })).toBe(false);
    expect(await cast.reviewer.as.query(api.push.status, { endpoint: d1.endpoint })).toBe(true);

    // 既読にした後は送らない
    await cast.reviewer.as.mutation(api.notifications.markRead, {
      notificationId: notificationId as never,
    });
    expect(await t.action(internal.pushNode.deliver, { notificationId })).toBe(0);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("止めた分類の通知は端末に送らない（アプリ内の通知は残る）", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout"] });
    await vapidEnv();
    const t = createHarness();
    const cast = await createCast(t);
    await cast.reviewer.as.mutation(api.push.subscribe, await device(1));
    await cast.reviewer.as.mutation(api.notificationPrefs.update, {
      mutedCategories: ["assignment"],
    });
    const workId = await setupWork(t, cast);
    await submitFiles(cast, workId, pdf);
    await cast.manager.as.mutation(api.reviews.setReviewers, {
      workId,
      reviewerIds: [cast.reviewer.id],
    });
    const [scheduled] = await scheduledDeliveries(t);
    const notificationId = firstNotificationId(scheduled!);
    const fetch = vi.fn(async () => new Response(null, { status: 201 }));
    vi.stubGlobal("fetch", fetch);
    expect(await t.action(internal.pushNode.deliver, { notificationId })).toBe(0);
    expect(fetch).not.toHaveBeenCalled();
    const list = await cast.reviewer.as.query(api.notifications.list, {});
    expect(list.some((n) => n.id === notificationId)).toBe(true);
    // 誰が（actorId）は保存される
    expect(list.find((n) => n.id === notificationId)?.actorId).toBe(cast.manager.id);
    // 止めるのをやめれば送る
    await cast.reviewer.as.mutation(api.notificationPrefs.update, { mutedCategories: [] });
    expect(await t.action(internal.pushNode.deliver, { notificationId })).toBe(1);
  });

  it("1 回の操作で複数の人に通知ができても、送信の予約は 1 本にまとめる", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout"] });
    await vapidEnv();
    const t = createHarness();
    const cast = await createCast(t);
    await cast.reviewer.as.mutation(api.push.subscribe, await device(1));
    await cast.approver.as.mutation(api.push.subscribe, await device(2));
    const workId = await setupWork(t, cast);
    await cast.admin.as.mutation(api.acl.grant, {
      workId,
      userIds: [cast.approver.id],
      permission: "review",
    });
    await submitFiles(cast, workId, pdf);
    const before = new Set((await scheduledDeliveries(t)).map((f) => f._id));
    // 2 人への割り当て通知が 1 つのトランザクションでできる
    await cast.manager.as.mutation(api.reviews.setReviewers, {
      workId,
      reviewerIds: [cast.reviewer.id, cast.approver.id],
    });
    const scheduled = (await scheduledDeliveries(t)).filter((f) => !before.has(f._id));
    expect(scheduled).toHaveLength(1);
    const ids = (scheduled[0]!.args[0] as { notificationIds: string[] }).notificationIds;
    expect(ids).toHaveLength(2);
    const notifications = await t.run((ctx) =>
      Promise.all(ids.map((id) => ctx.db.get(id as Id<"notifications">))),
    );
    expect(new Set(notifications.map((n) => n?.recipientId))).toEqual(
      new Set([cast.reviewer.id, cast.approver.id]),
    );
    // 予約を 1 回走らせると、2 件とも workpool に積まれる
    await t.mutation(internal.push.enqueue, { notificationIds: ids });
    const pending = await t.run(async (ctx) =>
      (await ctx.db.system.query("_scheduled_functions").collect()).filter(
        (f) => f.state.kind !== "canceled",
      ),
    );
    expect(pending.length).toBeGreaterThan(0);
  });

  it("解除は自分の端末だけ", async () => {
    await vapidEnv();
    const t = createHarness();
    const cast = await createCast(t);
    const d = await device(1);
    await cast.reviewer.as.mutation(api.push.subscribe, d);
    expect(await cast.stranger.as.mutation(api.push.unsubscribe, { endpoint: d.endpoint })).toBe(
      false,
    );
    expect(await cast.reviewer.as.mutation(api.push.unsubscribe, { endpoint: d.endpoint })).toBe(
      true,
    );
  });
});

it("transient push failure retries only undelivered devices", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout"] });
  await vapidEnv();
  const t = createHarness();
  const cast = await createCast(t);
  const d1 = await device(11);
  const d2 = await device(12);
  await cast.reviewer.as.mutation(api.push.subscribe, d1);
  await cast.reviewer.as.mutation(api.push.subscribe, d2);
  const workId = await setupWork(t, cast);
  await submitFiles(cast, workId, pdf);
  await cast.manager.as.mutation(api.reviews.setReviewers, {
    workId,
    reviewerIds: [cast.reviewer.id],
  });
  const scheduled = await scheduledDeliveries(t);
  const notificationId = firstNotificationId(scheduled[0]!);
  let failed = false;
  const fetch = vi.fn(async (url: string) => {
    if (url === d2.endpoint && !failed) {
      failed = true;
      return new Response(null, { status: 503 });
    }
    return new Response(null, { status: 201 });
  });
  vi.stubGlobal("fetch", fetch);
  await expect(t.action(internal.pushNode.deliver, { notificationId })).rejects.toThrow(
    "push_transient_failure",
  );
  expect(await t.action(internal.pushNode.deliver, { notificationId })).toBe(1);
  expect(fetch.mock.calls.filter(([url]) => url === d1.endpoint)).toHaveLength(1);
  expect(fetch.mock.calls.filter(([url]) => url === d2.endpoint)).toHaveLength(2);
});
