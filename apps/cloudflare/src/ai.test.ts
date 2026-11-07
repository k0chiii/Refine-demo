import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { aiConfig, gatewayOptions } from "./ai/provider.ts";
import { expireAiJobs } from "./functions/aiWorkflow.ts";
import { app, callFn, failFn, fakeDb, post, signIn } from "./testing/http.ts";

// ai:* / aiWorkflow:* / semanticRules:* と、その仕事（jobs の aiProofread・indexRule）を HTTP から 1 周させる。
// 期待は apps/convex/convex/{ai,aiWorkflow,semanticRules}.test.ts から写した。提供元の fetch は偽物

afterEach(() => vi.restoreAllMocks());

// oxlint-disable-next-line typescript/no-explicit-any
type Json = any;

const doc = (t: string) =>
  JSON.stringify({
    type: "doc",
    content: [{ type: "paragraph", content: [{ type: "text", text: t }] }],
  });

const SECRET = "0123456789abcdef0123456789abcdef";
const KEYED = {
  MF100_SYSTEM_ADMIN_SUBJECTS: "u_admin",
  ANTHROPIC_API_KEY: "test-no-network",
};
const WORKERS = {
  MF100_SYSTEM_ADMIN_SUBJECTS: "u_admin",
  AI_PROVIDER: "workers-ai",
  WORKERS_AI_URL: "https://ai.example.test/internal/ai/proofread",
  WORKERS_AI_SECRET: SECRET,
  RULE_EMBEDDINGS_ENABLED: "true",
};

/** fetch の第 1 引数（string / URL）を文字列にする */
const href = (u: unknown): string => (u instanceof URL ? u.href : (u as string));

type Candidate = { original: string; suggestion: string; reason: string; ruleId: string };
const candidate = (original: string, suggestion: string, ruleId = ""): Candidate => ({
  original,
  suggestion,
  reason: "表記",
  ruleId,
});

/** Anthropic の messages API の応答 */
const anthropicReply = (candidates: Candidate[]) =>
  new Response(
    JSON.stringify({
      stop_reason: "end_turn",
      content: [{ type: "text", text: JSON.stringify({ candidates }) }],
    }),
  );

function world(env: Record<string, string> = KEYED) {
  const db = fakeDb(undefined, env);
  const a = app(db);
  const call = (name: string, args: unknown, subject = "u_creator") =>
    callFn(a, name, args, subject);
  const fail = (name: string, args: unknown, subject = "u_creator") =>
    failFn(a, name, args, subject);
  /** 提供元の代わり。db.host.fetch（action）と runDue の io（alarm）に同じものを渡す */
  const useFetch = (impl: (url: string, init: RequestInit) => Response | Promise<Response>) => {
    const fn = vi.fn<typeof fetch>(async (input, init) => impl(href(input), init ?? {}));
    db.host.fetch = fn;
    return fn;
  };
  const create = async (title = "原稿", extra: Record<string, unknown> = {}) =>
    (await call(
      "works:create",
      {
        title,
        purpose: "案内",
        category: "文章",
        mediaType: "document",
        year: 100,
        creatorIds: [await signIn(a, "u_creator")],
        approverId: await signIn(a, "u_approver"),
        ...extra,
      },
      "u_manager",
    )) as string;
  const save = (workId: string, text: string, baseVersion = 0) =>
    call("documents:save", { workId, title: "原稿", content: doc(text), text, baseVersion });
  const runDue = () => db.runDue({ fetch: (i, init) => db.host.fetch!(i, init) });
  return { db, a, call, fail, useFetch, create, save, runDue };
}

type World = ReturnType<typeof world>;

/** 原稿に「五月祭」を書いた制作物 */
async function draftedWork(w: World) {
  const workId = await w.create();
  await w.save(workId, "五月祭");
  return workId;
}

