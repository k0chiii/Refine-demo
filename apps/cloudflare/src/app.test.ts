import { DomainError, orgPermissions } from "@mf100/domain";
import { describe, expect, it } from "vite-plus/test";
import { app, fakeDb, post, signIn, UPLOAD_SECRET, as } from "./testing/http.ts";

async function workInput(a: ReturnType<typeof app>, title = "MF100 パンフレット") {
  return {
    title,
    purpose: "来場者向け案内",
    category: "印刷物",
    mediaType: "pdf",
    year: 100,
    creatorIds: [await signIn(a, "u_creator")],
    approverId: await signIn(a, "u_approver"),
  };
}

async function createWork(a: ReturnType<typeof app>, title?: string): Promise<string> {
  const res = await post(a, "works:create", await workInput(a, title));
  expect(res.status).toBe(200);
  return ((await res.json()) as { value: string }).value;
}

describe("POST /f/:name", () => {
  it("本人が分からなければ 401、知らない名前は 404（body に code）", async () => {
    const a = app();
    const unauthenticated = await post(a, "works:create", {}, null);
    expect(unauthenticated.status).toBe(401);
    expect(await unauthenticated.json()).toMatchObject({ code: "unauthenticated" });

    const unknown = await post(a, "works:noSuchFunction", {});
    expect(unknown.status).toBe(404);
    expect(await unknown.json()).toMatchObject({ code: "function_not_found" });
    // Object.prototype の名前を関数として引けない
    expect((await post(a, "constructor", {})).status).toBe(404);
  });

  it("引数が zod に合わなければ 400（invalid_args と、どの項目が悪いかの issues）。未知の鍵も拒む", async () => {
    const a = app();
    const res = await post(a, "works:create", { title: 1 });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { code: string; details: { issues: { path: string[] }[] } };
    expect(body.code).toBe("invalid_args");
    expect(body.details.issues.map((i) => i.path[0])).toContain("title");

    const extra = await post(a, "works:update", { workId: "w", patch: { id: "other" } });
    expect(extra.status).toBe(400);
    expect(await extra.json()).toMatchObject({ code: "invalid_args" });

    const broken = await a.request("/f/works:create", {
      method: "POST",
      headers: as("u_manager"),
      body: "{",
    });
    expect(broken.status).toBe(400);
  });

  it("mutation は { value } を返し、書いたものは次の呼び出しで読める。空の body は引数なし", async () => {
    const a = app();
    const id = await createWork(a);
    expect(id).toEqual(expect.any(String));

    const og = await post(a, "works:ogSummary", { workId: id }, null);
    expect(await og.json()).toMatchObject({ value: { title: "MF100 パンフレット" } });

    const noBody = await a.request("/f/me:me", { method: "POST", headers: as("u_manager") });
    expect(noBody.status).toBe(200);
  });

  it("DomainError は code と details を body に、状態は code から決める（見えない制作物は存在ごと隠す: forbidden → 403）", async () => {
    const a = app();
    const res = await post(a, "works:update", { workId: "nope", patch: {} }, "stranger");
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ code: "forbidden" });
  });

  it("expectedVersion が合わなければ version_conflict（409）で、書き込みは残らない", async () => {
    const db = fakeDb();
    const a = app(db);
    const id = await createWork(a);
    const res = await post(a, "works:update", {
      workId: id,
      expectedVersion: 99,
      patch: { title: "上書き" },
    });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: "version_conflict" });
    expect(await db.db.works.findById(id)).toMatchObject({ title: "MF100 パンフレット" });
  });

  it("mutation の途中（制作物を書いたあと、監査の記録で）落ちたら、制作物の書き込みも残らず、配る表もない", async () => {
    let armed = false;
    const db = fakeDb((sql) => ({
      exec: (query, ...params) => {
        if (armed && /^\s*INSERT INTO audit/i.test(query))
          throw new DomainError("version_conflict", { injected: true });
        return sql.exec(query, ...params);
      },
    }));
    const a = app(db);
    const id = await createWork(a);
    armed = true;
    db.notified.length = 0;
    const res = await post(a, "works:update", { workId: id, patch: { title: "途中で落ちる" } });
    expect(res.status).toBe(409);
    expect(await db.db.works.findById(id)).toMatchObject({ title: "MF100 パンフレット" });
    expect(db.notified).toEqual([[]]);
  });

  it("成功した mutation は、書いた表の名前を配る（本人の名簿への反映は数えない）", async () => {
    const db = fakeDb();
    const a = app(db);
    await createWork(a);
    expect(db.notified.at(-1)).toContain("works");
    expect(db.notified.at(-1)).not.toContain("users");
  });

  it("query の応答には、読んだ表の名前（reads）が付く。mutation には付かない", async () => {
    const a = app();
    const id = await createWork(a);
    const og = (await (await post(a, "works:ogSummary", { workId: id }, null)).json()) as {
      value: unknown;
      reads: string[];
    };
    expect(og.reads).toContain("works");

    const unread = (await (await post(a, "notifications:unreadCount", {})).json()) as {
      value: number;
      reads: string[];
    };
    expect(unread.value).toBe(0);
    expect(unread.reads).toContain("notifications");

    const pin = await (await post(a, "home:setPinned", { workId: id, pinned: true })).json();
    expect(pin).toEqual({ value: true });
    const pinned = await (await post(a, "home:pinned", { workId: id })).json();
    expect(pinned).toMatchObject({ value: true, reads: expect.arrayContaining(["pins"]) });
  });

  it("Auth: user は JWT 必須、optional は無ければ null、public は誰でも", async () => {
    const a = app();
    expect((await post(a, "notifications:unreadCount", {}, null)).status).toBe(401);
    expect(await (await post(a, "me:me", {}, null)).json()).toMatchObject({ value: null });
    expect((await post(a, "works:ogSummary", { workId: "x" }, null)).status).toBe(200);
  });

  it("本人の特定は subject → users.id。同じ subject は同じ ID、別の subject は別の ID", async () => {
    const a = app();
    const first = await signIn(a, "u_creator");
    expect(await signIn(a, "u_creator")).toBe(first);
    expect(await signIn(a, "u_other")).not.toBe(first);
    expect(first).not.toBe("u_creator");
  });
});

