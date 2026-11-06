import { describe, expect, it } from "vite-plus/test";
import type { Sql } from "./sqlite/sql.ts";
import { app, fakeDb, post, signIn, UPLOAD_SECRET } from "./testing/http.ts";

// processing:*（ファイル処理の台帳）と /internal/processing を、HTTP から 1 周させる。
// 期待は apps/convex/convex/processing.test.ts から写した（権限・同意・派生キー・権限剥奪後の拒否・進行中の制作物だけ）。
// Convex の「rejects.toThrow()」は、ここでは状態と code（素の Error の message と同じ理由）で確かめる

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const NOW = Date.UTC(2026, 10, 1);
const SECRET = "processing-secret-0123456789abcdef";
const KEY = { "X-MF100-Service-Key": UPLOAD_SECRET };
const BEARER = { Authorization: `Bearer ${SECRET}` };
const FIGMA_ORIGIN = {
  kind: "figma",
  fileKey: "AbCdEfGhIjKl",
  nodeId: "12:34",
  scale: 1,
  box: { width: 100, height: 80 },
};

/** 戻りの形を見るテストなので、型は付けずに値だけ引く */
// oxlint-disable-next-line typescript/no-explicit-any
type Json = any;

function world(env: Record<string, string> = {}) {
  let sql!: Sql;
  const db = fakeDb(
    (s) => {
      sql = s;
      return s;
    },
    {
      MF100_SYSTEM_ADMIN_SUBJECTS: "u_admin",
      PROCESSING_ENABLED: "true",
      PROCESSING_CAPABILITIES: "image,web-snapshot,figma,stream,video-frame,container-preview",
      ...env,
    },
  );
  const a = app(db, { MF100_UPLOAD_SECRET: UPLOAD_SECRET, PROCESSING_SECRET: SECRET });
  const call = async (
    name: string,
    args: unknown,
    subject = "u_creator",
    headers: Record<string, string> = {},
  ) => {
    const res = await post(a, name, args, subject, headers);
    const body = (await res.json()) as { value?: unknown };
    expect(res.status, `${name}: ${JSON.stringify(body)}`).toBe(200);
    return body.value as Json;
  };
  const fail = async (
    name: string,
    args: unknown,
    subject: string | null = "u_creator",
    headers: Record<string, string> = {},
  ) => {
    const res = await post(a, name, args, subject, headers);
    return { status: res.status, ...((await res.json()) as { code: string }) };
  };
  /** apps/api の processingGateway と同じ呼び方 */
  const gateway = async (
    operation: string,
    args: unknown,
    headers: Record<string, string> = BEARER,
  ) =>
    a.request("/internal/processing", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify({ operation, args }),
    });
  /** gateway が成功したときの戻り（関数の戻りそのもの） */
  const ok = async (operation: string, args: unknown) => {
    const res = await gateway(operation, args);
    expect(res.status, `${operation}: ${await res.clone().text()}`).toBe(200);
    return (await res.json()) as Json;
  };
  return { db, a, sql, call, fail, gateway, ok };
}
type World = ReturnType<typeof world>;

/**
 * 制作者 u_creator の制作物に、実体の検証が済んだ項目を 1 つ置いた提出の準備まで進める（確定はしない）。
 * 戻りの artifact は確定した版の添付（実体のある項目）
 */
async function submitted(
  w: World,
  { mediaType = "image", item }: { mediaType?: string; item?: Record<string, unknown> } = {},
) {
  const creator = await signIn(w.a, "u_creator");
  const approver = await signIn(w.a, "u_approver");
  const workId = (await w.call(
    "works:create",
    {
      title: "ポスター",
      purpose: "告知",
      category: "印刷物",
      mediaType,
      year: 100,
      creatorIds: [creator],
      approverId: approver,
      activate: true,
    },
    "u_manager",
  )) as string;
  const prepared = await w.call("submissions:prepare", {
    workId,
    kind: "standard",
    reviewType: "general",
    deadlineAt: NOW + 48 * HOUR,
    changeSummary: "初版",
    focusNotes: "",
    items: [item ?? { fileName: "a.png", mimeType: "image/png", type: "image", role: "source" }],
  });
  return { workId, creator, prepared: prepared as { sessionId: string; items: { id: string }[] } };
}

