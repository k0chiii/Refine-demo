import { describe, expect, it } from "vite-plus/test";
import type { Sql } from "./sqlite/sql.ts";
import { app, fakeDb, post, signIn, UPLOAD_SECRET } from "./testing/http.ts";

// Convex の画面向けの読み・管理者の操作（独自の関数）を、HTTP から 1 周させて戻りの形を確かめる。
// 期待は apps/convex/convex/*.test.ts（commentReactions / commentDelete / commentReplyEdit / groups / me / notation /
// approvals / mvp / notionAlignment / platformControls / push / workMetrics）から写した。

/** 戻りの形が Convex と同じかを見るテストなので、型は付けずに値だけ引く */
// oxlint-disable-next-line typescript/no-explicit-any
type Json = any;

const HOUR = 3_600_000;
const NOW = Date.UTC(2026, 10, 1);
const KEY = { "X-MF100-Service-Key": UPLOAD_SECRET };

/** u_admin はブートストラップ管理者（env の subject）。生の SQL は、画面に出口の無い状態（subject 無しの行など）を作るのに使う */
function world(env: Record<string, string> = {}) {
  let sql!: Sql;
  const a = app(
    fakeDb(
      (s) => {
        sql = s;
        return s;
      },
      { MF100_SYSTEM_ADMIN_SUBJECTS: "u_admin", ...env },
    ),
  );
  return {
    a,
    sql,
    call: async (
      name: string,
      args: unknown,
      subject = "u_manager",
      headers: Record<string, string> = {},
    ) => {
      const res = await post(a, name, args, subject, headers);
      const body = (await res.json()) as { value?: unknown };
      expect(res.status, `${name}: ${JSON.stringify(body)}`).toBe(200);
      return body.value as Json;
    },
    fail: async (name: string, args: unknown, subject: string | null = "u_manager") => {
      const res = await post(a, name, args, subject);
      return { status: res.status, ...((await res.json()) as { code: string }) };
    },
  };
}
type World = ReturnType<typeof world>;

/** 制作物を登録して（進行中）、版の提出の準備から実体の検証完了までを 1 回進める */
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
  const begun = await w.call(
    "submissions:beginUpload",
    { itemId: prepared.items[0].id },
    "u_creator",
    KEY,
  );
  await w.call(
    "submissions:completeUpload",
    { attemptId: begun.attemptId, size: 10, sha256: "abc" },
    "u_creator",
    KEY,
  );
  return prepared as { sessionId: string; items: { id: string }[] };
}

async function createWork(w: World, extra: Record<string, unknown> = {}) {
  return (await w.call("works:create", {
    title: "ポスター",
    purpose: "告知",
    category: "印刷物",
    mediaType: "pdf",
    year: 100,
    creatorIds: [await signIn(w.a, "u_creator")],
    approverId: await signIn(w.a, "u_approver"),
    reviewerIds: [await signIn(w.a, "u_reviewer")],
    activate: true,
    ...extra,
  })) as string;
}

/** 制作物を登録して版を 1 つ提出する。制作者 u_creator・校了者 u_approver・校正者 u_reviewer */
async function submittedRevision(w: World, extra: Record<string, unknown> = {}) {
  const workId = await createWork(w, extra);
  const prepared = await uploadedSession(w, workId);
  const confirmed = await w.call(
    "submissions:confirm",
    { sessionId: prepared.sessionId },
    "u_creator",
  );
  return { workId, revisionId: confirmed.revisionId as string };
}

const idOf = (w: World, subject: string) => signIn(w.a, subject);

// ------------------------------------------------------------------ users / me

