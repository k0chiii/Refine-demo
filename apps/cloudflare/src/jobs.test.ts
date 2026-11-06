import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { MARK_ALL_READ_BATCH } from "@mf100/application";
import { createApp } from "./app.ts";
import { base64urlEncode } from "./delivery/webpush.ts";
import type { Sql } from "./sqlite/sql.ts";
import { app, fakeDb, post, signIn } from "./testing/http.ts";

afterEach(() => {
  vi.restoreAllMocks();
});

const ENDPOINT = "https://fcm.googleapis.com/fcm/send/device-1";

/** 端末の購読に要る鍵（暗号化できれば中身は問わない） */
async function device() {
  const pair = (await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, [
    "deriveBits",
  ])) as CryptoKeyPair;
  const raw = new Uint8Array((await crypto.subtle.exportKey("raw", pair.publicKey)) as ArrayBuffer);
  return {
    p256dh: base64urlEncode(raw),
    auth: base64urlEncode(crypto.getRandomValues(new Uint8Array(16))),
  };
}

async function vapidEnv() {
  const pair = (await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, [
    "sign",
    "verify",
  ])) as CryptoKeyPair;
  const raw = new Uint8Array((await crypto.subtle.exportKey("raw", pair.publicKey)) as ArrayBuffer);
  const jwk = (await crypto.subtle.exportKey("jwk", pair.privateKey)) as JsonWebKey;
  return {
    FRONTEND_URL: "https://mf100.example-org.jp",
    VAPID_PUBLIC_KEY: base64urlEncode(raw),
    VAPID_PRIVATE_KEY: jwk.d!,
    VAPID_SUBJECT: "mailto:ops@example.invalid",
  };
}

/** プッシュサービスの代わり。status を順に返す（足りなければ最後の値）。Retry-After は 1 回目だけ付けられる */
function pushService(statuses: number[], headers: Record<string, string> = {}) {
  let n = 0;
  return vi.fn<typeof globalThis.fetch>(async () => {
    const status = statuses[Math.min(n, statuses.length - 1)]!;
    n++;
    return new Response(null, { status, headers: status === 429 ? headers : {} });
  });
}

/**
 * 制作者（u_creator）が端末を登録している制作物に、校正者（u_reviewer）がコメントを書く。
 * 制作者への通知が 1 件でき、端末に送る仕事が 1 件積まれる
 */
async function world(wrap?: (sql: Sql) => Sql) {
  const db = fakeDb(wrap, { MF100_SYSTEM_ADMIN_SUBJECTS: "u_admin", ...(await vapidEnv()) });
  const a = app(db);
  const call = async (name: string, args: unknown, subject: string) => {
    const res = await post(a, name, args, subject);
    const body = (await res.json()) as { value?: unknown; code?: string };
    return { status: res.status, ...body };
  };
  const ok = async (name: string, args: unknown, subject: string) => {
    const r = await call(name, args, subject);
    expect(r.status, `${name}: ${JSON.stringify(r)}`).toBe(200);
    return r.value;
  };
  const creator = await signIn(a, "u_creator");
  const workId = (await ok(
    "works:create",
    {
      title: "ポスター",
      purpose: "告知",
      category: "印刷物",
      mediaType: "pdf",
      year: 100,
      creatorIds: [creator],
      approverId: await signIn(a, "u_approver"),
      reviewerIds: [await signIn(a, "u_reviewer")],
      activate: true,
    },
    "u_manager",
  )) as string;
  const { p256dh, auth } = await device();
  await ok("push:subscribe", { endpoint: ENDPOINT, p256dh, auth }, "u_creator");

  // 版の提出（実体の転送は Worker 専用: サービスの鍵が要る）
  const key = { "X-MF100-Service-Key": "upload-secret-0123456789" };
  const prepared = (await ok(
    "submissions:prepare",
    {
      workId,
      kind: "standard",
      reviewType: "general",
      deadlineAt: db.clock.current + 48 * 3_600_000,
      changeSummary: "初版",
      focusNotes: "",
      items: [{ fileName: "a.pdf", mimeType: "application/pdf", type: "pdf", role: "source" }],
    },
    "u_creator",
  )) as { sessionId: string; items: { id: string }[] };
  const begun = (await (
    await post(a, "submissions:beginUpload", { itemId: prepared.items[0]!.id }, "u_creator", key)
  ).json()) as { value: { attemptId: string } };
  await post(
    a,
    "submissions:completeUpload",
    { attemptId: begun.value.attemptId, size: 10, sha256: "abc" },
    "u_creator",
    key,
  );
  const { revisionId } = (await ok(
    "submissions:confirm",
    { sessionId: prepared.sessionId },
    "u_creator",
  )) as { revisionId: string };

  const comment = (requestId?: string) =>
    call(
      "comments:post",
      {
        revisionId,
        body: "誤字です",
        kind: "correction",
        severity: "minor",
        ...(requestId ? { requestId } : {}),
      },
      "u_reviewer",
    );
  return { db, a, call, ok, creator, workId, revisionId, comment };
}