/** 実体を置いて確定し、版の添付の ID を返す */
async function confirmed(w: World, s: Awaited<ReturnType<typeof submitted>>) {
  const begun = await w.call(
    "submissions:beginUpload",
    { itemId: s.prepared.items[0]!.id },
    "u_creator",
    KEY,
  );
  await w.call(
    "submissions:completeUpload",
    { attemptId: begun.attemptId, size: 10, sha256: "abc" },
    "u_creator",
    KEY,
  );
  const { revisionId } = await w.call("submissions:confirm", { sessionId: s.prepared.sessionId });
  const [row] = w.sql.exec("SELECT id FROM artifacts WHERE revisionId = ?", revisionId);
  return { artifactId: row!.id as string, revisionId: revisionId as string };
}

const consent = { consentToProcessing: true };

describe("processing:create", () => {
  it("明示同意・作品権限・同時 3 件まで・同じ依頼は同じ ID。無効な環境・種類は断る", async () => {
    const w = world();
    const s = await submitted(w);
    const { artifactId } = await confirmed(w, s);
    const options = { artifactId };

    // 同意なし
    expect(
      await w.fail("processing:create", { kind: "image", options, consentToProcessing: false }),
    ).toMatchObject({ status: 400, code: "processing_disabled_or_consent_missing" });
    // 関係ない人には存在も教えない
    expect(
      await w.fail("processing:create", { kind: "image", options, ...consent }, "u_stranger"),
    ).toMatchObject({ status: 403, code: "forbidden" });
    // 画像でない実体を画像として処理に出せない
    const wrongMedia = await w.fail("processing:create", { kind: "stream", options, ...consent });
    expect(wrongMedia).toMatchObject({ status: 400, code: "invalid_processing_media" });

    const jobId = await w.call("processing:create", { kind: "image", options, ...consent });
    expect(typeof jobId).toBe("string");
    // 同じ依頼は新しい job を作らず、走っている job の ID を返す
    expect(await w.call("processing:create", { kind: "image", options, ...consent })).toBe(jobId);
    expect(w.sql.exec("SELECT count(*) AS n FROM processingJobs")[0]!.n, "二重に積まない").toBe(1);

    // 同時に走らせてよいのは 3 件まで（options が違えば別の依頼）
    for (const time of [1, 2])
      await w.call("processing:create", {
        kind: "image",
        options: { ...options, time },
        ...consent,
      });
    expect(
      await w.fail("processing:create", {
        kind: "image",
        options: { ...options, time: 3 },
        ...consent,
      }),
    ).toMatchObject({ status: 400, code: "processing_quota_exceeded" });
  });

  it("環境で無効、種類が許可外、必須の引数が無い、URL・時刻が不正なものは断る", async () => {
    const off = world({ PROCESSING_ENABLED: "false" });
    const s = await submitted(off);
    const { artifactId } = await confirmed(off, s);
    expect(
      await off.fail("processing:create", { kind: "image", options: { artifactId }, ...consent }),
    ).toMatchObject({ code: "processing_disabled_or_consent_missing" });

    const w = world({ PROCESSING_CAPABILITIES: "image,web-snapshot" });
    const t = await submitted(w);
    const a = await confirmed(w, t);
    const bad = (kind: string, options: unknown) =>
      w.fail("processing:create", { kind, options, ...consent }).then((r) => r.code);
    expect(await bad("video-frame", { artifactId: a.artifactId })).toBe(
      "processing_disabled_or_consent_missing",
    );
    expect(await bad("image", {})).toBe("artifact_required");
    expect(await bad("image", { artifactId: a.artifactId, time: -1 })).toBe("invalid_frame_time");
    expect(await bad("web-snapshot", { workId: t.workId })).toBe("invalid_snapshot_url");
    expect(await bad("web-snapshot", { workId: t.workId, url: "http://example.com/" })).toBe(
      "invalid_snapshot_url",
    );
    expect(await bad("web-snapshot", { workId: t.workId, url: "https://a.example:8443/" })).toBe(
      "invalid_snapshot_url",
    );
    expect(await bad("web-snapshot", { workId: t.workId, url: "https://example.com/#x" })).toBe(
      "invalid_snapshot_url",
    );
    // 作品が決まらない（artifact も workId も無い）
    expect(await bad("web-snapshot", { url: "https://example.com/" })).toBe("work_required");
    // 引数の形は境界が弾く（未知の鍵）
    expect(
      (await w.fail("processing:create", { kind: "image", options: { x: 1 }, ...consent })).code,
    ).toBe("invalid_args");
  });

  it("校了した制作物には出せない（進行中だけ）。進行中なら Web のスナップショットも依頼できる", async () => {
    const w = world();
    const s = await submitted(w, {
      mediaType: "pdf",
      item: { fileName: "x.pdf", mimeType: "application/pdf", type: "pdf", role: "source" },
    });
    const { revisionId } = await confirmed(w, s);
    const options = { workId: s.workId, url: "https://example.com/" };
    await w.call("processing:create", { kind: "web-snapshot", options, ...consent });

    await w.call("approvals:finalize", { workId: s.workId, revisionId }, "u_approver");
    expect(
      await w.fail("processing:create", { kind: "web-snapshot", options, ...consent }),
    ).toMatchObject({ code: "processing_not_allowed" });
  });

  it("制作物の枠が尽きていれば、先に取った利用者の枠も戻る（mutation ごと巻き戻る）", async () => {
    const w = world();
    const s = await submitted(w);
    // 制作物の 1 日の枠（40 件）を使い切った状態
    w.sql.exec(
      "INSERT INTO rateLimits (name, key, value, ts) VALUES ('processingWork', ?, 0, ?)",
      s.workId,
      NOW,
    );
    const res = await w.fail("processing:create", {
      kind: "web-snapshot",
      options: { workId: s.workId, url: "https://example.com/" },
      ...consent,
    });
    expect(res).toMatchObject({ status: 400, code: "processing_quota_exceeded" });
    expect(
      w.sql.exec("SELECT count(*) AS n FROM rateLimits WHERE name = 'processingUser'")[0]!.n,
    ).toBe(0);
  });

  it("1 日の上限: 利用者ごとに 20 件。超えたら待ち時間つきで断り、1 日たてば戻る", async () => {
    const w = world();
    const s = await submitted(w);
    const create = (n: number) =>
      w.fail("processing:create", {
        kind: "web-snapshot",
        options: { workId: s.workId, url: `https://example.com/${n}` },
        ...consent,
      });
    // 3 件の同時上限に当たらないよう、1 件ごとに失敗にして枠を空ける
    for (let n = 0; n < 20; n++) {
      const res = await create(n);
      expect(res.status, JSON.stringify(res)).toBe(200);
      const id = (res as unknown as { value: string }).value;
      await w.ok("fail", { jobId: id });
    }
    const over = await create(20);
    expect(over).toMatchObject({ status: 400, code: "processing_quota_exceeded" });
    expect((over as unknown as { details: { retryAfterMs: number } }).details.retryAfterMs).toBe(
      DAY,
    );
    // 断った分は何も残らない（job も、枠の消費も）
    expect(w.sql.exec("SELECT count(*) AS n FROM processingJobs")[0]!.n).toBe(20);
    w.db.clock.current += DAY;
    expect((await create(21)).status).toBe(200);
  });
});

