import { describe, expect, it } from "vite-plus/test";
import { principals } from "@mf100/application/testing";
import { createApp } from "./app.ts";
import { devIdentifier } from "./identity.ts";
import { runUsecase } from "./run.ts";
import { createInMemoryContext } from "./testing/context.ts";
import { usecases } from "./registry.ts";

/** Durable Object の代わり: 同じ SQLite のアダプタを Node の中で直に包む（トランザクションは無い。巻き戻しは DO の仕事） */
function fakeDb(ctx = createInMemoryContext()) {
  const deps = { adminSubjects: new Set<string>(), upsertUser: async () => {} };
  return {
    ctx,
    run: (identity: { subject: string }, name: string, args: unknown[]) =>
      runUsecase(ctx, identity, name as keyof typeof usecases, args, deps),
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

describe("POST /u/:name", () => {
  it("本人が分からなければ 401、知らない名前は 404、args の無い body は 400", async () => {
    const a = app();
    expect((await a.request("/u/createWork", { method: "POST" })).status).toBe(401);
    expect((await post(a, "noSuchUsecase", [])).status).toBe(404);
    const bad = await a.request("/u/createWork", { method: "POST", headers: as("u1"), body: "{}" });
    expect(bad.status).toBe(400);
  });

  it("ユースケースを (ctx, principal, ...args) で呼び、結果をそのまま返す。書いたものは次の呼び出しで読める", async () => {
    const db = fakeDb();
    const a = app(db);
    const created = await post(a, "createWork", [
      {
        title: "MF100 パンフレット",
        purpose: "来場者向け案内",
        category: "印刷物",
        mediaType: "pdf",
        year: 100,
        creatorIds: [principals.creator.userId],
        approverId: principals.approver.userId,
      },
    ]);
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
});