describe("users:*（名簿の検索・ID の解決・アバター）", () => {
  it("search は一度でもログインした人だけを、ふりがなの順で返す（代つき）。limit は 50 まで", async () => {
    const w = world();
    const x = await idOf(w, "u_x");
    const y = await idOf(w, "u_y");
    await idOf(w, "u_z");
    // ふりがなが表示名になり、並びもその順（Convex の users.search と同じ）
    w.sql.exec(
      "UPDATE users SET doc = json_set(doc, '$.hurigana', ?, '$.generation', 100) WHERE id = ?",
      "いろは",
      x,
    );
    w.sql.exec("UPDATE users SET doc = json_set(doc, '$.hurigana', ?) WHERE id = ?", "あさひ", y);
    // ログインしたことのない人（subject 無し）は候補にならない
    w.sql.exec(
      "INSERT INTO users (id, doc) VALUES ('ghost', ?)",
      JSON.stringify({ name: "u_ghost" }),
    );

    // localeCompare("ja") の並び（英字が仮名より前）
    const found = await w.call("users:search", { text: "" }, "u_z");
    expect(found.map((u: Json) => u.name)).toEqual(["u_z", "あさひ", "いろは"]);
    expect(found.find((u: Json) => u.id === x)).toEqual({
      id: x,
      name: "いろは",
      email: null,
      generation: 100,
    });
    // ひらがなでもカタカナでも、ふりがなで当たる
    expect(
      (await w.call("users:search", { text: "イロハ" }, "u_z")).map((u: Json) => u.id),
    ).toEqual([x]);
    expect(await w.call("users:search", { text: "", limit: 1 }, "u_z")).toHaveLength(1);
    expect((await w.fail("users:search", { text: "" }, null)).status).toBe(401);
  });

  it("byIds は system・bot・消えた人・知らない ID も 1 件ずつ返す（placeholder は Convex の resolveUsers と同じ）", async () => {
    const w = world();
    const c = await idOf(w, "u_creator");
    const got = await w.call(
      "users:byIds",
      { ids: [c, "system", "bot:proofreader", "bot:other", "missing", c] },
      "u_creator",
    );
    expect(got).toEqual([
      { id: c, name: "u_creator", email: null },
      { id: "system", name: "システム", email: null },
      { id: "bot:proofreader", name: "自動校正", email: null },
      { id: "bot:other", name: "システム", email: null },
      { id: "missing", name: "（不明なユーザー）", email: null },
    ]);
  });

  it("me:setAvatar は domain で正規化して本人の行だけに書き、me:me と users:avatars に出る。null で消せる", async () => {
    const w = world({ NOGIKU_MOCK_ENABLED: "true" });
    const c = await idOf(w, "u_creator");
    const r = await idOf(w, "u_reviewer");
    expect((await w.call("me:me", {}, "u_creator")).avatar).toBeNull();
    const saved = await w.call(
      "me:setAvatar",
      {
        avatar: {
          selections: { head: "braids", item: "calico-cat" },
          colors: { hair: "#4a3728" },
          background: "f6f5f4",
        },
      },
      "u_creator",
    );
    expect(saved).toEqual({
      selections: { head: "braids", item: "calico-cat" },
      colors: { hair: "4A3728" },
      background: "F6F5F4",
    });
    expect((await w.call("me:me", {}, "u_creator")).avatar).toEqual(saved);
    // 設定のある人だけ返す（system・bot・設定の無い人は出ない）
    expect(
      await w.call("users:avatars", { ids: [c, r, "system", "bot:proofreader"] }, "u_reviewer"),
    ).toEqual([{ id: c, avatar: saved }]);
    expect((await w.call("me:me", {}, "u_reviewer")).avatar).toBeNull();

    // 外した部位（bottom）が残る古い値は、読むときに捨てる。ボトムスだけなら「設定なし」
    w.sql.exec(
      "UPDATE users SET doc = json_set(doc, '$.avatar', json(?)) WHERE id = ?",
      JSON.stringify({ selections: { head: "braids", bottom: "wide-pants" } }),
      c,
    );
    expect((await w.call("me:me", {}, "u_creator")).avatar).toEqual({
      selections: { head: "braids" },
    });
    w.sql.exec(
      "UPDATE users SET doc = json_set(doc, '$.avatar', json(?)) WHERE id = ?",
      JSON.stringify({ selections: { bottom: "wide-pants" } }),
      c,
    );
    expect(await w.call("users:avatars", { ids: [c] }, "u_reviewer")).toEqual([]);

    expect(await w.call("me:setAvatar", { avatar: null }, "u_creator")).toBeNull();
    expect((await w.call("me:me", {}, "u_creator")).avatar).toBeNull();
    // 形の違う設定は avatar_invalid。未ログインは変えられない
    expect(
      await w.fail("me:setAvatar", { avatar: { colors: { hair: "red" } } }, "u_creator"),
    ).toMatchObject({ status: 400, code: "avatar_invalid" });
    expect((await w.fail("me:setAvatar", { avatar: null }, null)).status).toBe(401);
  });

  it("me:me の source と mock は Convex と同じ（行の source、env の NOGIKU_MOCK_ENABLED）", async () => {
    const mock = world({ NOGIKU_MOCK_ENABLED: "true" });
    const c = await idOf(mock, "u_creator");
    expect(await mock.call("me:me", {}, "u_creator")).toMatchObject({ source: null, mock: true });
    mock.sql.exec("UPDATE users SET doc = json_set(doc, '$.source', 'nogiku') WHERE id = ?", c);
    expect((await mock.call("me:me", {}, "u_creator")).source).toBe("nogiku");
    const real = world();
    expect((await real.call("me:me", {}, "u_creator")).mock).toBe(false);
  });
});

// ------------------------------------------------------------------ admin / acl / teams