describe("processing:get / cancel / status", () => {
  it("get は制作物を見られる人なら誰でも。cancel は依頼した本人だけで、完了したものは取り消せない", async () => {
    const w = world();
    const s = await submitted(w);
    const { artifactId } = await confirmed(w, s);
    const jobId = await w.call("processing:create", {
      kind: "image",
      options: { artifactId },
      ...consent,
    });

    expect(await w.call("processing:get", { jobId })).toEqual({
      id: jobId,
      kind: "image",
      state: "queued",
      output: null,
      error: null,
    });
    // 制作物を見られる人なら、依頼した本人でなくても読める（Convex の stranger も閲覧はできる）
    expect(await w.call("processing:get", { jobId }, "u_manager")).toMatchObject({
      state: "queued",
    });
    expect(await w.call("processing:get", { jobId }, "u_stranger")).toMatchObject({
      state: "queued",
    });
    // 知らない job は存在を教えない
    expect(await w.fail("processing:get", { jobId: "nope" })).toMatchObject({
      status: 403,
      code: "forbidden",
    });

    // 本人以外は取り消せない
    expect(await w.fail("processing:cancel", { jobId }, "u_manager")).toMatchObject({
      status: 403,
    });
    await w.call("processing:cancel", { jobId });
    expect(await w.call("processing:get", { jobId })).toMatchObject({ state: "cancelled" });
    // 取り消した job は処理に渡さない
    expect((await w.gateway("inspect", { jobId })).status).toBe(409);

    // 完了した job は取り消せない
    const done = await w.call("processing:create", {
      kind: "image",
      options: { artifactId, time: 1 },
      ...consent,
    });
    await w.ok("complete", { jobId: done, output: { key: `derived/${done}/result` } });
    expect(await w.fail("processing:cancel", { jobId: done })).toMatchObject({ status: 403 });
  });

  it("status は処理を出せる人にだけ enabled と許可された種類を返す", async () => {
    const w = world({ PROCESSING_CAPABILITIES: "image, web-snapshot" });
    const s = await submitted(w);
    expect(await w.call("processing:status", { workId: s.workId })).toEqual({
      enabled: true,
      kinds: ["image", "web-snapshot"],
    });
    // 提出できない人（閲覧だけ）には出さない
    for (const subject of ["u_approver", "u_stranger"])
      expect(await w.call("processing:status", { workId: s.workId }, subject)).toEqual({
        enabled: false,
        kinds: [],
      });
    // 存在しない制作物は forbidden
    expect(await w.fail("processing:status", { workId: "nope" })).toMatchObject({ status: 403 });
  });
});

