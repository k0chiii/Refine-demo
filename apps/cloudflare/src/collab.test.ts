import { createWork } from "@mf100/application";
import { principals } from "@mf100/application/testing";
import type { Principal } from "@mf100/domain";
import { describe, expect, it } from "vite-plus/test";
import { migrateCollab, PRESENCE_TTL } from "./collab/store.ts";
import type { FnCtx } from "./functions/define.ts";
import { collaboration } from "./functions/collaboration.ts";
import { presence } from "./functions/presence.ts";
import { createInMemoryContext, nodeSql } from "./testing/context.ts";

// 在席と共同編集を、登録表を通さずに関数の handler で直に確かめる（index.ts への組み込みは別）。
// 同じ SQLite・同じ AppContext なので、本番の DO と違うのは transaction（1 呼び出し 1 トランザクション）だけ

const TAB_A = "11111111-1111-4111-8111-111111111111";
const TAB_B = "22222222-2222-4222-8222-222222222222";
const EMPTY = JSON.stringify({ type: "doc", content: [{ type: "paragraph" }] });
const doc = (text: string) =>
  JSON.stringify({
    type: "doc",
    content: [{ type: "paragraph", content: [{ type: "text", text }] }],
  });

function world() {
  const sql = nodeSql();
  const mem = createInMemoryContext(Date.UTC(2026, 10, 1), sql);
  migrateCollab(sql);
  mem.state.names.set(principals.manager.userId, "統括");
  mem.state.names.set(principals.creator.userId, "制作者");
  const as = (principal: Principal): FnCtx => ({
    db: mem,
    sql,
    principal,
    userId: principal.userId,
    env: {} as Env,
    now: () => mem.clock.now(),
    schedule: () => {},
  });
  const newWork = (mediaType: "document" | "sns" = "document") =>
    createWork(mem, principals.manager, {
      title: "MF100 原稿",
      purpose: "来場者向け案内",
      category: "文章",
      mediaType,
      year: 100,
      creatorIds: [principals.creator.userId],
      approverId: principals.approver.userId,
    }).then((w) => w.id);
  const count = (table: string) => Number(sql.exec(`SELECT count(*) AS n FROM ${table}`)[0]?.n);
  return { sql, mem, as, newWork, count };
}