describe("サービス認証（submissions:beginUpload: MF100_UPLOAD_SECRET + 利用者）", () => {
  const key = (secret: string) => ({ "X-MF100-Service-Key": secret });
  const begin = (
    a: ReturnType<typeof app>,
    headers: Record<string, string>,
    subject = "u_manager",
  ) => post(a, "submissions:beginUpload", { itemId: "item" }, subject, headers);

  it("秘密が無い・間違い・未設定・短いなら、その関数ごと 404（利用者の JWT が正しくても）", async () => {
    const a = app();
    expect((await begin(a, {})).status).toBe(404);
    expect((await begin(a, key("wrong"))).status).toBe(404);
    expect((await begin(a, key(UPLOAD_SECRET.slice(0, -1)))).status).toBe(404);
    expect((await begin(app(fakeDb(), {}), key(UPLOAD_SECRET))).status).toBe(404);
    const short = "short-secret";
    expect((await begin(app(fakeDb(), { MF100_UPLOAD_SECRET: short }), key(short))).status).toBe(
      404,
    );
    // ヘッダの場所も合わせる: UPLOAD は Authorization: Bearer では受けない
    expect((await begin(a, { Authorization: `Bearer ${UPLOAD_SECRET}` })).status).toBe(404);
  });

  it("秘密が合っても、利用者の JWT が無ければ 401", async () => {
    const res = await post(
      app(),
      "submissions:beginUpload",
      { itemId: "i" },
      null,
      key(UPLOAD_SECRET),
    );
    expect(res.status).toBe(401);
  });

  it("秘密が合い、利用者も居れば関数まで届く（引数の検証も、use case の判定もそのまま）", async () => {
    const a = app();
    const invalid = await post(a, "submissions:beginUpload", {}, "u_manager", key(UPLOAD_SECRET));
    expect(invalid.status).toBe(400);
    const reached = await begin(a, key(UPLOAD_SECRET));
    // 項目が無いので use case が not_found を返す。境界の 404（function_not_found）とは code で区別できる
    const body = (await reached.json()) as { code: string };
    expect(body.code).toMatch(/_not_found$/);
    expect(body.code).not.toBe("function_not_found");
  });

  it("Bearer の秘密（CLEANUP / PROCESSING）は Authorization ヘッダで受ける。PROCESSING は 32 文字以上", async () => {
    // 登録表にはまだ無いので、境界の部品だけを確かめる
    const { verifyServiceSecret } = await import("./serviceAuth.ts");
    const bearer = (s: string) =>
      new Request("http://x/", { headers: { Authorization: `Bearer ${s}` } });
    const cleanup = "c".repeat(16);
    expect(verifyServiceSecret(bearer(cleanup), "MF100_CLEANUP_SECRET", cleanup)).toBe(true);
    expect(verifyServiceSecret(bearer("d".repeat(16)), "MF100_CLEANUP_SECRET", cleanup)).toBe(
      false,
    );
    const processing = "p".repeat(32);
    expect(verifyServiceSecret(bearer(processing), "PROCESSING_SECRET", processing)).toBe(true);
    expect(verifyServiceSecret(bearer("p".repeat(31)), "PROCESSING_SECRET", "p".repeat(31))).toBe(
      false,
    );
  });

  it("サービス専用の関数は、サービス認証を経ていない呼び出しを Durable Object の中でも 404 にする", async () => {
    const db = fakeDb();
    const result = await db.call(
      "submissions:beginUpload",
      { subject: "u" },
      { itemId: "i" },
      false,
    );
    expect(result).toMatchObject({ ok: false, code: "function_not_found" });
  });
});