const deliverJobs = (w: Awaited<ReturnType<typeof world>>) =>
  w.db.jobs().filter((j) => j.kind === "deliver");

describe("通知を生む操作 → deliver の仕事 → alarm で外へ送る", () => {
  it("通知 1 件につき deliver が 1 件積まれ、動かすと端末へ POST して決着を記録し、仕事が消える", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const w = await world();
    expect((await w.comment()).status).toBe(200);

    const [job, ...rest] = deliverJobs(w);
    expect(rest).toEqual([]);
    expect(job).toMatchObject({ kind: "deliver", attempts: 0, runAt: w.db.clock.current });
    // jobs は購読者に配らない（書いた表の名前に出ない）
    expect(w.db.notified.flat()).not.toContain("jobs");

    const fetch = pushService([201]);
    const { nextRunAt, touched } = await w.db.runDue({ fetch });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0]![0]).toBe(ENDPOINT);
    expect(new Headers(fetch.mock.calls[0]![1]?.headers).get("Authorization")).toMatch(/^vapid /);
    expect(deliverJobs(w)).toEqual([]);
    expect(nextRunAt).toBeNull();
    expect(touched).toContain("deliveries");
    expect(
      w.db.sql.exec(
        "SELECT count(*) AS n FROM deliveries WHERE notificationId = ?",
        job!.payload.notificationId as string,
      ),
    ).toEqual([{ n: 1 }]);

    // 決着した届け先には、もう送らない
    expect(w.db.jobs()).toEqual([]);
  });

  it("端末が 429（Retry-After 90 秒）なら attempts と runAt が進み、時が来るまで動かさない", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const w = await world();
    await w.comment();
    const fetch = pushService([429, 201], { "Retry-After": "90" });

    const first = await w.db.runDue({ fetch });
    const [job] = deliverJobs(w);
    // 待ちの下限は Retry-After（90 秒 > 1 回目の失敗の後の 1 秒）
    expect(job).toMatchObject({ attempts: 1, runAt: w.db.clock.current + 90_000 });
    expect(job!.lastError).toBeTruthy();
    expect(first.nextRunAt).toBe(job!.runAt);

    await w.db.runDue({ fetch });
    expect(fetch).toHaveBeenCalledTimes(1);

    w.db.clock.current += 90_000;
    await w.db.runDue({ fetch });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(w.db.jobs()).toEqual([]);
  });

  it("5xx で Retry-After が無ければ 1 秒・2 秒・4 秒と待ち、4 回失敗したらあきらめて消す（宛先はログに出さない）", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const w = await world();
    await w.comment();
    const fetch = pushService([503]);

    for (const wait of [1000, 2000, 4000]) {
      const at = w.db.clock.current;
      await w.db.runDue({ fetch });
      expect(deliverJobs(w)[0]!.runAt).toBe(at + wait);
      w.db.clock.current += wait;
    }
    expect(deliverJobs(w)[0]!.attempts).toBe(3);
    await w.db.runDue({ fetch });
    expect(fetch).toHaveBeenCalledTimes(4);
    expect(w.db.jobs()).toEqual([]);

    const gaveUp = warn.mock.calls.map(([m]) => String(m)).find((m) => m.includes("job_gave_up"));
    expect(JSON.parse(gaveUp!)).toMatchObject({
      event: "job_gave_up",
      kind: "deliver",
      attempts: 4,
    });
    expect(gaveUp).not.toContain("fcm.googleapis.com");
  });

  it("投げた仕事は retry 扱い（attempts が進む）", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const w = await world();
    await w.comment();
    // 暗号化の失敗のような、fetch の外の例外
    w.db.sql.exec(
      "UPDATE pushSubscriptions SET doc = json_set(doc, '$.p256dh', 'x') WHERE json_extract(doc, '$.endpoint') = ?",
      ENDPOINT,
    );
    await w.db.runDue({ fetch: pushService([201]) });
    expect(deliverJobs(w)[0]).toMatchObject({ attempts: 1 });
  });

  it("巻き戻った mutation には仕事が残らない", async () => {
    // jobs へ積んだ直後の次の文で落とす（制作者への通知のあと、冪等の記録（requestId）を書くところで）
    let armed = false;
    const w = await world((sql) => ({
      exec: (query, ...params) => {
        if (armed) throw new Error("boom");
        const rows = sql.exec(query, ...params);
        if (/INTO jobs/.test(query)) armed = true;
        return rows;
      },
    }));
    vi.spyOn(console, "error").mockImplementation(() => {});
    // 途中で落ちた呼び出しは 500。何も残らない
    const res = await post(
      w.a,
      "comments:post",
      {
        revisionId: w.revisionId,
        body: "誤字です",
        kind: "correction",
        severity: "minor",
        requestId: "req-1",
      },
      "u_reviewer",
    );
    expect(res.status).toBe(500);
    expect(armed).toBe(true);
    armed = false;
    expect(w.db.jobs()).toEqual([]);
    expect(w.db.sql.exec("SELECT count(*) AS n FROM threads")).toEqual([{ n: 0 }]);
  });
});