describe("admin:* と acl:*（管理者の操作と画面向けの読み）", () => {
  it("setSystemAdmin: 最後の管理者は自分で外せない。付与・剥奪は監査ログに新しい順で残る", async () => {
    const w = world();
    const admin = await idOf(w, "u_admin");
    const b = await idOf(w, "u_b");
    const c = await idOf(w, "u_c");
    // 管理者でない人は触れない
    expect(await w.fail("admin:setSystemAdmin", { userId: b, value: true }, "u_b")).toMatchObject({
      status: 403,
      code: "forbidden",
    });
    expect(
      await w.fail("admin:setSystemAdmin", { userId: "nobody", value: true }, "u_admin"),
    ).toMatchObject({
      status: 404,
      code: "user_not_found",
    });
    expect(await w.call("admin:setSystemAdmin", { userId: b, value: true }, "u_admin")).toBeNull();
    expect((await w.call("me:me", {}, "u_b")).isSystemAdmin).toBe(true);

    // DB 上の管理者は b だけ。b が自分を外すのは拒否（env の u_admin は数えない）
    expect(await w.fail("admin:setSystemAdmin", { userId: b, value: false }, "u_b")).toMatchObject({
      status: 400,
      code: "last_system_admin",
    });
    // 他人を外すのは数えない。c を足せば b は自分を外せる
    await w.call("admin:setSystemAdmin", { userId: c, value: true }, "u_b");
    expect(await w.call("admin:setSystemAdmin", { userId: b, value: false }, "u_b")).toBeNull();
    expect((await w.call("me:me", {}, "u_b")).isSystemAdmin).toBe(false);
    expect(await w.fail("admin:auditLog", {}, "u_b")).toMatchObject({ status: 403 });

    const log = await w.call("admin:auditLog", {}, "u_admin");
    expect(log.map((e: Json) => [e.operation, e.entityId, e.before, e.after])).toEqual([
      ["revoke_system_admin", b, true, false],
      ["grant_system_admin", c, false, true],
      ["grant_system_admin", b, false, true],
    ]);
    expect(log[0]).toMatchObject({ entityType: "user", actorId: b, at: NOW });
    expect(new Set(log.map((e: Json) => e._id)).size).toBe(3);
    // entityType と entityId を両方渡したときだけ絞る。limit も効く
    expect(
      (await w.call("admin:auditLog", { entityType: "user", entityId: c }, "u_admin")).map(
        (e: Json) => e.operation,
      ),
    ).toEqual(["grant_system_admin"]);
    expect(await w.call("admin:auditLog", { limit: 1 }, "u_admin")).toHaveLength(1);
    void admin;
  });

  it("setGeneration: 1〜999 の整数か null。管理者のみ。acl:searchUsers と users:search の代に出る", async () => {
    const w = world();
    const c = await idOf(w, "u_creator");
    expect(
      await w.fail("admin:setGeneration", { userId: c, generation: 100 }, "u_manager"),
    ).toMatchObject({ status: 403 });
    for (const generation of [0, 1000, 1.5])
      expect(
        await w.fail("admin:setGeneration", { userId: c, generation }, "u_admin"),
      ).toMatchObject({ status: 400, code: "generation_invalid" });
    expect(
      await w.fail("admin:setGeneration", { userId: "nobody", generation: 1 }, "u_admin"),
    ).toMatchObject({
      status: 404,
    });

    await w.call("admin:setGeneration", { userId: c, generation: 100 }, "u_admin");
    expect((await w.call("acl:searchUsers", { text: "creator" }, "u_admin"))[0]).toMatchObject({
      id: c,
      generation: 100,
      isSystemAdmin: false,
    });
    expect((await w.call("users:search", { text: "creator" }, "u_creator"))[0]).toMatchObject({
      generation: 100,
    });
    await w.call("admin:setGeneration", { userId: c, generation: null }, "u_admin");
    expect(
      (await w.call("acl:searchUsers", { text: "creator" }, "u_admin"))[0].generation,
    ).toBeNull();
    const ops = await w.call("admin:auditLog", { entityId: c, entityType: "user" }, "u_admin");
    expect(ops.map((e: Json) => [e.operation, e.before, e.after])).toEqual([
      ["set_generation", 100, null],
      ["set_generation", null, 100],
    ]);
  });

  it("acl:list は管理者に履歴ごと（新しい付与が先・名前つき）、主管・校了者に有効分だけ。見られない人は forbidden", async () => {
    const w = world();
    const { workId } = await submittedRevision(w);
    const viewer = await idOf(w, "u_viewer");
    const other = await idOf(w, "u_other");
    await w.call("acl:grant", { workId, userIds: [viewer], permission: "review" }, "u_admin");
    await w.call("acl:grant", { workId, userIds: [other], permission: "edit" }, "u_admin");
    await w.call("acl:revoke", { workId, userId: viewer }, "u_admin");

    const asAdmin = await w.call("acl:list", { workId }, "u_admin");
    // 並びは付与の新しい順（この時計は止まっているので、同時刻は付けた順のまま。順は確かめず、中身を見る）
    const mine = asAdmin.filter((g: Json) => [viewer, other].includes(g.principalId));
    expect(mine).toHaveLength(2);
    expect(mine.find((g: Json) => g.principalId === viewer)).toMatchObject({
      permission: "review",
      principal: { id: viewer, name: "u_viewer" },
      granter: { name: "u_admin" },
      revoker: { id: await idOf(w, "u_admin") },
    });
    expect(mine.find((g: Json) => g.principalId === other).revoker).toBeNull();
    const times = asAdmin.map((g: Json) => g.grantedAt);
    expect(times).toEqual([...times].sort((x: number, y: number) => y - x));
    // 主管（u_manager）は有効分だけ
    const asManager = await w.call("acl:list", { workId }, "u_manager");
    expect(asManager.filter((g: Json) => g.principalId === viewer)).toEqual([]);
    expect(asManager.some((g: Json) => g.principalId === other)).toBe(true);
    for (const who of ["u_creator", "u_viewer"])
      expect(await w.fail("acl:list", { workId }, who)).toMatchObject({ status: 403 });
  });

  it("acl:searchUsers / workSummary / adminWorks は管理者のみ。作品の名称・区分・有効な付与の数だけを返す", async () => {
    const w = world();
    const { workId } = await submittedRevision(w);
    const other = await idOf(w, "u_other");
    w.sql.exec(
      "INSERT INTO users (id, doc) VALUES ('ghost', ?)",
      JSON.stringify({ name: "u_ghost" }),
    );
    await w.call("acl:grant", { workId, userIds: [other], permission: "review" }, "u_admin");

    for (const [name, args] of [
      ["acl:searchUsers", { text: "u_" }],
      ["acl:workSummary", { workId }],
      ["acl:adminWorks", {}],
    ] as const)
      expect(await w.fail(name, args, "u_manager"), name).toMatchObject({
        status: 403,
        code: "forbidden",
      });

    // subject の無い行（ghost）は候補に出ない
    expect(
      (await w.call("acl:searchUsers", { text: "u_" }, "u_admin")).map((u: Json) => u.name).sort(),
    ).toEqual(["u_admin", "u_approver", "u_creator", "u_manager", "u_other", "u_reviewer"].sort());
    expect(await w.call("acl:workSummary", { workId }, "u_admin")).toEqual({
      id: workId,
      title: "ポスター",
      legacyId: null,
      category: "印刷物",
      lifecycle: "active",
    });
    expect(await w.call("acl:workSummary", { workId: "nope" }, "u_admin")).toBeNull();

    const works = await w.call("acl:adminWorks", {}, "u_admin");
    const active = (await w.call("acl:list", { workId }, "u_admin")).filter(
      (g: Json) => g.revokedAt === undefined,
    ).length;
    expect(active).toBeGreaterThan(0);
    expect(works).toEqual([
      {
        id: workId,
        title: "ポスター",
        legacyId: null,
        category: "印刷物",
        mediaType: "pdf",
        lifecycle: "active",
        activeGrantCount: active,
      },
    ]);
  });

  it("teams:importDirectory は管理者だけが引け、それ以外は空。名前（漢字・表示名）・メールで当たる", async () => {
    const w = world();
    const c = await idOf(w, "u_creator");
    w.sql.exec(
      "UPDATE users SET doc = json_set(doc, '$.email', ?) WHERE id = ?",
      "Creator@example.com",
      c,
    );
    w.sql.exec(
      "INSERT INTO users (id, doc) VALUES ('ghost', ?)",
      JSON.stringify({ name: "u_ghost" }),
    );
    expect(await w.call("teams:importDirectory", { keys: ["u_creator"] }, "u_manager")).toEqual([]);
    expect(await w.call("teams:importDirectory", { keys: [] }, "u_admin")).toEqual([]);
    const expected = [
      { id: c, name: "u_creator", email: "Creator@example.com", otherNames: ["u_creator"] },
    ];
    expect(await w.call("teams:importDirectory", { keys: ["U_Creator "] }, "u_admin")).toEqual(
      expected,
    );
    expect(
      await w.call(
        "teams:importDirectory",
        { keys: ["creator@EXAMPLE.com", "u_ghost"] },
        "u_admin",
      ),
    ).toEqual(expected);
  });
});

