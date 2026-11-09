import { z } from "zod";
import { describe, expect, it } from "vite-plus/test";
import { functions, modules } from "./functions/index.ts";
import { app, callFn, failFn, fakeDb, post, signIn, UPLOAD_SECRET } from "./testing/http.ts";

// 動的 import の変数展開は Vite の変換時の一覧に縛られる（後から足したファイルを知らない）。eager な glob なら同じ時点で揃う
const files = import.meta.glob("./functions/*.ts", { eager: true }) as Record<string, unknown>;

describe("登録表の形（全関数）", () => {
  const all = Object.entries(functions);

  it("名前は <module>:<name> で、module は functions/<module>.ts と同名のファイルが同名で出している", async () => {
    for (const [name, def] of all) {
      const [module = "", fn = "", ...rest] = name.split(":");
      expect(rest, name).toEqual([]);
      expect(module, name).toMatch(/^[a-zA-Z]+$/);
      expect(fn, name).toMatch(/^[a-zA-Z]+$/);
      // ファイルが無ければ glob に無い。出している名前も module と同じ（index の modules の鍵）
      const file = files[`./functions/${module}.ts`] as Record<string, unknown> | undefined;
      expect(file, name).toBeDefined();
      if (!file) continue;
      expect(Object.keys((file[module] as object | undefined) ?? {}), name).toContain(name);
      expect(file[module], name).toBe(modules[module as keyof typeof modules]);
      expect(["query", "mutation", "action"], name).toContain(def.kind);
    }
    // 同じ名前を 2 か所で登録していない（Object.assign が黙って上書きする）
    const registered = Object.values(modules).reduce((n, m) => n + Object.keys(m).length, 0);
    expect(registered).toBe(all.length);
  });

  it("args は未知の鍵を拒む（入れ子の object も。patch に id を紛れ込ませる穴を塞ぐ）", () => {
    // z.record は additionalProperties に値の型を持つ（properties が無い）ので数えない。名前の付いた鍵を持つ object だけが対象
    const open: string[] = [];
    const walk = (node: unknown, at: string): void => {
      if (!node || typeof node !== "object") return;
      const n = node as Record<string, unknown>;
      if (n.properties && n.additionalProperties !== false) open.push(at);
      for (const [k, v] of Object.entries(n))
        if (Array.isArray(v)) v.forEach((x, i) => walk(x, `${at}.${k}[${i}]`));
        else walk(v, `${at}.${k}`);
    };
    for (const [name, def] of all)
      walk(z.toJSONSchema(def.args, { io: "input", unrepresentable: "any" }), name);
    expect(open).toEqual([]);

    for (const [name, def] of all) {
      // 引数が要らない関数は {} が通る。そこへ未知の鍵を足すと落ちる
      if (def.args.safeParse({}).success)
        expect(def.args.safeParse({ __extra: 1 }).success, name).toBe(false);
    }
  });

  it("サービス専用は Convex の internal だった upload 系・processing・清掃だけ（公開の口に出さない）", () => {
    const service = all.filter(([, d]) => typeof d.auth === "object").map(([n]) => n);
    expect(service.sort()).toEqual([
      "commentFiles:beginFileUpload",
      "commentFiles:beginThumbUpload",
      "commentFiles:completeFileUpload",
      "commentFiles:completeThumbUpload",
      "commentFiles:failFileUpload",
      "processing:cleanupCandidates",
      "processing:complete",
      "processing:expire",
      "processing:fail",
      "processing:figmaComplete",
      "processing:inspect",
      "processing:markCleaned",
      "processing:streamSession",
      "submissions:beginUpload",
      "submissions:completeUpload",
      "submissions:failUpload",
      "submissions:listOrphanObjects",
      "submissions:markObjectsPurged",
      "submissions:resumeUpload",
    ]);
  });
});

// ------------------------------------------------------------------ 薄い包みを HTTP から 1 周させる

const HOUR = 3_600_000;
const NOW = Date.UTC(2026, 10, 1);