describe("internal の operation（apps/api の processingGateway）", () => {
  it("inspect → complete: 派生キーだけを採用し、完了は何度呼んでも同じ。権限を失った持ち主の job は動かせない", async () => {
    const w = world();
    const s = await submitted(w);
    const { artifactId } = await confirmed(w, s);
    const jobId = await w.call("processing:create", {
      kind: "image",
      options: { artifactId },
      ...consent,
    });

    const info = await w.ok("inspect", { jobId });
    expect(info.source).toMatch(/\S/);
    expect(info).toMatchObject({
      mimeType: "image/png",
      adopted: false,
      target: null,
      origin: null,
    });
    // Convex の doc の形（apps/api の streamProcessing が job._id を読む）
    expect(info.job).toMatchObject({
      _id: jobId,
      kind: "image",
      state: "queued",
      workId: s.workId,
    });
    expect(info.job).not.toHaveProperty("id");

    // 他の実体の置き場を結果として差し込ませない
    expect(
      (await w.gateway("complete", { jobId, output: { key: "original/replaced" } })).status,
    ).toBe(409);
    expect(await w.call("processing:get", { jobId })).toMatchObject({ state: "queued" });

    // 統括が制作者を入れ替える: 依頼者は権限を失い、結果の採用も取得も拒否される
    await w.call(
      "works:update",
      { workId: s.workId, patch: { creatorIds: [await signIn(w.a, "u_stranger")] } },
      "u_manager",
    );
    expect((await w.gateway("inspect", { jobId })).status).toBe(409);
    expect(
      (await w.gateway("complete", { jobId, output: { key: `derived/${jobId}/result` } })).status,
    ).toBe(409);
    // 失敗にするのは権限に依らない。新しい制作者（見られる人）には失敗が見える
    expect(await w.ok("fail", { jobId })).toBeNull();
    expect(await w.call("processing:get", { jobId }, "u_stranger")).toMatchObject({
      state: "failed",
      output: null,
      error: "処理を完了できませんでした",
    });
  });

  it("complete は ready にして出力を持つ。ready は fail で戻らず、失敗した job の complete は断る", async () => {
    const w = world();
    const s = await submitted(w);
    const { artifactId } = await confirmed(w, s);
    const create = (time: number) =>
      w.call("processing:create", { kind: "image", options: { artifactId, time }, ...consent });
    const a = await create(1);
    const output = { key: `derived/${a}/result`, contentType: "image/webp", size: 12 };
    expect(await w.ok("complete", { jobId: a, output })).toBeNull();
    expect(await w.call("processing:get", { jobId: a })).toMatchObject({ state: "ready", output });
    // 2 回目は何もしない（Queue の再配送）。fail も ready を壊さない
    expect(
      await w.ok("complete", { jobId: a, output: { key: `derived/${a}/result`, size: 99 } }),
    ).toBeNull();
    await w.ok("fail", { jobId: a });
    expect(await w.call("processing:get", { jobId: a })).toMatchObject({ state: "ready", output });

    const b = await create(2);
    await w.ok("fail", { jobId: b });
    expect(
      (await w.gateway("complete", { jobId: b, output: { key: `derived/${b}/result` } })).status,
    ).toBe(409);
    // 知らない job の complete は 409。fail は何もせず null
    expect((await w.gateway("complete", { jobId: "nope", output: {} })).status).toBe(409);
    expect(await w.ok("fail", { jobId: "nope" })).toBeNull();
  });

  it("streamSession: 動画の job に、Stream のホストの upload URL だけを 1 つの uid で記録する", async () => {
    const w = world();
    const s = await submitted(w, {
      mediaType: "video",
      item: { fileName: "a.mp4", mimeType: "video/mp4", type: "video", role: "source" },
    });
    const { artifactId } = await confirmed(w, s);
    const jobId = await w.call("processing:create", {
      kind: "stream",
      options: { artifactId },
      ...consent,
    });
    const uid = "a".repeat(32);
    const uploadUrl = "https://upload.videodelivery.net/abc";
    const reject = (args: Record<string, unknown>) =>
      w.gateway("streamSession", { jobId, uid, uploadUrl, ...args }).then((r) => r.status);
    expect(await reject({ uid: "short" })).toBe(409);
    expect(await reject({ uploadUrl: "http://upload.videodelivery.net/abc" })).toBe(409);
    expect(await reject({ uploadUrl: "https://evil.example/abc" })).toBe(409);
    expect(await reject({ uploadUrl: "not a url" })).toBe(409);
    expect(await w.ok("streamSession", { jobId, uid, uploadUrl })).toBeNull();
    expect((await w.ok("inspect", { jobId })).job).toMatchObject({
      streamUid: uid,
      streamUploadUrl: uploadUrl,
    });
    // 別の uid は予約済みの job に入れられない。image の job には使えない
    expect(await reject({ uid: "b".repeat(32) })).toBe(409);
    // 完了の streamUid は予約した uid だけ
    expect(
      (await w.gateway("complete", { jobId, output: { streamUid: "c".repeat(32) } })).status,
    ).toBe(409);
    expect(await w.ok("complete", { jobId, output: { streamUid: uid } })).toBeNull();
  });

  it("figma: 取り込み先の試行を払い出し、同じ項目は同じ job。figmaComplete で検証済みにし、再配送は何もしない", async () => {
    const w = world();
    const s = await submitted(w, {
      mediaType: "figma",
      item: {
        fileName: "frame.png",
        mimeType: "image/png",
        type: "image",
        role: "source",
        origin: FIGMA_ORIGIN,
      },
    });
    const itemId = s.prepared.items[0]!.id;
    const jobId = await w.call("processing:create", {
      kind: "figma",
      options: { itemId },
      ...consent,
    });
    // 進行中の取り込みがあれば、それを返す
    expect(
      await w.call("processing:create", { kind: "figma", options: { itemId }, ...consent }),
    ).toBe(jobId);
    // 他人の項目は取り込めない
    expect(
      await w.fail(
        "processing:create",
        { kind: "figma", options: { itemId }, ...consent },
        "u_manager",
      ),
    ).toMatchObject({ status: 403 });

    const info = await w.ok("inspect", { jobId });
    expect(info.origin).toMatchObject({ kind: "figma", fileKey: FIGMA_ORIGIN.fileKey });
    expect(info.target).toMatchObject({ fileName: "frame.png", mimeType: "image/png" });
    expect(info.target.objectKey).toMatch(/\S/);
    expect(info.adopted).toBe(false);

    const done = {
      jobId,
      size: 10,
      sha256: "abc",
      figma: { nodeName: "Frame", box: { width: 100, height: 80 } },
    };
    expect(await w.ok("figmaComplete", done)).toEqual({ status: "verified", failureMessage: null });
    expect((await w.ok("inspect", { jobId })).adopted).toBe(true);
    expect(await w.ok("figmaComplete", done)).toEqual({ status: "verified", failureMessage: null });
    // figma 以外の job には使えない
    const other = await w.call("processing:create", {
      kind: "web-snapshot",
      options: { workId: s.workId, url: "https://example.com/" },
      ...consent,
    });
    expect((await w.gateway("figmaComplete", { ...done, jobId: other })).status).toBe(409);
  });

  it("cleanupCandidates は 24 時間たった失敗・取り消しだけ（25 件ずつ）。markCleaned で一覧から消え、upload URL を捨てる", async () => {
    const w = world();
    const s = await submitted(w);
    const create = (n: number) =>
      w.call("processing:create", {
        kind: "web-snapshot",
        options: { workId: s.workId, url: `https://example.com/${n}` },
        ...consent,
      });
    const failed = await create(1);
    await w.ok("fail", { jobId: failed });
    const cancelled = await create(2);
    await w.call("processing:cancel", { jobId: cancelled });
    const running = await create(3);
    expect(await w.ok("cleanupCandidates", {})).toEqual([]);

    w.db.clock.current += DAY + 1;
    const candidates = (await w.ok("cleanupCandidates", {})) as {
      jobId: string;
      key: string;
      streamUid: null;
    }[];
    expect(new Set(candidates.map((c) => c.jobId))).toEqual(new Set([failed, cancelled]));
    expect(candidates[0]).toMatchObject({
      key: `derived/${candidates[0]!.jobId}/result`,
      streamUid: null,
    });

    w.sql.exec(
      "UPDATE processingJobs SET doc = json_set(doc, '$.streamUploadUrl', 'https://upload.videodelivery.net/x') WHERE id = ?",
      failed,
    );
    expect(await w.ok("markCleaned", { jobId: failed })).toBeNull();
    // 走っている job には効かない
    await w.ok("markCleaned", { jobId: running });
    expect((await w.ok("cleanupCandidates", {})).map((c: { jobId: string }) => c.jobId)).toEqual([
      cancelled,
    ]);
    const doc = JSON.parse(
      w.sql.exec("SELECT doc FROM processingJobs WHERE id = ?", failed)[0]!.doc as string,
    );
    expect(doc).toMatchObject({ cleaned: true });
    expect(doc).not.toHaveProperty("streamUploadUrl");
    expect(
      JSON.parse(
        w.sql.exec("SELECT doc FROM processingJobs WHERE id = ?", running)[0]!.doc as string,
      ),
    ).not.toHaveProperty("cleaned");
  });

  it("expire: 6 時間たっても queued / running の job だけを失敗にする（cron が毎時に呼ぶ）", async () => {
    const w = world();
    const s = await submitted(w);
    const create = (n: number) =>
      w.call("processing:create", {
        kind: "web-snapshot",
        options: { workId: s.workId, url: `https://example.com/${n}` },
        ...consent,
      });
    const old = await create(1);
    const done = await create(2);
    await w.ok("complete", { jobId: done, output: {} });
    w.db.clock.current += 5 * HOUR;
    const fresh = await create(3);
    w.db.clock.current += HOUR + 1;

    // 公開の口からは呼べない（秘密が要る）
    expect(await w.fail("processing:expire", {}, "u_creator")).toMatchObject({ status: 404 });
    await w.call("processing:expire", {}, "u_creator", BEARER);
    expect(await w.call("processing:get", { jobId: old })).toMatchObject({
      state: "failed",
      error: "処理の期限が切れました",
    });
    expect(await w.call("processing:get", { jobId: done })).toMatchObject({ state: "ready" });
    expect(await w.call("processing:get", { jobId: fresh })).toMatchObject({ state: "queued" });
  });
});