// ------------------------------------------------------------------ comments

describe("comments:events（スレッドの流れの投影）", () => {
  async function thread(w: World) {
    const { revisionId } = await submittedRevision(w);
    const threadId = (await w.call(
      "comments:post",
      { revisionId, body: "団体名が誤り", kind: "correction", severity: "info" },
      "u_reviewer",
    )) as string;
    return { revisionId, threadId };
  }
  const repliesOf = (v: Json) => v.events.filter((e: Json) => e.eventType === "replied");

  it("返信の訂正は edited と can を持ち、記録の行は並ばない。本人だけが訂正・削除できる", async () => {
    const w = world();
    const { threadId } = await thread(w);
    await w.call("comments:reply", { threadId, body: "補足します" }, "u_reviewer");
    const events = (who: string) => w.call("comments:events", { threadId }, who);
    const [before] = repliesOf(await events("u_reviewer"));
    expect(before).toMatchObject({ edited: false, can: { delete: true, edit: true }, files: [] });
    expect(before.actor).toEqual({
      id: await idOf(w, "u_reviewer"),
      name: "u_reviewer",
      email: null,
    });

    await w.call(
      "comments:editReply",
      { threadId, replyEventId: before.id, body: "**補足**します", bodyFormat: "markdown" },
      "u_reviewer",
    );
    const after = await events("u_reviewer");
    expect(after.events.map((e: Json) => e.eventType)).toEqual(["created", "replied"]);
    expect(repliesOf(after)[0]).toMatchObject({
      id: before.id,
      payload: { body: "**補足**します", bodyFormat: "markdown" },
      edited: true,
      can: { edit: true },
    });
    // 他の人には訂正も削除もできる印が付かない
    expect(repliesOf(await events("u_creator"))[0].can).toEqual({ delete: false, edit: false });
    expect(
      await w.fail(
        "comments:editReply",
        { threadId, replyEventId: before.id, body: "x" },
        "u_creator",
      ),
    ).toMatchObject({ code: "comment_edit_not_author" });
    expect(
      await w.fail("comments:removeReply", { threadId, replyEventId: before.id }, "u_manager"),
    ).toMatchObject({ code: "comment_delete_not_author" });

    // 削除した返信は流れに並ばず、スレッドは生きたまま
    await w.call("comments:removeReply", { threadId, replyEventId: before.id }, "u_reviewer");
    expect(repliesOf(await events("u_reviewer"))).toEqual([]);
  });

  it("返信へのリアクションは集計（人数・自分・付けた人の名前）で載り、コメントのとは別。削除した返信には付けられない", async () => {
    const w = world();
    const { threadId } = await thread(w);
    await w.call("comments:reply", { threadId, body: "対応します" }, "u_creator");
    const events = (who: string) => w.call("comments:events", { threadId }, who);
    const [reply] = repliesOf(await events("u_reviewer"));
    for (const who of ["u_reviewer", "u_approver"])
      await w.call(
        "comments:toggleReaction",
        { threadId, replyEventId: reply.id, emoji: "🙏" },
        who,
      );

    const seen = repliesOf(await events("u_reviewer"))[0];
    expect(seen.reactions.map((r: Json) => [r.emoji, r.count, r.mine])).toEqual([["🙏", 2, true]]);
    expect(seen.reactions[0].users.map((u: Json) => u.name)).toEqual(["u_reviewer", "u_approver"]);
    expect(repliesOf(await events("u_manager"))[0].reactions[0].mine).toBe(false);
    // コメント本体（created）のリアクションには混ざらない
    expect((await events("u_reviewer")).events[0].reactions).toEqual([]);

    await w.call("comments:removeReply", { threadId, replyEventId: reply.id }, "u_creator");
    expect(
      await w.fail(
        "comments:toggleReaction",
        { threadId, replyEventId: reply.id, emoji: "👍" },
        "u_reviewer",
      ),
    ).toMatchObject({ code: "comment_reply_not_found" });
  });

  it("既読（readAt）・購読（subscribed）・採否の可否（canDecide）は閲覧者ごと。削除したコメントは履歴も返さない", async () => {
    const w = world();
    const { threadId } = await thread(w);
    const events = (who: string) => w.call("comments:events", { threadId }, who);
    expect((await events("u_creator")).readAt).toBeNull();
    expect((await events("u_creator")).subscribed).toBe(false);
    await w.call("comments:markRead", { threadId }, "u_creator");
    await w.call("comments:setSubscription", { threadId, on: true }, "u_creator");
    const read = await events("u_creator");
    expect(read.readAt).toEqual(expect.any(Number));
    expect(read.subscribed).toBe(true);
    expect((await events("u_approver")).readAt).toBeNull();
    // 採否を決められるのは決める権限のある人（制作者）だけ
    expect((await events("u_creator")).canDecide).toBe(true);
    expect((await events("u_reviewer")).canDecide).toBe(false);

    await w.call("comments:remove", { threadId }, "u_reviewer");
    const gone = await events("u_creator");
    expect(gone.events).toEqual([]);
    expect(gone.canDecide).toBe(false);
    expect((await w.fail("comments:events", { threadId: "nope" }, "u_creator")).status).toBe(403);
  });

  it("メンションした人・グループは mentionUsers に名前つきで並ぶ（グループの ID は group:…）", async () => {
    const w = world();
    const { threadId } = await thread(w);
    const reviewer = await idOf(w, "u_reviewer");
    const approver = await idOf(w, "u_approver");
    const groupId = await w.call(
      "groups:save",
      { name: "こうせいはん", memberIds: [reviewer, approver] },
      "u_admin",
    );
    await w.call(
      "comments:reply",
      { threadId, body: "@こうせいはん 見てください", mentions: [`group:${groupId}`, approver] },
      "u_creator",
    );
    const [reply] = repliesOf(await w.call("comments:events", { threadId }, "u_creator"));
    // 人（メンションの並び）の後ろに、グループ（group:…）が続く
    const named = reply.mentionUsers.map((u: Json) => [u.id, u.name]);
    expect(named.slice(0, 2)).toEqual(
      expect.arrayContaining([
        [reviewer, "u_reviewer"],
        [approver, "u_approver"],
      ]),
    );
    expect(named[2]).toEqual([`group:${groupId}`, "こうせいはん"]);
    expect(named).toHaveLength(3);
  });
});