describe("そのほかの仕事", () => {
  it("すべて既読は上限を超えたら続きを積み、動かすと全部既読になる", async () => {
    const db = fakeDb();
    const a = app(db);
    const me = await signIn(a, "u_manager");
    const total = MARK_ALL_READ_BATCH + 5;
    for (let i = 0; i < total; i++)
      await db.db.notifications.insert({
        recipientId: me,
        kind: "test",
        title: "t",
        body: "b",
        createdAt: db.clock.current,
      });
    const unread = async () =>
      ((await (await post(a, "notifications:unreadCount", {})).json()) as { value: number }).value;
    expect(await unread()).toBe(total);

    const res = await post(a, "notifications:markAllRead", {});
    expect(((await res.json()) as { value: number }).value).toBe(MARK_ALL_READ_BATCH);
    expect(db.jobs().map((j) => ({ kind: j.kind, ...j.payload }))).toEqual([
      { kind: "continueMarkAllRead", recipientId: me, asOf: db.clock.current },
    ]);
    expect(await unread()).toBe(5);

    const { touched } = await db.runDue({ fetch: vi.fn() });
    expect(db.jobs()).toEqual([]);
    expect(await unread()).toBe(0);
    expect(touched).toContain("notifications");
  });

  it("登録情報を変えると planInfoSync が積まれ、動かすと消える。ほかの項目の変更では積まない", async () => {
    const db = fakeDb(undefined, { MF100_SYSTEM_ADMIN_SUBJECTS: "u_admin" });
    const a = app(db);
    const workId = (await (
      await post(a, "works:create", {
        title: "ポスター",
        purpose: "告知",
        category: "印刷物",
        mediaType: "pdf",
        year: 100,
        creatorIds: [await signIn(a, "u_creator")],
        approverId: await signIn(a, "u_approver"),
      })
    ).json()) as { value: string };
    await post(a, "works:update", { workId: workId.value, patch: { title: "改題" } });
    expect(db.jobs()).toEqual([]);

    const res = await post(a, "works:update", {
      workId: workId.value,
      patch: { registeredPlanInfo: { name: "企画名" } },
    });
    expect(res.status).toBe(200);
    const manager = await signIn(a, "u_manager");
    expect(db.jobs().map((j) => ({ kind: j.kind, ...j.payload }))).toEqual([
      { kind: "planInfoSync", workId: workId.value, userId: manager },
    ]);
    await db.runDue({ fetch: vi.fn() });
    expect(db.jobs()).toEqual([]);
  });

  it("使える経路が無ければ（env が空）、通知ができても deliver は積まない", async () => {
    const db = fakeDb();
    const a = app(db);
    expect((await post(a, "notifications:sendTest", {}, "u_creator")).status).toBe(200);
    expect(db.sql.exec("SELECT count(*) AS n FROM notifications")).toEqual([{ n: 1 }]);
    expect(db.jobs()).toEqual([]);
  });
});

describe("GET /ws?token=", () => {
  const identify = async (request: Request) =>
    request.headers.get("Authorization") === "Bearer secret-token"
      ? { subject: "u_manager", name: "統括" }
      : null;
  const wsApp = (db = fakeDb()) =>
    createApp({
      identify,
      db: () => db,
      secret: () => undefined,
      allowedOrigins: [],
      auth: { store: () => ({}) as never, env: {} },
    });

  it("?token= を Authorization: Bearer と同じに扱って受け付け、URL から外して DO へ渡す", async () => {
    const db = fakeDb();
    const res = await wsApp(db).request("/ws?token=secret-token&x=1", {
      headers: { Upgrade: "websocket" },
    });
    expect(res.status).toBe(200);
    expect(db.upgrades).toHaveLength(1);
    const forwarded = db.upgrades[0]!;
    expect(forwarded.headers.get("Authorization")).toBe("Bearer secret-token");
    expect(forwarded.headers.get("Upgrade")).toBe("websocket");
    expect(new URL(forwarded.url).search).toBe("?x=1");
  });

  it("token が無い・違うなら 401。Upgrade が無ければ 426", async () => {
    const db = fakeDb();
    const a = wsApp(db);
    expect((await a.request("/ws", { headers: { Upgrade: "websocket" } })).status).toBe(401);
    expect((await a.request("/ws?token=wrong", { headers: { Upgrade: "websocket" } })).status).toBe(
      401,
    );
    expect((await a.request("/ws?token=secret-token")).status).toBe(426);
    expect(db.upgrades).toEqual([]);
  });
});
