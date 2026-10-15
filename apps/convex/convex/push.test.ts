import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { api, internal } from "./_generated/api";
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

async function scheduledDeliveries(t: ReturnType<typeof createHarness>) {
  return t.run(async (ctx) =>
    (await ctx.db.system.query("_scheduled_functions").collect()).filter((f) =>
      f.name.startsWith("pushNode"),
    ),
  );
}

describe("Convex 統合: 端末への通知（Web Push）", () => {
  it("鍵が無い環境では使えない（config が null・送信を予約しない）", async () => {
    const t = createHarness();
    const cast = await createCast(t);
    expect(await cast.reviewer.as.query(api.push.config, {})).toBeNull();
    await cast.reviewer.as.mutation(api.push.subscribe, await device(1));
    const workId = await setupWork(t, cast);
    const { revisionId } = await submitFiles(cast, workId, pdf);
    await cast.manager.as.mutation(api.reviews.assign, {
      revisionId,
      reviewerIds: [cast.reviewer.id],
      reviewType: "general",
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
    const { revisionId } = await submitFiles(cast, workId, pdf);
    await cast.manager.as.mutation(api.reviews.assign, {
      revisionId,
      reviewerIds: [cast.reviewer.id],
      reviewType: "general",
    });
    const scheduled = await scheduledDeliveries(t);
    expect(scheduled).toHaveLength(1); // 端末を登録したのは reviewer だけ
    const notificationId = (scheduled[0]!.args[0] as { notificationId: string }).notificationId;

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