describe("comments:carryCandidates", () => {
  it("前版の未解決の指摘が、投稿者の名前と版の呼び名つきで古い順に返る", async () => {
    const w = world();
    const { workId, revisionId } = await submittedRevision(w);
    const threadId = await w.call(
      "comments:post",
      { revisionId, body: "団体名が誤り", kind: "correction", severity: "info" },
      "u_reviewer",
    );
    const second = await uploadedSession(w, workId);
    const { revisionId: next } = await w.call(
      "submissions:confirm",
      { sessionId: second.sessionId },
      "u_creator",
    );
    const candidates = await w.call("comments:carryCandidates", { revisionId: next }, "u_creator");
    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({
      id: threadId,
      revisionLabel: "第1版",
      author: { id: await idOf(w, "u_reviewer"), name: "u_reviewer", email: null },
    });
  });
});

describe("comments:searchMentionCandidates", () => {
  it("名前が当たるグループは人より前（group:<id>・知らせる人数つき）、人は名前順", async () => {
    const w = world();
    const { workId } = await submittedRevision(w);
    const reviewer = await idOf(w, "u_reviewer");
    const approver = await idOf(w, "u_approver");
    const groupId = await w.call(
      "groups:save",
      { name: "こうせいはん", memberIds: [reviewer, approver] },
      "u_admin",
    );
    const candidates = await w.call(
      "comments:searchMentionCandidates",
      { workId, text: "コウセイ" },
      "u_creator",
    );
    expect(candidates).toEqual([
      { id: `group:${groupId}`, name: "こうせいはん", email: null, memberCount: 2 },
    ]);

    // 人の候補は名前順。グループの名前に当たらなければグループは出ない
    const people = await w.call(
      "comments:searchMentionCandidates",
      { workId, text: "u_" },
      "u_creator",
    );
    expect(people.map((p: Json) => p.name)).toEqual(people.map((p: Json) => p.name).sort());
    expect(people.map((p: Json) => p.name)).toEqual(
      expect.arrayContaining(["u_approver", "u_creator", "u_reviewer"]),
    );
    expect(people.every((p: Json) => !String(p.id).startsWith("group:"))).toBe(true);
    // 両方に当たるときはグループが先
    w.sql.exec(
      "UPDATE users SET doc = json_set(doc, '$.name', ?) WHERE id = ?",
      "こうせい太郎",
      reviewer,
    );
    const both = await w.call(
      "comments:searchMentionCandidates",
      { workId, text: "こうせい" },
      "u_creator",
    );
    expect(both.map((c: Json) => c.name)).toEqual(["こうせいはん", "こうせい太郎"]);
    expect(both[1]).toEqual({ id: reviewer, name: "こうせい太郎", email: null });
    expect(
      (await w.fail("comments:searchMentionCandidates", { workId: "nope", text: "" })).status,
    ).toBe(403);
  });
});