describe("POST /internal/processing（Convex の http.ts と同じ契約）", () => {
  it("秘密が無い・違う・短いなら、関数があることも教えない（404）。合っていれば通る", async () => {
    const w = world();
    expect((await w.gateway("cleanupCandidates", {}, {})).status).toBe(404);
    expect(
      (await w.gateway("cleanupCandidates", {}, { Authorization: "Bearer wrong" })).status,
    ).toBe(404);
    // 利用者の JWT・アップロードの鍵では入れない
    expect((await w.gateway("cleanupCandidates", {}, KEY)).status).toBe(404);
    const res = await w.gateway("cleanupCandidates", {});
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(await res.json()).toEqual([]);

    // 32 文字に満たない秘密は、設定されていても使わせない
    const short = app(fakeDb(), { PROCESSING_SECRET: "too-short-secret-0123456789" });
    const r = await short.request("/internal/processing", {
      method: "POST",
      headers: { Authorization: "Bearer too-short-secret-0123456789" },
      body: JSON.stringify({ operation: "cleanupCandidates" }),
    });
    expect(r.status).toBe(404);
    // 未設定
    const none = app(fakeDb(), {});
    expect(
      (await none.request("/internal/processing", { method: "POST", headers: BEARER, body: "{}" }))
        .status,
    ).toBe(404);
  });

  it("知らない operation・壊れた body は 400。拒否は理由を伏せて 409 processing_rejected。expire は口に出さない", async () => {
    const w = world();
    expect((await w.gateway("nope", {})).status).toBe(400);
    expect((await w.gateway("expire", {})).status).toBe(400);
    expect((await w.gateway("create", {})).status).toBe(400);
    const broken = await w.a.request("/internal/processing", {
      method: "POST",
      headers: BEARER,
      body: "{",
    });
    expect(broken.status).toBe(400);

    const rejected = await w.gateway("inspect", { jobId: "nope" });
    expect(rejected.status).toBe(409);
    expect(await rejected.json()).toEqual({ code: "processing_rejected" });
    // 引数の形が違っても同じ 409（理由は漏らさない）
    expect((await w.gateway("inspect", { jobId: 1 })).status).toBe(409);
    expect((await w.gateway("markCleaned", {})).status).toBe(409);
  });
});