describe("presence: 誰が見ているか", () => {
  const { manager, creator, stranger } = principals;

  it("心拍で list に出る。自分には isMe が付き、同じ人の複数タブは 1 人にまとまる", async () => {
    const w = world();
    const workId = await w.newWork();
    await presence["presence:heartbeat"].handler(w.as(creator), { workId, sessionId: TAB_A });
    await presence["presence:heartbeat"].handler(w.as(creator), { workId, sessionId: TAB_B });
    await presence["presence:heartbeat"].handler(w.as(manager), { workId, sessionId: TAB_A });

    const seenByManager = await presence["presence:list"].handler(w.as(manager), { workId });
    expect(seenByManager).toEqual([
      { userId: creator.userId, name: "制作者", email: null, isMe: false },
      { userId: manager.userId, name: "統括", email: null, isMe: true },
    ]);
    // 別の制作物（部屋）には出ない
    const other = await w.newWork();
    expect(await presence["presence:list"].handler(w.as(manager), { workId: other })).toEqual([]);
  });

  it("同じタブの心拍は同じ合言葉を返し、行を増やさない。disconnect はそのタブだけを消す", async () => {
    const w = world();
    const workId = await w.newWork();
    const beat = (sessionId: string) =>
      presence["presence:heartbeat"].handler(w.as(creator), { workId, sessionId });
    const a = await beat(TAB_A);
    expect((await beat(TAB_A)).sessionToken).toBe(a.sessionToken);
    const b = await beat(TAB_B);
    expect(b.sessionToken).not.toBe(a.sessionToken);
    expect(w.count("presence")).toBe(2);

    // 認証なしで呼べる（タブを閉じる・サインアウトの直後でも切れる）。合言葉が鍵
    expect(presence["presence:disconnect"].auth).toBe("public");
    await presence["presence:disconnect"].handler(w.as(stranger), { sessionToken: a.sessionToken });
    const list = () => presence["presence:list"].handler(w.as(manager), { workId });
    // もう一方のタブが残っている間は、その人はまだ居る
    expect(await list()).toHaveLength(1);
    await presence["presence:disconnect"].handler(w.as(stranger), { sessionToken: b.sessionToken });
    expect(await list()).toEqual([]);
    expect(w.count("presence")).toBe(0);
    expect(w.count("presenceSessions")).toBe(0);
    // 知らない合言葉は何も起こさない
    await expect(
      presence["presence:disconnect"].handler(w.as(stranger), { sessionToken: "nope" }),
    ).resolves.toBeNull();
  });

  it("心拍が途切れて期限（30 秒 x 2.5）を過ぎた人は list に出ず、次の心拍の掃除で行ごと消える", async () => {
    const w = world();
    const workId = await w.newWork();
    await presence["presence:heartbeat"].handler(w.as(creator), { workId, sessionId: TAB_A });
    w.mem.clock.advance(PRESENCE_TTL - 1);
    expect(await presence["presence:list"].handler(w.as(manager), { workId })).toHaveLength(1);
    w.mem.clock.advance(1);
    expect(await presence["presence:list"].handler(w.as(manager), { workId })).toEqual([]);
    // 行はまだ残っている（掃除は心拍のついで）
    expect(w.count("presence")).toBe(1);
    await presence["presence:heartbeat"].handler(w.as(manager), { workId, sessionId: TAB_B });
    expect(w.count("presence")).toBe(1);
    expect(w.count("presenceSessions")).toBe(1);
    expect(await presence["presence:list"].handler(w.as(manager), { workId })).toMatchObject([
      { userId: manager.userId },
    ]);
  });

  it("見られない（制作物が無い）なら heartbeat も list も forbidden。タブの ID は UUID の形だけ", async () => {
    const w = world();
    await expect(
      presence["presence:heartbeat"].handler(w.as(stranger), { workId: "nope", sessionId: TAB_A }),
    ).rejects.toMatchObject({ code: "forbidden" });
    await expect(
      presence["presence:list"].handler(w.as(stranger), { workId: "nope" }),
    ).rejects.toMatchObject({ code: "forbidden" });
    expect(w.count("presence")).toBe(0);
    expect(
      presence["presence:heartbeat"].args.safeParse({ workId: "w", sessionId: "x" }).success,
    ).toBe(false);
  });
});