function world() {
  const a = app(fakeDb(undefined, { MF100_SYSTEM_ADMIN_SUBJECTS: "u_admin" }));
  return {
    a,
    call: (
      name: string,
      args: unknown,
      subject = "u_manager",
      headers: Record<string, string> = {},
    ) => callFn(a, name, args, subject, headers),
    fail: (name: string, args: unknown, subject = "u_manager") => failFn(a, name, args, subject),
  };
}

type World = ReturnType<typeof world>;

/** 版の提出の準備から実体の検証完了まで（実体の転送は Worker 専用: サービスの鍵 + 利用者の JWT） */
async function uploadedSession(w: World, workId: string) {
  const prepared = await w.call(
    "submissions:prepare",
    {
      workId,
      kind: "standard",
      reviewType: "general",
      deadlineAt: NOW + 48 * HOUR,
      changeSummary: "初版",
      focusNotes: "",
      items: [{ fileName: "a.pdf", mimeType: "application/pdf", type: "pdf", role: "source" }],
    },
    "u_creator",
  );
  const key = { "X-MF100-Service-Key": UPLOAD_SECRET };
  const itemId = prepared.items[0].id;
  const begun = await w.call("submissions:beginUpload", { itemId }, "u_creator", key);
  await w.call(
    "submissions:completeUpload",
    { attemptId: begun.attemptId, size: 10, sha256: "abc" },
    "u_creator",
    key,
  );
  return prepared as { sessionId: string; items: { id: string }[] };
}

/** 制作物を登録して（進行中・校正者 1 人）、版を 1 つ提出する */
async function submittedRevision(w: World) {
  const workId: string = await w.call("works:create", {
    title: "ポスター",
    purpose: "告知",
    category: "印刷物",
    mediaType: "pdf",
    year: 100,
    creatorIds: [await signIn(w.a, "u_creator")],
    approverId: await signIn(w.a, "u_approver"),
    reviewerIds: [await signIn(w.a, "u_reviewer")],
    activate: true,
  });
  const prepared = await uploadedSession(w, workId);
  const confirmed = await w.call(
    "submissions:confirm",
    { sessionId: prepared.sessionId },
    "u_creator",
  );
  return { workId, revisionId: confirmed.revisionId as string };
}