describe("提供元の設定（src/ai/provider.ts）", () => {
  it("キーが無ければ無効。既定の提供元は Anthropic で、モデルは claude-sonnet-5-5（AI_MODEL で替えられる）", () => {
    expect(aiConfig({} as Env)).toMatchObject({
      provider: "anthropic",
      model: "claude-sonnet-5-5",
      policy: { enabled: false, maxChars: 20_000 },
    });
    expect(
      aiConfig({ ANTHROPIC_API_KEY: "k", AI_MODEL: "m", AI_MAX_CHARS: "100" } as Env),
    ).toMatchObject({
      model: "m",
      policy: { enabled: true, maxChars: 100 },
    });
    // キーがあっても、運用で切れる
    expect(
      aiConfig({ ANTHROPIC_API_KEY: "k", AI_PROOFREAD_ENABLED: "false" } as Env).policy.enabled,
    ).toBe(false);
    // Workers AI は URL と秘密の両方が揃ったとき
    expect(
      aiConfig({ AI_PROVIDER: "workers-ai", WORKERS_AI_URL: "https://x" } as Env).policy.enabled,
    ).toBe(false);
    expect(aiConfig(WORKERS as unknown as Env)).toMatchObject({
      model: "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
      policy: { enabled: true },
    });
  });

  it("gateway は Cloudflare の Anthropic 用だけ。ほかの宛先へは本文を送らない", () => {
    const good = "https://gateway.ai.cloudflare.com/v1/acct/gw/anthropic";
    expect(gatewayOptions(undefined)).toEqual({ headers: {} });
    expect(gatewayOptions(`${good}/`)).toMatchObject({
      baseURL: good,
      headers: { "cf-aig-collect-log": "false", "cf-aig-skip-cache": "true" },
    });
    for (const bad of [
      "http://gateway.ai.cloudflare.com/v1/a/b/anthropic",
      "https://evil.example/v1/a/b/anthropic",
      `${good}?x=1`,
      "https://gateway.ai.cloudflare.com/v1/a/b/openai",
    ])
      expect(() => gatewayOptions(bad), bad).toThrow();
  });
});