// ------------------------------------------------------------------ notation

describe("notation:ruleBook / ruleHistory / proposals（利用者の名前を引く読み）", () => {
  const category = {
    code: "B",
    name: "表記",
    description: "",
    parents: [],
    policyNotes: "",
    order: 1,
  };

  it("管理者は名前つきで返り、提案・承認・履歴に提案者・承認者・操作者の名前が付く", async () => {
    const w = world();
    const manager = await idOf(w, "u_manager");
    await w.call("notation:upsertCategory", category, "u_admin");
    await w.call(
      "notation:setManager",
      { userId: manager, categoryCode: "B", assigned: true },
      "u_admin",
    );
    const book = await w.call("notation:ruleBook", {}, "u_manager");
    expect(book.roles.B).toBe("manager");
    expect(book.managers).toHaveLength(1);
    expect(book.managers[0]).toMatchObject({
      userId: manager,
      user: { id: manager, name: "u_manager" },
    });

    const { workId } = await submittedRevision(w, { notationCategories: ["B"] });
    const proposed = await w.call(
      "notation:propose",
      {
        kind: "new",
        categoryCode: "B",
        title: "",
        correct: ["企画"],
        incorrect: ["出し物"],
        reason: "企画対応",
        context: { workId, quote: "出し物" },
      },
      "u_reviewer",
    );
    const open = await w.call("notation:proposals", { status: "open" }, "u_manager");
    expect(open).toHaveLength(1);
    expect(open[0]).toMatchObject({
      id: proposed.proposalId,
      canDecide: true,
      proposer: { name: "u_reviewer" },
      decider: null,
    });
    expect(await w.call("notation:proposals", { status: "approved" }, "u_manager")).toEqual([]);

    const decided = await w.call(
      "notation:decide",
      { proposalId: proposed.proposalId, decision: "approve" },
      "u_manager",
    );
    const all = await w.call("notation:proposals", { status: null }, "u_manager");
    expect(all[0]).toMatchObject({
      status: "approved",
      decider: { id: manager, name: "u_manager" },
    });
    const history = await w.call("notation:ruleHistory", { ruleId: decided.ruleId }, "u_reviewer");
    expect(history[0]).toMatchObject({
      operation: "proposal",
      actor: { name: expect.any(String) },
    });
    // 提案を承認した人の名前（actorId の解決）
    expect(history.map((h: Json) => h.actor.id)).toContain(manager);
  });
});

// ------------------------------------------------------------------ approvals / planInfo / push / submissions / home / artifacts / files / metrics