describe("collaboration: 文章の共同編集", () => {
  const { manager, creator, stranger } = principals;
  const call = <K extends keyof typeof collaboration>(
    w: ReturnType<typeof world>,
    name: K,
    who: Principal,
    args: Parameters<(typeof collaboration)[K]["handler"]>[1],
  ) =>
    (collaboration[name].handler as (ctx: FnCtx, args: unknown) => Promise<unknown>)(
      w.as(who),
      args,
    );

  async function enabled() {
    const w = world();
    const workId = await w.newWork();
    await call(w, "collaboration:enable", creator, { workId });
    return { w, workId };
  }

  it("enable は下書き（無ければ空の文書）を版 1 の snapshot に置く。2 回目は何もしない", async () => {
    const { w, workId } = await enabled();
    expect(await call(w, "collaboration:getSnapshot", creator, { id: workId })).toEqual({
      content: EMPTY,
      version: 1,
    });
    expect(await call(w, "collaboration:latestVersion", creator, { id: workId })).toBe(1);
    await call(w, "collaboration:enable", creator, { workId });
    expect(w.count("collabSnapshots")).toBe(1);
    expect(w.count("collaborativeDrafts")).toBe(1);
  });

  it("まだ共同編集でない文書は、snapshot が無く、書けない。SNS 投稿は文章ではないので切り替えられない", async () => {
    const w = world();
    const workId = await w.newWork();
    expect(await call(w, "collaboration:getSnapshot", creator, { id: workId })).toEqual({
      content: null,
    });
    expect(await call(w, "collaboration:latestVersion", creator, { id: workId })).toBeNull();
    await expect(
      call(w, "collaboration:submitSteps", creator, {
        id: workId,
        version: 1,
        clientId: 1,
        steps: ["s"],
      }),
    ).rejects.toThrow("collaboration_not_enabled");

    const sns = await w.newWork("sns");
    await expect(call(w, "collaboration:enable", creator, { workId: sns })).rejects.toMatchObject({
      code: "document_format_mismatch",
    });
  });

  it("読めるのは誰でも、書けるのは版を提出できる人だけ（制作者は書け、無関係の委員と統括は読むだけ）", async () => {
    const { w, workId } = await enabled();
    await expect(call(w, "collaboration:getSnapshot", stranger, { id: workId })).resolves.toEqual(
      expect.objectContaining({ version: 1 }),
    );
    for (const who of [stranger, manager]) {
      await expect(
        call(w, "collaboration:submitSteps", who, {
          id: workId,
          version: 1,
          clientId: 1,
          steps: ["s"],
        }),
      ).rejects.toMatchObject({ code: "forbidden" });
      await expect(
        call(w, "collaboration:submitSnapshot", who, { id: workId, version: 2, content: EMPTY }),
      ).rejects.toMatchObject({ code: "forbidden" });
    }
    await expect(call(w, "collaboration:enable", stranger, { workId })).rejects.toMatchObject({
      code: "forbidden",
    });
    expect(w.count("collabSteps")).toBe(0);
  });

  it("2 つの画面が交互に送ると版が進み、競合した側には相手のステップが返って、getSteps で追いつける", async () => {
    const { w, workId } = await enabled();
    const submit = (clientId: number, version: number, steps: string[]) =>
      call(w, "collaboration:submitSteps", creator, { id: workId, version, clientId, steps });
    const catchUp = (version: number) =>
      call(w, "collaboration:getSteps", creator, { id: workId, version });
    const latest = () => call(w, "collaboration:latestVersion", creator, { id: workId });

    // A が版 1 から 1 つ: 書けて、版は 2
    expect(await submit(100, 1, ["a1"])).toEqual({ status: "synced" });
    expect(await latest()).toBe(2);

    // B も版 1 から送る（A の変更を知らない）: 書かれず、A のステップが返る
    expect(await submit(200, 1, ["b1"])).toEqual({
      status: "needs-rebase",
      steps: ["a1"],
      clientIds: [100],
    });
    expect(await latest()).toBe(2);

    // B は追いついて（getSteps）から、組み直したステップを版 2 から送る
    expect(await catchUp(1)).toEqual({ steps: ["a1"], clientIds: [100], version: 2 });
    expect(await submit(200, 2, ["b1'"])).toEqual({ status: "synced" });
    expect(await latest()).toBe(3);

    // A は一度に 3 つ送る（版 3 → 6）。B は途中の版 4 から追う: 自分の知らない分だけ返る
    expect(await submit(100, 3, ["a2", "a3", "a4"])).toEqual({ status: "synced" });
    expect(await catchUp(4)).toEqual({
      steps: ["a3", "a4"],
      clientIds: [100, 100],
      version: 6,
    });
    // 追いついた人の getSteps は空で、版はそのまま
    expect(await catchUp(6)).toEqual({ steps: [], clientIds: [], version: 6 });
    // 競合の返しも、送った版より後だけ（A の 1 つ目を知っている人に 1 つ目は返さない）
    expect(await submit(200, 4, ["b2"])).toEqual({
      status: "needs-rebase",
      steps: ["a3", "a4"],
      clientIds: [100, 100],
    });
    // 全部読み直すと、送った順に版が 1 つずつ続いている
    expect(await catchUp(1)).toMatchObject({
      steps: ["a1", "b1'", "a2", "a3", "a4"],
      clientIds: [100, 200, 100, 100, 100],
      version: 6,
    });
  });

  it("最新より先の版を名乗る送信は、版の穴を作らず断る（既存の版は変わらない）", async () => {
    const { w, workId } = await enabled();
    await expect(
      call(w, "collaboration:submitSteps", creator, {
        id: workId,
        version: 5,
        clientId: 1,
        steps: ["x"],
      }),
    ).rejects.toMatchObject({ code: "version_conflict" });
    expect(w.count("collabSteps")).toBe(0);
    // 空の送信は何もせず synced
    expect(
      await call(w, "collaboration:submitSteps", creator, {
        id: workId,
        version: 1,
        clientId: 1,
        steps: [],
      }),
    ).toEqual({ status: "synced" });
  });

  it("clientId は文字列でも数でも、入れた型のまま返る", async () => {
    const { w, workId } = await enabled();
    await call(w, "collaboration:submitSteps", creator, {
      id: workId,
      version: 1,
      clientId: "tab-a",
      steps: ["s1"],
    });
    await call(w, "collaboration:submitSteps", creator, {
      id: workId,
      version: 2,
      clientId: 42,
      steps: ["s2"],
    });
    expect(await call(w, "collaboration:getSteps", creator, { id: workId, version: 1 })).toEqual({
      steps: ["s1", "s2"],
      clientIds: ["tab-a", 42],
      version: 3,
    });
  });

  it("snapshot: 版が進んだものだけ下書き（documents）に写り、同じ版は冪等、違う中身は競合", async () => {
    const { w, workId } = await enabled();
    const submit = (version: number, content: string) =>
      call(w, "collaboration:submitSnapshot", creator, { id: workId, version, content });
    const draft = () => w.mem.documents.findByWork(workId);

    await submit(3, doc("こんにちは"));
    expect(await draft()).toMatchObject({
      text: "こんにちは",
      version: 1,
      updatedBy: creator.userId,
    });
    expect(
      w.sql.exec("SELECT snapshotVersion FROM collaborativeDrafts WHERE workId = ?", workId),
    ).toEqual([{ snapshotVersion: 3 }]);
    expect(await call(w, "collaboration:getSnapshot", stranger, { id: workId })).toEqual({
      content: doc("こんにちは"),
      version: 3,
    });
    // 版を指定すると、その版以下で最新の snapshot
    expect(
      await call(w, "collaboration:getSnapshot", stranger, { id: workId, version: 2 }),
    ).toEqual({ content: EMPTY, version: 1 });

    // 同じ版・同じ中身はそのまま通る（再送）
    await submit(3, doc("こんにちは"));
    expect(w.count("collabSnapshots")).toBe(2);
    // 同じ版・違う中身は競合で、下書きにも残らない
    await expect(submit(3, doc("別の文"))).rejects.toMatchObject({ code: "version_conflict" });
    expect(await draft()).toMatchObject({ text: "こんにちは" });

    // 古い版（snapshotVersion 以下）の snapshot は下書きを巻き戻さない
    await submit(2, doc("古い"));
    expect(await draft()).toMatchObject({ text: "こんにちは", version: 1 });
    await submit(4, doc("こんにちは、世界"));
    expect(await draft()).toMatchObject({ text: "こんにちは、世界", version: 2 });
  });

  it("文章でない snapshot（壊れた JSON など）は下書きに写さず断る", async () => {
    const { w, workId } = await enabled();
    for (const content of ["{", JSON.stringify({ type: "paragraph" })])
      await expect(
        call(w, "collaboration:submitSnapshot", creator, { id: workId, version: 2, content }),
      ).rejects.toMatchObject({ code: "document_invalid" });
    expect(w.count("collabSnapshots")).toBe(1);
  });
});