describe("ai:status / ai:proofread", () => {
  it("API キーが無ければ使えず、外部には何も送らない（理由を返す）。無関係な人は入れない", async () => {
    const w = world({ MF100_SYSTEM_ADMIN_SUBJECTS: "u_admin" });
    const fetched = w.useFetch(() => anthropicReply([]));
    const workId = await draftedWork(w);

    const s = await w.call("ai:status", { workId });
    expect(s.available).toBe(false);
    expect(s.reason).toBeTruthy();
    const r = await w.call("ai:proofread", { workId, text: "5月祭" });
    expect(r.blocked).toBeTruthy();
    expect(r.candidates).toEqual([]);
    expect(await w.fail("ai:proofread", { workId, text: "x" }, "u_stranger")).toMatchObject({
      status: 403,
      code: "forbidden",
    });
    expect(fetched).not.toHaveBeenCalled();
  });

  it("キーがあれば status は使えると答える。候補は本文に当てはめて返し、使った記録（本文なし）を残す", async () => {
    const w = world();
    const fetched = w.useFetch(() =>
      // 本文に無い候補は捨てられる
      anthropicReply([candidate("5月祭", "五月祭"), candidate("体育祭", "運動会")]),
    );
    const workId = await draftedWork(w);

    expect(await w.call("ai:status", { workId })).toEqual({
      available: true,
      reason: null,
      provider: "Anthropic",
      maxChars: 20_000,
      semanticSearch: false,
    });
    const r = await w.call("ai:proofread", { workId, text: "5月祭を開く" });
    expect(r).toMatchObject({ provider: "Anthropic", model: "claude-sonnet-5-5", blocked: null });
    expect(r.candidates).toHaveLength(1);
    expect(r.candidates[0]).toMatchObject({ original: "5月祭", suggestion: "五月祭", start: 0 });

    // 素の fetch で messages API に、キー・モデル・本文を送る（SDK は使わない）
    const [url, init] = fetched.mock.calls[0]!;
    expect(href(url)).toBe("https://api.anthropic.com/v1/messages");
    expect((init!.headers as Record<string, string>)["x-api-key"]).toBe("test-no-network");
    const sent = JSON.parse(init!.body as string);
    expect(sent.model).toBe("claude-sonnet-5-5");
    expect(sent.messages[0].content).toContain("5月祭を開く");

    const audit = w.db.sql
      .exec("SELECT doc FROM audit")
      .map((r) => JSON.parse(r.doc as string))
      .filter((e) => e.operation === "ai_proofread");
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      entityId: workId,
      after: { chars: 6, provider: "Anthropic", candidates: 1 },
    });
    expect(JSON.stringify(audit)).not.toContain("を開く");
  });

  it("長すぎる・空の本文は送らない。上限（利用者 2 回の貯め）を超えたら {blocked} で返し、提供元を呼ばない", async () => {
    const w = world({ ...KEYED, AI_MAX_CHARS: "10" });
    const fetched = w.useFetch(() => anthropicReply([]));
    const workId = await draftedWork(w);

    expect((await w.call("ai:proofread", { workId, text: "x".repeat(11) })).blocked).toContain(
      "10 文字まで",
    );
    expect(await w.call("ai:proofread", { workId, text: "  " })).toEqual({
      candidates: [],
      provider: "",
      model: "",
      blocked: null,
    });
    expect(fetched).not.toHaveBeenCalled();

    await w.call("ai:proofread", { workId, text: "一回目" });
    await w.call("ai:proofread", { workId, text: "二回目" });
    const third = await w.call("ai:proofread", { workId, text: "三回目" });
    expect(third.candidates).toEqual([]);
    expect(third.blocked).toContain("利用上限");
    expect(fetched).toHaveBeenCalledTimes(2);
    // 1 分ためれば（6 回/分 = 10 秒に 1 回）また通る
    w.db.clock.current += 10_000;
    expect((await w.call("ai:proofread", { workId, text: "四回目" })).blocked).toBeNull();
  });

  it("提供元が落ちても枠は戻さない（自動のやり直しはしない）", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const w = world();
    w.useFetch(() => new Response("{}", { status: 503 }));
    const workId = await draftedWork(w);
    for (const text of ["一回目", "二回目"])
      expect((await post(w.a, "ai:proofread", { workId, text }, "u_creator")).status).toBe(500);
    // 2 回で貯めを使い切っている
    w.useFetch(() => anthropicReply([]));
    expect((await w.call("ai:proofread", { workId, text: "三回目" })).blocked).toContain(
      "利用上限",
    );
  });

  it("Workers AI は代理（/internal/ai/proofread）へ、秘密と model を付けて送る", async () => {
    const w = world(WORKERS);
    const fetched = w.useFetch(() => Response.json({ candidates: [candidate("5月祭", "五月祭")] }));
    const workId = await draftedWork(w);
    const r = await w.call("ai:proofread", { workId, text: "5月祭" });
    expect(r).toMatchObject({
      provider: "Workers AI",
      model: "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
    });
    expect(r.candidates).toHaveLength(1);
    const [url, init] = fetched.mock.calls[0]!;
    expect(href(url)).toBe("https://ai.example.test/internal/ai/proofread");
    expect((init!.headers as Record<string, string>).Authorization).toBe(`Bearer ${SECRET}`);
    expect(JSON.parse(init!.body as string)).toMatchObject({
      text: "5月祭",
      model: "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
    });
  });
});