describe("組織権限（NOGIKU_ACCESS_ENABLED）", () => {
  const flags = async (a: ReturnType<typeof app>, subject: string) =>
    ((await (await post(a, "me:me", {}, subject)).json()) as { value: Record<string, boolean> })
      .value;
  const save = async (a: ReturnType<typeof app>, subject: string) => {
    const res = await post(a, "groups:save", { name: "校正班", memberIds: [] }, subject);
    return { status: res.status, ...((await res.json()) as { code?: string }) };
  };
  const grant = async (
    db: ReturnType<typeof fakeDb>,
    a: ReturnType<typeof app>,
    s: string,
    p: unknown,
  ) => {
    const id = await signIn(a, s);
    db.sql.exec(
      "UPDATE users SET doc = json_set(doc, '$.orgPermissions', json(?)) WHERE id = ?",
      JSON.stringify(p),
      id,
    );
  };

  it("有効なら users.orgPermissions が主体に載る。空の人は groups:save が forbidden、groups:manage があれば通る", async () => {
    const db = fakeDb(undefined, { NOGIKU_ACCESS_ENABLED: "true" });
    const a = app(db);
    await signIn(a, "u_none"); // orgPermissions の無い行は [] 扱い
    await grant(db, a, "u_empty", []);
    await grant(db, a, "u_manager", [orgPermissions.groupsManage]);

    expect(await save(a, "u_none")).toMatchObject({ status: 403, code: "forbidden" });
    expect(await save(a, "u_empty")).toMatchObject({ status: 403, code: "forbidden" });
    expect((await save(a, "u_manager")).status).toBe(200);

    expect(await flags(a, "u_empty")).toMatchObject({
      canCreateWorks: false,
      canAssignApprovers: false,
      canManageGroups: false,
    });
    expect(await flags(a, "u_manager")).toMatchObject({
      canCreateWorks: false,
      canManageGroups: true,
    });
  });

  it('env が無ければ従来どおり ["*"]（制限なし）', async () => {
    const db = fakeDb();
    const a = app(db);
    await grant(db, a, "u_empty", []);
    expect((await save(a, "u_empty")).status).toBe(200);
    expect(await flags(a, "u_empty")).toMatchObject({
      canCreateWorks: true,
      canAssignApprovers: true,
      canManageGroups: true,
    });
  });
});