describe("POST /f/:name の一周（use case の薄い包み）", () => {
  it("works:create → submissions:prepare → beginUpload → completeUpload → confirm（版の提出）→ revisions:markViewed", async () => {
    const w = world();
    const { a, call } = w;
    const workId: string = await call("works:create", {
      title: "ポスター",
      purpose: "告知",
      category: "印刷物",
      mediaType: "pdf",
      year: 100,
      creatorIds: [await signIn(a, "u_creator")],
      approverId: await signIn(a, "u_approver"),
      reviewerIds: [await signIn(a, "u_reviewer")],
      activate: true,
    });
    const prepared = await call(
      "submissions:prepare",
      {
        workId,
        kind: "standard",
        reviewType: "general",
        deadlineAt: NOW + 48 * HOUR,
        changeSummary: "初版",
        focusNotes: "",
        items: [{ fileName: "a.pdf", mimeType: "application/pdf", type: "pdf", role: "source" }],
      },
      "u_creator",
    );
    expect(prepared.items).toHaveLength(1);

    // 実体の転送は Worker 専用: サービスの鍵 + 利用者の JWT。鍵が無ければ関数ごと 404
    const key = { "X-MF100-Service-Key": UPLOAD_SECRET };
    const itemId = prepared.items[0].id;
    expect((await post(a, "submissions:beginUpload", { itemId }, "u_creator")).status).toBe(404);
    const begun = await call("submissions:beginUpload", { itemId }, "u_creator", key);
    expect(begun.attemptId).toEqual(expect.any(String));
    const done = await call(
      "submissions:completeUpload",
      { attemptId: begun.attemptId, size: 10, sha256: "abc" },
      "u_creator",
      key,
    );
    expect(done).toEqual({ status: "verified", failureMessage: null });

    const confirmed = await call(
      "submissions:confirm",
      { sessionId: prepared.sessionId },
      "u_creator",
    );
    expect(confirmed).toMatchObject({ sequence: 1, kind: "standard" });
    expect(
      await call("revisions:markViewed", { revisionId: confirmed.revisionId }, "u_reviewer"),
    ).toBe(null);
  });

  it("comments:post → reply → toggleReaction → markRead → edit → remove（戻りは Convex と同じ形: id / null / 集計）", async () => {
    const w = world();
    const { revisionId } = await submittedRevision(w);
    const threadId = await w.call(
      "comments:post",
      { revisionId, body: "誤字です", kind: "correction", severity: "minor" },
      "u_reviewer",
    );
    expect(threadId).toEqual(expect.any(String));
    expect(await w.call("comments:reply", { threadId, body: "直します" }, "u_creator")).toBeNull();
    const reaction = await w.call(
      "comments:toggleReaction",
      { threadId, emoji: "👍" },
      "u_creator",
    );
    expect(JSON.stringify(reaction)).toContain("👍");
    expect(await w.call("comments:markRead", { threadId }, "u_creator")).toBeNull();
    expect(
      await w.call("comments:edit", { threadId, body: "誤字です（訂正）" }, "u_reviewer"),
    ).toBeNull();
    expect(await w.call("comments:remove", { threadId }, "u_reviewer")).toBeNull();
    // 位置の形は zod が見る（未知の type は 400）
    const bad = await w.fail("comments:post", {
      revisionId,
      body: "x",
      kind: "correction",
      severity: "minor",
      anchor: { type: "nope" },
    });
    expect(bad).toMatchObject({ status: 400, code: "invalid_args" });
  });

  it("checks:add → checks:complete（専門確認の戻りは id と状態）", async () => {
    const w = world();
    const { revisionId } = await submittedRevision(w);
    const checkId = await w.call("checks:add", { revisionId, type: "name" });
    expect(checkId).toEqual(expect.any(String));
    expect(await w.call("checks:complete", { checkId, note: "確認した" })).toBe("done");
  });

  it("acl:grant → acl:revoke（管理者だけ）", async () => {
    const w = world();
    const { workId } = await submittedRevision(w);
    const viewer = await signIn(w.a, "u_viewer");
    expect(
      await w.fail("acl:grant", { workId, userIds: [viewer], permission: "review" }, "u_manager"),
    ).toMatchObject({ code: "acl_requires_system_admin" });
    expect(
      await w.call("acl:grant", { workId, userIds: [viewer], permission: "review" }, "u_admin"),
    ).toBeNull();
    await w.call("acl:revoke", { workId, userId: viewer }, "u_admin");
  });

  it("teams:save → list → remove / groups:save → list → remove（管理者の組織）", async () => {
    const w = world();
    const member = await signIn(w.a, "u_member");
    const bureau = await w.call(
      "teams:save",
      { name: "制作局", kind: "bureau", code: "SSK" },
      "u_admin",
    );
    const team = await w.call(
      "teams:save",
      { name: "広報", kind: "team", parentId: bureau, memberIds: [member] },
      "u_admin",
    );
    expect(
      (await w.call("teams:list", {}, "u_member")).map((t: { name: string }) => t.name),
    ).toEqual(expect.arrayContaining(["制作局", "広報"]));
    // 配下の担当があるうちは局を消せない
    expect(await w.fail("teams:remove", { id: bureau }, "u_admin")).toMatchObject({
      code: "team_in_use",
    });
    expect(await w.call("teams:remove", { id: team }, "u_admin")).toBeNull();
    expect(await w.call("teams:remove", { id: bureau }, "u_admin")).toBeNull();

    const groupId = await w.call("groups:save", { name: "校正班", memberIds: [member] }, "u_admin");
    expect(await w.call("groups:list", {}, "u_member")).toHaveLength(1);
    expect(await w.call("groups:remove", { id: groupId }, "u_admin")).toBeNull();
  });

  it("notation:upsertCategory → save → rulesForWork / categories", async () => {
    const w = world();
    expect(
      await w.call(
        "notation:upsertCategory",
        { code: "wording", name: "表記", description: "", parents: [], policyNotes: "", order: 1 },
        "u_admin",
      ),
    ).toBeNull();
    await w.call(
      "notation:save",
      {
        rule: {
          ruleId: "r1",
          categoryCode: "wording",
          title: "半角英数",
          description: "",
          correct: ["MF100"],
          incorrect: ["ＭＦ１００"],
          patterns: [],
          exceptions: [],
          language: "ja",
          scopes: [],
          years: [],
          priority: 1,
          strictness: "required",
          enabled: true,
        },
      },
      "u_admin",
    );
    expect(JSON.stringify(await w.call("notation:categories", {}, "u_manager"))).toContain(
      "wording",
    );
  });

  it("push:subscribe → status → unsubscribe", async () => {
    const w = world();
    const sub = {
      endpoint: "https://fcm.googleapis.com/fcm/send/device-1",
      p256dh: `B${"A".repeat(86)}`,
      auth: "A".repeat(22),
    };
    expect(await w.call("push:status", { endpoint: sub.endpoint })).toBe(false);
    expect(await w.call("push:subscribe", sub)).toBeNull();
    expect(await w.call("push:status", { endpoint: sub.endpoint })).toBe(true);
    await w.call("push:unsubscribe", { endpoint: sub.endpoint });
    expect(await w.call("push:status", { endpoint: sub.endpoint })).toBe(false);
  });

  it("social / slackWorkspaces: 管理者が登録し、誰でも一覧を読める", async () => {
    const w = world();
    const id = await w.call(
      "social:save",
      { platform: "x", displayName: "MF100", username: "mf100", verified: false },
      "u_admin",
    );
    expect(await w.call("social:list", {}, "u_member")).toHaveLength(1);
    expect(await w.call("social:remove", { id }, "u_admin")).toBeNull();
    const ws = await w.call(
      "slackWorkspaces:add",
      { name: "実行委員会", teamId: "t0123" },
      "u_admin",
    );
    expect(ws.teamId).toBe("T0123");
    expect(await w.call("slackWorkspaces:list", {}, "u_member")).toHaveLength(1);
    expect(await w.call("slackWorkspaces:remove", { id: ws.id }, "u_admin")).toBeNull();
  });

  it("notificationPrefs:update → get、notifications:sendTest → list → markAllRead（戻りは件数）", async () => {
    const w = world();
    const updated = await w.call("notificationPrefs:update", { showPreview: false });
    expect(updated.showPreview).toBe(false);
    expect((await w.call("notificationPrefs:get", {})).prefs?.showPreview ?? false).toBe(false);
    expect(await w.call("notifications:sendTest", {})).toBeNull();
    expect(await w.call("notifications:list", {})).toHaveLength(1);
    expect(await w.call("notifications:unreadCount", {})).toBe(1);
    expect(await w.call("notifications:markAllRead", {})).toBe(1);
    expect(await w.call("notifications:unreadCount", {})).toBe(0);
  });

  it("dashboard:works / works:changeLifecycle / admin:workStats", async () => {
    const w = world();
    const { workId } = await submittedRevision(w);
    expect(await w.call("dashboard:works", {}, "u_creator")).toEqual(expect.any(Object));
    expect(await w.call("dashboard:check", {}, "u_reviewer")).toEqual(expect.any(Object));
    expect(await w.call("dashboard:make", {}, "u_creator")).toEqual(expect.any(Object));
    expect(await w.call("works:changeLifecycle", { workId, to: "cancelled" })).toBeNull();
    expect(await w.call("admin:workStats", {}, "u_admin")).toHaveLength(1);
    expect(await w.fail("admin:workStats", {}, "u_member")).toMatchObject({ status: 403 });
  });
});