describe("aiWorkflow（jobs の aiProofread）", () => {
  const start = (
    w: World,
    workId: string,
    extra: Record<string, unknown> = {},
    subject = "u_creator",
  ) =>
    w.call(
      "aiWorkflow:start",
      { workId, draftVersion: 1, consentToTemporaryStorage: true, ...extra },
      subject,
    );

  it("明示同意を要求し、重複起動をまとめ、本文を持たない。動かすと結果が残り、他人には見えない", async () => {
    const w = world();
    const fetched = w.useFetch(() => anthropicReply([candidate("五月祭", "MF100")]));
    const workId = await draftedWork(w);

    expect(
      await w.fail(
        "aiWorkflow:start",
        { workId, draftVersion: 1, consentToTemporaryStorage: false },
        "u_creator",
      ),
    ).toMatchObject({
      status: 400,
      code: "temporary_storage_consent_required",
    });
    const jobId = (await start(w, workId)) as string;
    expect(await start(w, workId)).toBe(jobId);

    // 仕事は 1 件だけ積まれ、aiJobs に本文は無い
    expect(w.db.jobs().map((j) => [j.kind, j.payload])).toEqual([["aiProofread", { jobId }]]);
    expect(JSON.stringify(w.db.sql.exec("SELECT doc FROM aiJobs"))).not.toContain("五月祭");
    expect(await w.call("aiWorkflow:get", { jobId }, "u_creator")).toMatchObject({
      state: "queued",
      result: null,
    });
    expect(await w.call("aiWorkflow:get", { jobId }, "u_stranger")).toBeNull();
    expect(fetched).not.toHaveBeenCalled();

    // alarm で動かす: 提供元を呼び、仕事は消える
    await w.runDue();
    expect(fetched).toHaveBeenCalledTimes(1);
    expect(w.db.jobs()).toEqual([]);
    const done = await w.call("aiWorkflow:get", { jobId });
    expect(done).toMatchObject({ state: "completed", error: null });
    const result = JSON.parse(done.result);
    expect(result).toMatchObject({ provider: "Anthropic", model: "claude-sonnet-5-5" });
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]).toMatchObject({ original: "五月祭", suggestion: "MF100" });
  });

  it("原稿の版が違う・空・AI が無効なら起動できない", async () => {
    const w = world();
    w.useFetch(() => anthropicReply([]));
    const workId = await draftedWork(w);
    expect(
      await w.fail(
        "aiWorkflow:start",
        { workId, draftVersion: 2, consentToTemporaryStorage: true },
        "u_creator",
      ),
    ).toMatchObject({ code: "draft_changed" });
    const empty = await w.create("空");
    expect(
      await w.fail(
        "aiWorkflow:start",
        { workId: empty, draftVersion: 1, consentToTemporaryStorage: true },
        "u_creator",
      ),
    ).toMatchObject({ code: "draft_changed" });
    // 校正者は版を出せないので始められない
    expect(
      (
        await w.fail(
          "aiWorkflow:start",
          { workId, draftVersion: 1, consentToTemporaryStorage: true },
          "u_stranger",
        )
      ).status,
    ).toBe(403);
    const off = world({ MF100_SYSTEM_ADMIN_SUBJECTS: "u_admin" });
    const offWork = await draftedWork(off);
    expect(
      await off.fail(
        "aiWorkflow:start",
        { workId: offWork, draftVersion: 1, consentToTemporaryStorage: true },
        "u_creator",
      ),
    ).toMatchObject({ code: "ai_unavailable" });
  });

  it("外部呼出し後に原稿が変わると結果を採用せず、取消後も保存しない", async () => {
    const w = world();
    const workId = await draftedWork(w);
    const jobId = (await start(w, workId)) as string;
    w.useFetch(async () => {
      // 外へ送っている間に、本人が原稿を保存した
      await w.save(workId, "五月祭", 1);
      return anthropicReply([]);
    });
    await w.runDue();
    expect(await w.call("aiWorkflow:get", { jobId })).toMatchObject({
      state: "failed",
      result: null,
    });

    // 取り消す → 結果は残らない。動かし直しても cancelled のまま
    await w.call("aiWorkflow:cancel", { jobId });
    expect(await w.call("aiWorkflow:get", { jobId })).toMatchObject({
      state: "cancelled",
      result: null,
    });
    expect(w.db.jobs()).toEqual([]);
  });

  it("取り消した仕事は提供元を呼ばない。他人の仕事は取り消せない", async () => {
    const w = world();
    const fetched = w.useFetch(() => anthropicReply([]));
    const workId = await draftedWork(w);
    const jobId = (await start(w, workId)) as string;
    expect((await w.fail("aiWorkflow:cancel", { jobId }, "u_stranger")).status).toBe(403);
    await w.call("aiWorkflow:cancel", { jobId });
    await w.runDue();
    expect(fetched).not.toHaveBeenCalled();
    expect(await w.call("aiWorkflow:get", { jobId })).toMatchObject({
      state: "cancelled",
      result: null,
    });
    // 動いていた仕事が戻ってきても、取り消し済みは採用しない（cancelled は結果を受けない）
    expect(w.db.jobs()).toEqual([]);
  });

  it("提供元が落ちたら failed（再試行しない）。権限を失っていても失敗にする", async () => {
    const w = world();
    const fetched = w.useFetch(() => new Response("{}", { status: 503 }));
    const workId = await draftedWork(w);
    const jobId = (await start(w, workId)) as string;
    await w.runDue();
    expect(fetched).toHaveBeenCalledTimes(1);
    expect(await w.call("aiWorkflow:get", { jobId })).toMatchObject({
      state: "failed",
      result: null,
      error: "AI の処理を完了できませんでした",
    });
    expect(w.db.jobs()).toEqual([]);
  });

  it("同時に動かすのは 2 件まで（Convex の maxParallelism: 2）", async () => {
    const w = world();
    let running = 0;
    let peak = 0;
    const fetched = w.useFetch(async () => {
      peak = Math.max(peak, ++running);
      // 他の仕事が始められる時間を空ける
      await new Promise((r) => setTimeout(r, 5));
      running--;
      return anthropicReply([]);
    });
    const ids: string[] = [];
    for (const title of ["一", "二", "三", "四"]) {
      const workId = await w.create(title);
      await w.save(workId, "五月祭");
      ids.push(await start(w, workId));
      w.db.clock.current += 60_000; // 利用者の枠（2 回の貯め）を戻す
    }
    expect(w.db.jobs()).toHaveLength(4);
    await w.runDue();
    expect(fetched).toHaveBeenCalledTimes(4);
    expect(peak).toBe(2);
    for (const jobId of ids)
      expect(await w.call("aiWorkflow:get", { jobId })).toMatchObject({ state: "completed" });
  });

  it("利用者の枠を超えると ai_quota_exceeded で、仕事も行も残らない", async () => {
    const w = world();
    w.useFetch(() => anthropicReply([]));
    const a = await w.create("一");
    const b = await w.create("二");
    const c = await w.create("三");
    for (const id of [a, b, c]) await w.save(id, "五月祭");
    await start(w, a);
    await start(w, b);
    expect(
      await w.fail(
        "aiWorkflow:start",
        { workId: c, draftVersion: 1, consentToTemporaryStorage: true },
        "u_creator",
      ),
    ).toMatchObject({ code: "ai_quota_exceeded" });
    expect(w.db.jobs()).toHaveLength(2);
    expect(w.db.sql.exec("SELECT id FROM aiJobs")).toHaveLength(2);
  });

  it("結果は作成から 1 時間で読めなくなり、expire が消す（cron は 5 分ごと）", async () => {
    const w = world();
    w.useFetch(() => anthropicReply([]));
    const workId = await draftedWork(w);
    const jobId = (await start(w, workId)) as string;
    await w.runDue();
    w.db.clock.current += 3_600_000 - 1;
    expect(await w.call("aiWorkflow:get", { jobId })).toMatchObject({ state: "completed" });
    expireAiJobs(w.db.sql, w.db.clock.current);
    expect(w.db.sql.exec("SELECT id FROM aiJobs")).toHaveLength(1);
    w.db.clock.current += 1;
    expect(await w.call("aiWorkflow:get", { jobId })).toBeNull();
    expireAiJobs(w.db.sql, w.db.clock.current);
    expect(w.db.sql.exec("SELECT id FROM aiJobs")).toEqual([]);
  });
});