describe("approvals:confirmationStatus", () => {
  it("自己校了（制作者と校了者が同じ）は独立確認が要る。確認した人は名前つきで見える", async () => {
    const w = world();
    const creator = await idOf(w, "u_creator");
    const reviewer = await idOf(w, "u_reviewer");
    // 決定前に保存された行（制作者＝校了権限者）。登録ではこの形を作れないので、保存済みの行を直接書き換えて再現する
    const workId = await createWork(w);
    w.sql.exec(
      "UPDATE works SET doc = json_set(json_remove(doc, '$.approverIds', '$.approvalQuorum'), '$.approverId', ?) WHERE id = ?",
      creator,
      workId,
    );
    // 確認に参加できるのは、制作物の確認の権限（review の許可）を持つ人
    await w.call("acl:grant", { workId, userIds: [reviewer], permission: "review" }, "u_admin");
    const prepared = await uploadedSession(w, workId);
    const { revisionId } = await w.call(
      "submissions:confirm",
      { sessionId: prepared.sessionId },
      "u_creator",
    );

    expect(await w.call("approvals:confirmationStatus", { workId }, "u_reviewer")).toMatchObject({
      required: true,
      valid: null,
      canConfirm: true,
      confirmedByMe: false,
    });
    await w.call("approvals:confirm", { revisionId, note: "全体を確認" }, "u_reviewer");
    expect(await w.call("approvals:confirmationStatus", { workId }, "u_creator")).toEqual({
      required: true,
      requiredForMe: true,
      candidateRevisionId: revisionId,
      canConfirm: false,
      confirmedByMe: false,
      valid: {
        confirmer: { id: reviewer, name: "u_reviewer", email: null },
        confirmedAt: NOW,
        note: "全体を確認",
      },
    });
    expect((await w.fail("approvals:confirmationStatus", { workId: "nope" })).status).toBe(403);
  });
});

describe("planInfo:compare", () => {
  it("登録情報が無ければ空。あれば項目ごとの一致を返し、本文の入った照合も同期する", async () => {
    const w = world();
    const { workId } = await submittedRevision(w);
    expect(await w.call("planInfo:compare", { workId, text: "夏祭り" }, "u_reviewer")).toEqual({
      items: [],
    });
    await w.call(
      "works:update",
      { workId, patch: { registeredPlanInfo: { name: "夏祭り", venue: "体育館" } } },
      "u_manager",
    );
    const { items } = await w.call(
      "planInfo:compare",
      { workId, text: "夏祭りを校庭で" },
      "u_reviewer",
    );
    expect(items).toEqual([
      {
        field: "name",
        ok: true,
        registered: "夏祭り",
        excerpt: "夏祭り",
        message: expect.any(String),
      },
      {
        field: "venue",
        ok: false,
        registered: "体育館",
        message: expect.stringContaining("体育館"),
      },
    ]);
    // 照合は warn-only の bot スレッドを残す（planInfo:check と同じ同期）
    const threads = w.sql.exec(
      "SELECT count(*) AS n FROM threads WHERE json_extract(doc, '$.authorId') LIKE 'bot:%'",
    );
    expect(Number(threads[0]?.n)).toBeGreaterThan(0);
    expect((await w.fail("planInfo:compare", { workId: "nope", text: "" })).status).toBe(403);
  });
});

describe("push:config", () => {
  it("鍵（公開鍵・秘密鍵・連絡先）が揃えば公開鍵だけ返し、欠ければ null", async () => {
    expect(await world().call("push:config", {}, "u_creator")).toBeNull();
    expect(
      await world({ VAPID_PUBLIC_KEY: "pub", VAPID_PRIVATE_KEY: "priv" }).call(
        "push:config",
        {},
        "u_creator",
      ),
    ).toBeNull();
    const w = world({
      VAPID_PUBLIC_KEY: "pub",
      VAPID_PRIVATE_KEY: "priv",
      VAPID_SUBJECT: "mailto:ops@example.invalid",
    });
    expect(await w.call("push:config", {}, "u_creator")).toEqual({ publicKey: "pub" });
    expect((await w.fail("push:config", {}, null)).status).toBe(401);
  });
});

describe("submissions:get / home:submitTargets", () => {
  it("get は本人のセッションだけ（session と items）。他人・無いものは forbidden", async () => {
    const w = world();
    const workId = await createWork(w);
    const prepared = await uploadedSession(w, workId);
    const got = await w.call("submissions:get", { sessionId: prepared.sessionId }, "u_creator");
    expect(got.session).toMatchObject({
      id: prepared.sessionId,
      workId,
      submittedBy: await idOf(w, "u_creator"),
      state: "open",
    });
    expect(got.items).toHaveLength(1);
    expect(got.items[0]).toMatchObject({
      id: prepared.items[0]?.id,
      fileName: "a.pdf",
      status: "verified",
    });
    for (const who of ["u_manager", "u_reviewer"])
      expect(await w.fail("submissions:get", { sessionId: prepared.sessionId }, who)).toMatchObject(
        {
          status: 403,
          code: "forbidden",
        },
      );
    expect((await w.fail("submissions:get", { sessionId: "nope" }, "u_creator")).status).toBe(403);
  });

  it("submitTargets は自分が版を提出できる進行中の制作物だけ（制作者のみ・下書きは出ない）", async () => {
    const w = world();
    const workId = await createWork(w);
    await createWork(w, { title: "下書き", activate: false });
    const targets = await w.call("home:submitTargets", {}, "u_creator");
    expect(targets).toEqual([
      {
        workId,
        workTitle: "ポスター",
        mediaType: "pdf",
        route: "upload",
        deadlineAt: null,
        latestLabel: null,
        acceptingLabel: null,
      },
    ]);
    // 版を出すと最新の版の呼び名が付く
    const second = await uploadedSession(w, workId);
    await w.call("submissions:confirm", { sessionId: second.sessionId }, "u_creator");
    expect((await w.call("home:submitTargets", {}, "u_creator"))[0]).toMatchObject({
      latestLabel: "第1版",
      acceptingLabel: "第1版",
    });
    expect(await w.call("home:submitTargets", {}, "u_reviewer")).toEqual([]);
    expect(await w.call("home:submitTargets", {}, "u_stranger")).toEqual([]);
  });
});

