import { describe, expect, it } from "vite-plus/test";
import { principals } from "@mf100/application/testing";
import { createApp } from "./app.ts";
import { devIdentifier } from "./identity.ts";
import type { usecases } from "./registry.ts";
import { runUsecase, settle } from "./run.ts";
import { createInMemoryContext, nodeSql } from "./testing/context.ts";

/**
 * Durable Object の代わり: 同じ SQLite のアダプタを Node の中で直に包む。
 * 1 呼び出し = 1 トランザクションは SAVEPOINT で真似る（DO では storage.transaction）
 */
function fakeDb() {
  const sql = nodeSql();
  const ctx = createInMemoryContext(undefined, sql);
  const deps = { adminSubjects: new Set<string>(), upsertUser: async () => {} };
  return {
    ctx,
    run: (identity: { subject: string }, name: string, args: unknown[]) =>
      settle(async () => {
        sql.exec("SAVEPOINT call");
        try {
          const value = await runUsecase(ctx, identity, name as keyof typeof usecases, args, deps);
          sql.exec("RELEASE call");
          return value;
        } catch (e) {
          sql.exec("ROLLBACK TO call");
          sql.exec("RELEASE call");
          throw e;
        }
      }),
    fetch: async () => new Response(null, { status: 101 }),
  };
}

function app(db = fakeDb()) {
  return createApp({ identify: devIdentifier, db: () => db, allowedOrigins: [] });
}

const as = (subject: string) => ({
  "X-MF100-Identity": JSON.stringify({ subject }),
  "Content-Type": "application/json",
});
const post = (
  a: ReturnType<typeof app>,
  name: string,
  args: unknown[],
  subject = principals.manager.userId,
) =>
  a.request(`/u/${name}`, { method: "POST", headers: as(subject), body: JSON.stringify({ args }) });

const workInput = {
  title: "MF100 パンフレット",
  purpose: "来場者向け案内",
  category: "印刷物",
  mediaType: "pdf",
  year: 100,
  creatorIds: [principals.creator.userId],
  approverId: principals.approver.userId,
};

describe("POST /u/:name", () => {
  it("本人が分からなければ 401、知らない名前は 404、args の無い body は 400", async () => {
    const a = app();
    expect((await a.request("/u/createWork", { method: "POST" })).status).toBe(401);
    expect((await post(a, "noSuchUsecase", [])).status).toBe(404);
    const bad = await a.request("/u/createWork", {
      method: "POST",
      headers: as("u1"),
      body: "{}",
    });
    expect(bad.status).toBe(400);
  });

  it("サービス専用のユースケース（実体の検証後に apps/api が呼ぶもの）は公開の口から呼べない", async () => {
    const res = await post(app(), "completeItemUpload", [
      { attemptId: "x", size: 1, sha256: "forged" },
    ]);
    expect(res.status).toBe(404);
  });

  it("ユースケースを (ctx, principal, ...args) で呼び、結果をそのまま返す。書いたものは次の呼び出しで読める", async () => {
    const db = fakeDb();
    const a = app(db);
    const created = await post(a, "createWork", [workInput]);
    expect(created.status).toBe(200);
    const work = (await created.json()) as { id: string; title: string };
    expect(work.title).toBe("MF100 パンフレット");
    expect(await db.ctx.works.findById(work.id)).toMatchObject({ title: "MF100 パンフレット" });
  });

  it("DomainError は code と details を body に、状態は code から決める。見えない制作物は存在ごと隠す（forbidden → 403）", async () => {
    const a = app();
    const res = await post(a, "updateWork", [{ workId: "nope", patch: {} }], "stranger");
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ code: "forbidden" });
  });

  it("途中で DomainError になった呼び出しは、それまでの書き込みも残さない（2 行目が不正な一括登録で 1 行目も登録されない）", async () => {
    const db = fakeDb();
    const a = app(db);
    const res = await post(a, "importWorks", [{ rows: [workInput, { ...workInput, title: "" }] }]);
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: "work_import_invalid", details: { index: 1 } });
    expect(await db.ctx.works.list(10)).toEqual([]);
  });

  it("patch に id を紛れ込ませても、別の制作物は書き換わらない", async () => {
    const db = fakeDb();
    const a = app(db);
    const mine = (await (await post(a, "createWork", [workInput])).json()) as { id: string };
    const other = (await (
      await post(a, "createWork", [{ ...workInput, title: "他人の制作物" }])
    ).json()) as { id: string };
    const res = await post(a, "updateWork", [
      { workId: mine.id, patch: { title: "乗っ取り", id: other.id } },
    ]);
    expect(res.status).toBe(200);
    expect(await db.ctx.works.findById(other.id)).toMatchObject({ title: "他人の制作物" });
    expect(await db.ctx.works.findById(mine.id)).toMatchObject({ title: "乗っ取り" });
  });
});