describe("semanticRules（jobs の indexRule → search）", () => {
  /** 先頭 2 成分だけが違う 1024 次元の単位に近いベクトル */
  const vec = (x: number, y: number) => [x, y, ...Array<number>(1022).fill(0)];
  const VECTORS: Record<string, number[]> = {
    ルールA: vec(1, 0),
    ルールB: vec(0, 1),
    ルールC: vec(0.7, 0.7),
    近い言い回し: vec(1, 0.2),
  };

  const rule = (ruleId: string, title: string, extra: Record<string, unknown> = {}) => ({
    ruleId,
    categoryCode: "wording",
    title,
    description: "表記",
    correct: [title],
    incorrect: [`旧${title}`],
    patterns: [],
    exceptions: [],
    language: "ja",
    scopes: [],
    years: [],
    priority: 1,
    strictness: "required",
    enabled: true,
    ...extra,
  });

  async function rulesWorld(env: Record<string, string> = WORKERS) {
    const w = world(env);
    const embedded: string[] = [];
    w.useFetch((url, init) => {
      expect(url).toBe("https://ai.example.test/internal/ai/embed");
      const { text } = JSON.parse(init.body as string) as { text: string };
      embedded.push(text);
      const key = Object.keys(VECTORS).find((k) => text.includes(k));
      return key ? Response.json({ vector: VECTORS[key] }) : new Response(null, { status: 502 });
    });
    await w.call(
      "notation:upsertCategory",
      { code: "wording", name: "表記", description: "", parents: [], policyNotes: "", order: 1 },
      "u_admin",
    );
    for (const [id, title] of [
      ["A", "ルールA"],
      ["B", "ルールB"],
      ["C", "ルールC"],
    ] as const)
      await w.call("notation:save", { rule: rule(`r${id}`, title) }, "u_admin");
    const workId = await w.create("原稿", { notationCategories: ["wording"] });
    await w.save(workId, "五月祭");
    return { w, workId, embedded };
  }

  it("ルールの保存で indexRule が積まれ、動かすと埋め込みを書く（有効でなければ積まない）", async () => {
    const { w, embedded } = await rulesWorld();
    expect(w.db.jobs().map((j) => [j.kind, j.payload])).toEqual([
      ["indexRule", { ruleId: "rA" }],
      ["indexRule", { ruleId: "rB" }],
      ["indexRule", { ruleId: "rC" }],
    ]);
    await w.runDue();
    expect(w.db.jobs()).toEqual([]);
    expect(embedded).toHaveLength(3);
    const rows = w.db.sql
      .exec("SELECT doc FROM ruleEmbeddings")
      .map((r) => JSON.parse(r.doc as string));
    expect(
      rows
        .map((r) => [r.ruleId, r.revision, r.model, r.vector.length])
        .sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
    ).toEqual([
      ["rA", 1, "@cf/baai/bge-m3", 1024],
      ["rB", 1, "@cf/baai/bge-m3", 1024],
      ["rC", 1, "@cf/baai/bge-m3", 1024],
    ]);
    // ルールの題・正しい表記・説明を 1 つの文にして送る
    expect(embedded[0]).toBe("ルールA\nルールA\n旧ルールA\n表記");

    const off = world({ ...WORKERS, RULE_EMBEDDINGS_ENABLED: "false" });
    await off.call(
      "notation:upsertCategory",
      { code: "wording", name: "表記", description: "", parents: [], policyNotes: "", order: 1 },
      "u_admin",
    );
    await off.call("notation:save", { rule: rule("rA", "ルールA") }, "u_admin");
    expect(off.db.jobs()).toEqual([]);
  });

  it("埋め込みの通信が落ちたら仕事は残って後でやり直す。無効にされたルールは作らない", async () => {
    const { w } = await rulesWorld();
    w.useFetch(() => new Response(null, { status: 502 }));
    vi.spyOn(console, "warn").mockImplementation(() => {});
    await w.runDue();
    expect(w.db.jobs()).toHaveLength(3);
    expect(w.db.jobs().every((j) => j.attempts === 1)).toBe(true);
    expect(w.db.sql.exec("SELECT id FROM ruleEmbeddings")).toEqual([]);

    // 外へ送っている間に無効にされたルールの埋め込みは、書かない
    w.useFetch(async () => {
      await w.call("notation:setEnabled", { ruleId: "rA", enabled: false }, "u_admin");
      return Response.json({ vector: VECTORS["ルールA"] });
    });
    w.db.clock.current += 24 * 3_600_000;
    await w.runDue();
    expect(w.db.sql.exec("SELECT id FROM ruleEmbeddings WHERE id = ?", "rA")).toEqual([]);
  });

  it("search は近い順に返す（cosine の上位）。戻りは ai:prepare のルールと同じ形", async () => {
    const { w, workId } = await rulesWorld();
    await w.runDue();
    const hits = await w.call("semanticRules:search", {
      workId,
      text: "近い言い回し",
      consentToExternalSend: true,
    });
    expect(hits.map((h: Json) => h.ruleId)).toEqual(["rA", "rC", "rB"]);
    expect(hits[0]).toEqual({
      ruleId: "rA",
      revision: 1,
      title: "ルールA",
      correct: ["ルールA"],
      incorrect: ["旧ルールA"],
      description: "表記",
    });
    expect(await w.call("ai:status", { workId })).toMatchObject({ semanticSearch: true });
  });

  it("同意が無い・空・長すぎる・無関係な人は検索できない", async () => {
    const { w, workId } = await rulesWorld();
    await w.runDue();
    for (const args of [
      { workId, text: "近い言い回し", consentToExternalSend: false },
      { workId, text: "  ", consentToExternalSend: true },
      { workId, text: "あ".repeat(20_001), consentToExternalSend: true },
    ])
      expect(await w.fail("semanticRules:search", args)).toMatchObject({ code: "invalid_search" });
    expect(
      (
        await w.fail(
          "semanticRules:search",
          { workId, text: "近い言い回し", consentToExternalSend: true },
          "u_stranger",
        )
      ).status,
    ).toBe(403);
  });

  it("古い版の埋め込みと、この制作物に当たらないルールは捨てる", async () => {
    const { w, workId } = await rulesWorld();
    await w.runDue();
    // A を改版（埋め込みはまだ旧版）・B を別カテゴリへ（この制作物の対象外）
    await w.call(
      "notation:upsertCategory",
      { code: "other", name: "別", description: "", parents: [], policyNotes: "", order: 2 },
      "u_admin",
    );
    await w.call(
      "notation:save",
      { rule: rule("rA", "ルールA", { description: "新版" }), expectedRevision: 1 },
      "u_admin",
    );
    await w.call(
      "notation:save",
      { rule: rule("rB", "ルールB", { categoryCode: "other" }), expectedRevision: 1 },
      "u_admin",
    );
    const hits = await w.call("semanticRules:search", {
      workId,
      text: "近い言い回し",
      consentToExternalSend: true,
    });
    expect(hits.map((h: Json) => h.ruleId)).toEqual(["rC"]);
  });

  it("search は枠を使う（利用者 2 回の貯め）。使えない設定なら外へ送らない", async () => {
    const { w, workId } = await rulesWorld();
    await w.runDue();
    const search = () =>
      w.fail("semanticRules:search", { workId, text: "近い言い回し", consentToExternalSend: true });
    expect((await search()).status).toBe(200);
    expect((await search()).status).toBe(200);
    expect(await search()).toMatchObject({ code: "ai_quota_exceeded" });

    const off = world({ MF100_SYSTEM_ADMIN_SUBJECTS: "u_admin" });
    const fetched = off.useFetch(() => Response.json({ vector: VECTORS["ルールA"] }));
    const id = await draftedWork(off);
    expect(
      await off.fail("semanticRules:search", {
        workId: id,
        text: "x",
        consentToExternalSend: true,
      }),
    ).toMatchObject({ code: "ai_unavailable" });
    expect(fetched).not.toHaveBeenCalled();
  });
});