describe("artifacts:authorizeAccess / commentFiles:authorizeFile（R2 の配信の認可）", () => {
  it("実体のある添付は objectKey・mimeType・fileName・size を返す。外部リンク・実体なし・無い添付は forbidden", async () => {
    const w = world();
    const { revisionId } = await submittedRevision(w);
    const [row] = w.sql.exec("SELECT id FROM artifacts WHERE revisionId = ?", revisionId);
    const artifactId = row!.id as string;
    expect(await w.call("artifacts:authorizeAccess", { artifactId }, "u_reviewer")).toEqual({
      objectKey: expect.any(String),
      mimeType: "application/pdf",
      fileName: "a.pdf",
      size: 10,
    });
    expect(
      await w.fail("artifacts:authorizeAccess", { artifactId: "nope" }, "u_reviewer"),
    ).toMatchObject({
      status: 403,
      code: "forbidden",
    });
    expect((await w.fail("artifacts:authorizeAccess", { artifactId }, null)).status).toBe(401);

    // 外部リンク（role=external）と、キーの無い添付は配信するものが無い
    w.sql.exec(
      "UPDATE artifacts SET doc = json_set(doc, '$.role', 'external') WHERE id = ?",
      artifactId,
    );
    expect(await w.fail("artifacts:authorizeAccess", { artifactId }, "u_reviewer")).toMatchObject({
      status: 403,
    });
    w.sql.exec(
      "UPDATE artifacts SET doc = json_remove(json_set(doc, '$.role', 'source'), '$.objectKey') WHERE id = ?",
      artifactId,
    );
    expect(await w.fail("artifacts:authorizeAccess", { artifactId }, "u_reviewer")).toMatchObject({
      status: 403,
    });
  });

  it("commentFiles:authorizeFile は検証済みの添付だけ。付ける前は上げた本人だけが読める", async () => {
    const w = world();
    const { revisionId } = await submittedRevision(w);
    const [prepared] = await w.call(
      "commentFiles:prepare",
      {
        revisionId,
        purpose: "comment",
        files: [{ fileName: "a.png", mimeType: "image/png", size: 10 }],
      },
      "u_reviewer",
    );
    const fileId = prepared.fileId as string;
    expect(
      await w.fail("commentFiles:authorizeFile", { fileId, variant: "original" }, "u_reviewer"),
    ).toMatchObject({ code: "comment_file_not_ready" });
    const begun = await w.call("commentFiles:beginFileUpload", { fileId }, "u_reviewer", KEY);
    await w.call(
      "commentFiles:completeFileUpload",
      { attemptId: begun.attemptId, size: 10, sha256: "abc" },
      "u_reviewer",
      KEY,
    );
    expect(
      await w.call("commentFiles:authorizeFile", { fileId, variant: "original" }, "u_reviewer"),
    ).toMatchObject({
      objectKey: expect.any(String),
      mimeType: "image/png",
      fileName: "a.png",
      size: 10,
    });
    expect(
      await w.fail("commentFiles:authorizeFile", { fileId, variant: "original" }, "u_creator"),
    ).toMatchObject({ status: 403, code: "forbidden" });
  });
});

describe("workMetrics:counts", () => {
  it("年ごとの制作物の数を状態別に、決まった順で返す（ready は常に true）", async () => {
    const w = world();
    await createWork(w);
    await createWork(w);
    await createWork(w, { activate: false });
    await createWork(w, { year: 99 });
    const lifecycles = ["draft", "active", "on_hold", "finalized", "cancelled"];
    expect(await w.call("workMetrics:counts", { year: 100 }, "u_stranger")).toEqual({
      ready: true,
      counts: lifecycles.map((lifecycle, i) => ({ lifecycle, count: [1, 2, 0, 0, 0][i] })),
    });
    expect((await w.call("workMetrics:counts", { year: 101 }, "u_stranger")).counts).toEqual(
      lifecycles.map((lifecycle) => ({ lifecycle, count: 0 })),
    );
    expect((await w.fail("workMetrics:counts", { year: 100 }, null)).status).toBe(401);
  });
});
