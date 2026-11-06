import { describe, expect, it } from "vite-plus/test";
import { latestSnapshot, migrateCollab, stepsAfter } from "./collab/store.ts";
import { importChunk, importRows, importSnapshot, resetKeyless } from "./migrate/import.ts";
import { convertExport, STORAGE, type ConvexDoc } from "./migrate/plan.ts";
import { importApp, type ImportStore } from "./migrate/route.ts";
import { verifySnapshot } from "./migrate/verify.ts";
import { createSqliteContext } from "./sqlite/context.ts";
import { migrate } from "./sqlite/schema.ts";
import type { Sql } from "./sqlite/sql.ts";
import { substringQuery } from "./sqlite/workSearch.ts";
import { nodeSql } from "./testing/context.ts";
import { app, fakeDb, post } from "./testing/http.ts";

/**
 * Convex の export の代わり（apps/convex/convex/seed.ts の形）。場所 → 行。
 * 本番にも Convex にも触れない、手元の偽データだけで確かめる。
 */
const T0 = Date.UTC(2026, 9, 1);
const id = (kind: string, n: number) => `${kind}${n}`;
const row = (n: number, doc: Record<string, unknown>): ConvexDoc =>
  ({ _id: String(doc._id), _creationTime: T0 + n, ...doc }) as ConvexDoc;

const ADMIN = id("user", 1);
const MANAGER = id("user", 2);
const CREATOR = id("user", 3);
const REVIEWER = id("user", 4);
const APPROVER = id("user", 5);
const LEGACY = id("user", 6);
const GHOST = id("user", 7);
const WORK = id("work", 1);
const WORK2 = id("work", 2);
const REV = id("rev", 1);
const THREAD = id("thread", 1);

function convexExport(): Map<string, ConvexDoc[]> {
  const user = (n: number, sub: string | undefined, extra: Record<string, unknown> = {}) =>
    row(n, { _id: id("user", n), ...(sub ? { nogikuSubject: sub } : {}), ...extra });
  return new Map<string, ConvexDoc[]>([
    [
      "users",
      [
        user(1, "mock-nogiku-admin", {
          name: "五月 管理",
          hurigana: "さつき かんり",
          email: "admin@example.invalid",
          isSystemAdmin: true,
          source: "nogiku_mock",
          image: "https://example.invalid/a.png",
          emailVerificationTime: 1,
        }),
        user(2, "mock-nogiku-manager", { name: "五月 主管", hurigana: "さつき しゅかん" }),
        user(3, "mock-nogiku-creator", { name: "五月 めい", hurigana: "さつき めい" }),
        user(4, "mock-nogiku-reviewer", { name: "本郷 校正" }),
        user(5, "mock-nogiku-approver", { name: "駒場 校了" }),
        // subject は auth の accounts にだけある行
        user(6, undefined, { name: "古い 利用者" }),
        // 一度もサインインしていない行
        user(7, undefined, { name: "幽霊" }),
      ],
    ],
    [
      "authAccounts",
      [
        row(1, {
          _id: "acc1",
          userId: LEGACY,
          provider: "nogiku",
          providerAccountId: "sub-legacy",
        }),
        row(2, { _id: "acc2", userId: CREATOR, provider: "nogiku", providerAccountId: "ignored" }),
      ],
    ],
    ["authSessions", [row(1, { _id: "sess1", userId: CREATOR })]],
    [
      "works",
      [
        // 追加順の確認のため、_creationTime の昇順と逆に並べておく
        row(20, {
          _id: WORK2,
          legacyId: "WEB-003",
          year: 100,
          title: "Web 原稿",
          purpose: "公式サイト",
          category: "webデザイン",
          mediaType: "figma",
          productionTeamIds: [],
          relatedTeamIds: [],
          managerIds: [MANAGER],
          creatorIds: [CREATOR],
          approverId: APPROVER,
          lifecycle: "active",
          version: 1,
          rolesVersion: 1,
          searchVersion: 1,
          aggregateVersion: 1,
          driveFolderUrl: "https://example.invalid/drive",
        }),
        row(10, {
          _id: WORK,
          legacyId: "PR-001",
          year: 100,
          title: "MF100 パンフレット",
          purpose: "来場者向け案内",
          category: "印刷物",
          mediaType: "pdf",
          productionTeamIds: [],
          relatedTeamIds: [],
          managerIds: [MANAGER],
          creatorIds: [CREATOR],
          approverId: APPROVER,
          approverIds: [APPROVER, MANAGER],
          approvalQuorum: 1,
          deadlineAt: T0 + 86_400_000,
          lifecycle: "active",
          version: 1,
          rolesVersion: 1,
          searchVersion: 1,
        }),
      ],
    ],
    // 派生表: 移さず、取り込み後に作り直す
    ["workRoles", [row(1, { _id: "role1", workId: WORK, userId: GHOST, role: "creator" })]],
    ["workSummaries", [row(1, { _id: "sum1", workId: WORK, latestId: null })]],
    ["workSearch", [row(1, { _id: "ws1", workId: WORK, searchTokens: "x", year: 100 })]],
    ["notificationCounters", [row(1, { _id: "nc1", userId: CREATOR, unread: 99 })]],
    [
      "workPermissions",
      [
        row(1, {
          _id: "perm1",
          workId: WORK,
          principalType: "user",
          principalId: REVIEWER,
          permission: "review",
          grantedBy: ADMIN,
          grantedAt: T0,
        }),
      ],
    ],
    [
      "revisions",
      [
        row(30, {
          _id: REV,
          workId: WORK,
          kind: "standard",
          sequence: 1,
          reviewType: "general",
          submittedBy: CREATOR,
          submittedAt: T0,
          deadlineAt: T0 + 3_600_000,
          reviewState: "open",
          changeSummary: "第 1 版",
          focusNotes: "",
          // 古い数え方（取り込み後に作り直す）
          threadCount: 0,
          unresolvedCount: 0,
          openBotCount: 0,
        }),
      ],
    ],
    [
      "reviewAssignments",
      [
        row(1, {
          _id: "as1",
          revisionId: REV,
          reviewerId: REVIEWER,
          reviewType: "general",
          state: "pending",
        }),
      ],
    ],
    [
      "commentThreads",
      [
        row(40, {
          _id: THREAD,
          revisionId: REV,
          authorId: REVIEWER,
          body: "誤字があります",
          kind: "correction",
          severity: "minor",
          resolution: "open",
          createdAt: T0 + 40,
        }),
      ],
    ],
    [
      "commentEvents",
      [
        row(41, {
          _id: id("event", 1),
          threadId: THREAD,
          eventType: "created",
          actorId: REVIEWER,
          createdAt: T0 + 40,
        }),
        row(42, {
          _id: id("event", 2),
          threadId: THREAD,
          eventType: "replied",
          actorId: CREATOR,
          payload: { body: "直します" },
          createdAt: T0 + 42,
        }),
      ],
    ],
    // 同じ (利用者, スレッド) が 2 行: 後の行が勝つ
    [
      "commentReads",
      [
        row(1, { _id: "read1", userId: CREATOR, threadId: THREAD, readAt: T0 + 50 }),
        row(2, { _id: "read2", userId: CREATOR, threadId: THREAD, readAt: T0 + 60 }),
      ],
    ],
    [
      "threadSubscriptions",
      [row(1, { _id: "sub1", userId: REVIEWER, threadId: THREAD, subscribedAt: T0 })],
    ],
    [
      "documentDrafts",
      [
        row(1, {
          _id: "doc1",
          workId: WORK,
          title: "本文",
          content: "{}",
          text: "本文",
          version: 1,
          updatedBy: CREATOR,
          updatedAt: T0,
        }),
      ],
    ],
    [
      "notifications",
      [
        row(1, {
          _id: "n1",
          recipientId: CREATOR,
          kind: "comment",
          title: "コメント",
          body: "",
          createdAt: T0,
        }),
        row(2, {
          _id: "n2",
          recipientId: CREATOR,
          kind: "comment",
          title: "コメント 2",
          body: "",
          createdAt: T0 + 1,
          readAt: T0 + 2,
        }),
      ],
    ],
    [
      "notificationPrefs",
      [row(1, { _id: "p1", userId: CREATOR, showPreview: true, mutedCategories: [] })],
    ],
    [
      "slackMembers",
      [
        row(1, {
          _id: "sm1",
          teamId: "T1",
          email: "a@example.invalid",
          state: "found",
          memberId: "U1",
          checkedAt: T0,
        }),
      ],
    ],
    ["workPins", [row(1, { _id: "pin1", userId: CREATOR, workId: WORK, pinnedAt: T0 })]],
    [
      "ruleCategories",
      [
        row(1, {
          _id: "cat1",
          code: "B",
          name: "企画対応",
          description: "",
          parents: [],
          policyNotes: "",
          order: 1,
        }),
      ],
    ],
    [
      "notationRules",
      [
        row(1, {
          _id: "rule1",
          ruleId: "r-1",
          categoryCode: "B",
          revision: 1,
          enabled: true,
          title: "表記",
        }),
      ],
    ],
    [
      "ruleRevisions",
      [
        row(1, {
          _id: "rr1",
          ruleId: "r-1",
          revision: 1,
          operation: "create",
          actorId: ADMIN,
          at: T0,
        }),
      ],
    ],
    [
      "ruleCategoryManagers",
      [
        row(1, {
          _id: "mg1",
          userId: MANAGER,
          categoryCode: "B",
          assignedBy: ADMIN,
          assignedAt: T0,
        }),
      ],
    ],
    ["auditEvents", [row(1, { _id: "au1", actorId: ADMIN, action: "seed", at: T0 })]],
    [
      "idempotencyKeys",
      [
        row(1, {
          _id: "idem1",
          scope: "works:create",
          key: "k1",
          result: id("work", 1),
          createdAt: T0,
        }),
      ],
    ],
    // 共同編集（component）。delta の version は塊の最後の版
    [
      "_components/prosemirrorSync/snapshots",
      [row(1, { _id: "snap1", id: WORK, version: 1, content: '{"type":"doc"}' })],
    ],
    [
      "_components/prosemirrorSync/deltas",
      [row(1, { _id: "delta1", id: WORK, version: 3, clientId: "c1", steps: ["s2", "s3"] })],
    ],
    ["collaborativeDrafts", [row(1, { _id: "cd1", workId: WORK, snapshotVersion: 1 })]],
    // 捨てる表
    ["_components/presence/rooms", [row(1, { _id: "pr1", roomId: WORK })]],
    ["_components/rateLimiter/rateLimits", [row(1, { _id: "rl1" })]],
    ["aiJobs", [row(1, { _id: "ai1", workId: WORK })]],
    ["dashboardLayouts", [row(1, { _id: "dl1", userId: CREATOR })]],
  ]);
}

/** 移行先と同じ表を持つ、メモリ上の SQLite */
function target(): Sql {
  const sql = nodeSql();
  migrate(sql);
  migrateCollab(sql);
  return sql;
}

const converted = () => convertExport(convexExport());

/** 表の中身を並びごと取り出す（冪等・順序の比較用） */
function dump(sql: Sql): Record<string, unknown[]> {
  const out: Record<string, unknown[]> = {};
  for (const [table, storage] of Object.entries(STORAGE)) {
    const columns =
      storage.kind === "raw" ? "*" : storage.kind === "keyless" ? "rowid, doc" : "rowid, id, doc";
    out[table] = sql.exec(`SELECT ${columns} FROM ${table} ORDER BY rowid`);
  }
  return out;
}

describe("convertExport（表の対応表）", () => {
  it("Convex の _id を id として残し、Convex にだけある項目は落とす", () => {
    const { rows } = converted();
    const work = rows.find((r) => r.table === "works" && r.doc.id === WORK)!.doc;
    expect(work).toMatchObject({
      id: WORK,
      title: "MF100 パンフレット",
      approverIds: [APPROVER, MANAGER],
    });
    for (const gone of ["_id", "_creationTime", "rolesVersion", "searchVersion", "driveFolderUrl"])
      expect(work).not.toHaveProperty(gone);
    // 参照はそのまま文字列
    expect(rows.find((r) => r.table === "revisions")!.doc).toMatchObject({ id: REV, workId: WORK });
  });

  it("users: _id を id に、subject は nogikuSubject か auth の accounts から。名前は auth/store.ts と同じ形", () => {
    const { rows, skipped } = converted();
    const users = rows.filter((r) => r.table === "users");
    expect(users.map((u) => u.id)).toEqual([ADMIN, MANAGER, CREATOR, REVIEWER, APPROVER, LEGACY]);
    expect(users[0]!.doc).toEqual({
      subject: "mock-nogiku-admin",
      source: "nogiku_mock",
      isSystemAdmin: true,
      // 表示名はふりがな、漢字は nameKanji に残る
      name: "さつき かんり",
      nameKanji: "五月 管理",
      email: "admin@example.invalid",
      picture: "https://example.invalid/a.png",
      hurigana: "さつき かんり",
    });
    // ふりがなが無い人の表示名は漢字
    expect(users[3]!.doc).toMatchObject({ name: "本郷 校正", nameKanji: "本郷 校正" });
    // nogikuSubject が優先（accounts の "ignored" ではない）
    expect(users[2]!.doc.subject).toBe("mock-nogiku-creator");
    expect(users[5]!.doc.subject).toBe("sub-legacy");
    expect(skipped["users: no-subject"]).toEqual({ count: 1, examples: [GHOST] });
  });

  it("移す・捨てる・作り直すを分け、対応表に無い場所は unknown に出す", () => {
    const r = converted();
    expect(r.dropped).toMatchObject({
      authAccounts: 2,
      authSessions: 1,
      aiJobs: 1,
      dashboardLayouts: 1,
      "_components/presence/rooms": 1,
      "_components/rateLimiter/rateLimits": 1,
    });
    expect(r.rebuilt.sort()).toEqual([
      "notificationCounters",
      "workRoles",
      "workSearch",
      "workSummaries",
    ]);
    expect(r.rows.some((x) => ["workRoles", "workSummaries", "workSearch"].includes(x.table))).toBe(
      false,
    );
    expect(r.unknown).toEqual([]);

    const more = convexExport();
    more.set("someNewTable", [row(1, { _id: "x1" })]);
    expect(convertExport(more).unknown).toEqual(["someNewTable"]);
  });

  it("同じ表の中は _creationTime の昇順、同じ主キーは後の行が勝つ", () => {
    const { rows, counts, skipped } = converted();
    expect(rows.filter((r) => r.table === "works").map((r) => r.doc.id)).toEqual([WORK, WORK2]);
    expect(rows.find((r) => r.table === "commentReads")).toMatchObject({
      id: `${CREATOR}|${THREAD}`,
      doc: { at: T0 + 60 },
    });
    expect(counts.commentReads).toBe(1);
    expect(Object.keys(skipped).some((k) => k.startsWith("commentReads: duplicate-key"))).toBe(
      true,
    );
  });

  it("共同編集の delta は 1 ステップ 1 行（version はそのステップの後の版）", () => {
    const steps = converted().rows.filter((r) => r.table === "collabSteps");
    expect(steps.map((s) => s.doc)).toEqual([
      { docId: WORK, version: 2, step: "s2", clientId: "c1" },
      { docId: WORK, version: 3, step: "s3", clientId: "c1" },
    ]);
  });
});

describe("importSnapshot（取り込み）", () => {
  it("createSqliteContext で読める。自然キー・読んだ印・割り当て・権限・埋め込みでない共同編集", async () => {
    const sql = target();
    const { counts, skipped } = importSnapshot(sql, converted().rows);
    expect(counts).toMatchObject({ users: 6, works: 2, revisions: 1, grants: 1, collabSteps: 2 });
    expect(skipped).toEqual({});

    const ctx = createSqliteContext(sql, { clock: { now: () => T0 } });
    expect(await ctx.people.displayName(CREATOR)).toBe("さつき めい");
    expect((await ctx.works.findById(WORK))?.title).toBe("MF100 パンフレット");
    expect((await ctx.works.list(10)).map((w) => w.id)).toEqual([WORK, WORK2]);
    // 自然キーが Cloudflare の keyOf と同じ（読み出しで確かめる）
    expect(await ctx.threads.readAt(CREATOR, THREAD)).toBe(T0 + 60);
    expect(await ctx.threads.isSubscribed(REVIEWER, THREAD)).toBe(true);
    expect(await ctx.assignments.find(REV, REVIEWER)).toMatchObject({ state: "pending" });
    expect((await ctx.acl.listByWork(WORK))[0]).toMatchObject({ principalId: REVIEWER });
    expect(await ctx.notificationPrefs.find(CREATOR)).toMatchObject({ showPreview: true });
    expect(await ctx.slackMembers.find("T1", "a@example.invalid")).toMatchObject({
      state: "found",
    });
    expect((await ctx.home.listPins(CREATOR))[0]).toMatchObject({ workId: WORK });
    expect((await ctx.notation.listRevisions("r-1")).length).toBe(1);
    expect((await ctx.notation.listManagers())[0]).toMatchObject({ userId: MANAGER });
    expect((await ctx.threads.listEvents(THREAD)).map((e) => e.eventType)).toEqual([
      "created",
      "replied",
    ]);
    expect((await ctx.idempotency.get("works:create", "k1"))?.result).toBe(WORK);

    // 共同編集: collab/store.ts の読みで同じ版の並びになる
    expect(latestSnapshot(sql, WORK)).toEqual({ content: '{"type":"doc"}', version: 1 });
    expect(stepsAfter(sql, WORK, 1)).toEqual({ steps: ["s2", "s3"], clientIds: ["c1", "c1"] });
    expect(sql.exec("SELECT snapshotVersion, enabledBy FROM collaborativeDrafts")).toEqual([
      { snapshotVersion: 1, enabledBy: "convex-migration" },
    ]);
  });

  it("派生表（職責・検索・要約・版のスレッド件数・未読の数）は取り込み後に元の行から作り直す", async () => {
    const sql = target();
    importSnapshot(sql, converted().rows);
    // Convex の古い行（GHOST の職責・99 の未読・既存の要約）は持ち込まれない
    const roles = sql
      .exec("SELECT id FROM workRoles WHERE workId = ? ORDER BY id", WORK)
      .map((r) => r.id);
    expect(roles).toEqual(
      [
        `${WORK}|approver|${APPROVER}`,
        `${WORK}|approver|${MANAGER}`,
        `${WORK}|creator|${CREATOR}`,
        `${WORK}|manager|${MANAGER}`,
      ].sort(),
    );
    expect(sql.exec("SELECT count(*) AS n FROM workSummaries")[0]!.n).toBe(2);
    expect(sql.exec("SELECT count(*) AS n FROM workSearch")[0]!.n).toBe(2);
    expect(
      sql.exec("SELECT workId FROM workSearch WHERE workSearch MATCH ?", substringQuery("パンフ")),
    ).toEqual([{ workId: WORK }]);
    // 版: 取り込んだ行は 0 件だったが、スレッドから数え直す
    expect(JSON.parse(sql.exec("SELECT doc FROM revisions")[0]!.doc as string)).toMatchObject({
      threadCount: 1,
      unresolvedCount: 1,
    });
    const ctx = createSqliteContext(sql, { clock: { now: () => T0 } });
    expect(await ctx.notifications.countUnread(CREATOR)).toBe(1);
    expect(sql.exec("SELECT doc FROM notificationCounters")).toEqual([
      { doc: JSON.stringify({ userId: CREATOR, unread: 1 }) },
    ]);
    expect((await ctx.workSummaries.findByWork(WORK))?.threads).toMatchObject({
      unresolved: 1,
      total: 1,
    });
  });

  it("2 回取り込んでも、件数・中身・並び（rowid）が同じ", () => {
    const sql = target();
    const rows = converted().rows;
    const first = importSnapshot(sql, rows);
    const before = dump(sql);
    const second = importSnapshot(sql, rows);
    expect(second).toEqual(first);
    expect(dump(sql)).toEqual(before);
    // 派生表も同じ件数のまま（重ならない）
    expect(sql.exec("SELECT count(*) AS n FROM workRoles")[0]!.n).toBe(7);
  });

  it("本線の関数（HTTP の works:get）で、移した利用者が自分の制作物を読める", async () => {
    const db = fakeDb();
    importSnapshot(db.sql, converted().rows);
    const a = app(db);
    // サインインの subject が、移した users.id に当たる（新しい利用者を作らない）
    const res = await post(a, "works:get", { workId: WORK }, "mock-nogiku-creator");
    expect(res.status).toBe(200);
    const detail = ((await res.json()) as { value: Record<string, any> }).value;
    expect(detail.work).toMatchObject({
      id: WORK,
      title: "MF100 パンフレット",
      creatorIds: [CREATOR],
    });
    expect(detail.revisions).toHaveLength(1);
    expect(detail.revisions[0]).toMatchObject({ id: REV, unresolvedCount: 1 });
    expect(detail.people.creators.map((u: { id: string }) => u.id)).toEqual([CREATOR]);
    expect(db.sql.exec("SELECT count(*) AS n FROM users")[0]!.n).toBe(6);
    // 通知の未読
    const unread = await post(a, "notifications:unreadCount", {}, "mock-nogiku-creator");
    expect(((await unread.json()) as { value: number }).value).toBe(1);
  });

  it("subject を別の id で先に持つ行は、その 1 行だけ避けて、ほかは入れる", () => {
    const sql = target();
    sql.exec(
      "INSERT INTO users (id, doc) VALUES (?, ?)",
      "random-uuid",
      JSON.stringify({ subject: "mock-nogiku-creator" }),
    );
    const { skipped, counts } = importSnapshot(sql, converted().rows);
    expect(skipped["users: subject-taken-by-other-id"]).toEqual({ count: 1, examples: [CREATOR] });
    expect(counts.users).toBe(5);
  });

  it("知らない表・壊れた行・許可表に無い列は書かずに数える", () => {
    const sql = target();
    const { counts, skipped } = importRows(sql, [
      { table: "nope; DROP TABLE users", doc: {} },
      { table: "works", doc: { title: "id が無い" } },
      { table: "collabSnapshots", doc: { docId: "d", version: 1, content: "x", "evil) --": 1 } },
      { table: "teams", doc: { id: "t1", name: "広報局" } },
    ]);
    expect(counts).toEqual({ teams: 1 });
    expect(Object.keys(skipped).sort()).toEqual([
      "collabSnapshots: bad-column",
      "nope; DROP TABLE users: unknown-table",
      "works: no-id",
    ]);
    expect(sql.exec("SELECT count(*) AS n FROM users")[0]!.n).toBe(0);
  });
});

describe("verifySnapshot（本番の前の確認）", () => {
  it("整合した取り込みは問題 0 件", () => {
    const sql = target();
    const r = converted();
    importSnapshot(sql, r.rows);
    expect(verifySnapshot(sql, r.counts)).toEqual([]);
  });

  it("users から欠けた人を指す制作物・割り当て・権限の参照を見つける", () => {
    const sql = target();
    const withoutReviewer = converted().rows.filter((r) => r.id !== REVIEWER);
    importSnapshot(sql, withoutReviewer);
    const refs = verifySnapshot(sql).filter((p) => p.check === "ref");
    expect(refs.map((p) => `${p.table}.${p.detail}`).sort()).toEqual([
      `assignments.reviewerId の ${REVIEWER} が users に無い`,
      `grants.principalId の ${REVIEWER} が users に無い`,
      `threadSubscriptions.userId の ${REVIEWER} が users に無い`,
    ]);
  });

  it("works の creatorIds / approverId が users に無いとき、その制作物の ID を挙げる", () => {
    const sql = target();
    importSnapshot(sql, converted().rows);
    sql.exec("DELETE FROM users WHERE id IN (?, ?)", CREATOR, APPROVER);
    const refs = verifySnapshot(sql).filter((p) => p.check === "ref" && p.table === "works");
    expect(refs.map((p) => `${p.id} ${p.detail.split(" ")[0]}`).sort()).toEqual(
      [
        `${WORK} creatorIds`,
        `${WORK} approverId`,
        `${WORK} approverIds`,
        `${WORK2} creatorIds`,
        `${WORK2} approverId`,
      ].sort(),
    );
  });

  it("件数の食い違い・subject の欠け・進行中の仕事・要約の欠けも出す", () => {
    const sql = target();
    const r = converted();
    importSnapshot(sql, r.rows);
    sql.exec("INSERT INTO users (id, doc) VALUES ('nosub', '{}')");
    sql.exec(
      "INSERT INTO processingJobs (id, doc) VALUES ('job1', ?)",
      JSON.stringify({ id: "job1", state: "running" }),
    );
    sql.exec("DELETE FROM workSummaries WHERE id = ?", WORK);
    sql.exec("DELETE FROM teams");
    const problems = verifySnapshot(sql, { ...r.counts, works: 3 });
    expect(problems.map((p) => p.check).sort()).toEqual([
      "count",
      "count",
      "derived",
      "inflight",
      "subject",
    ]);
    // users は subject の無い行を足したので 7、works は 3 と言い張ったので 2
    expect(problems.filter((p) => p.check === "count").map((p) => p.table)).toEqual([
      "users",
      "works",
    ]);
  });
});

describe("POST /internal/import（分けて送る）", () => {
  const SECRET = "cleanup-secret-0123456789";
  const bearer = (s: string) => ({
    Authorization: `Bearer ${s}`,
    "Content-Type": "application/json",
  });

  function setup() {
    const sql = target();
    const calls: string[] = [];
    const store: ImportStore = {
      importRows: async (rows, options) => {
        calls.push(
          `${rows.length}:${options.begin ? "begin" : ""}${options.finish ? "finish" : ""}`,
        );
        return importChunk(sql, rows, options);
      },
    };
    const a = importApp({ store: () => store, secret: () => SECRET });
    const send = (body: unknown, secret = SECRET) =>
      a.request("/internal/import", {
        method: "POST",
        headers: bearer(secret),
        body: JSON.stringify(body),
      });
    return { sql, a, send, calls };
  }

  it("秘密が無い・違うなら 404、body が壊れていれば 400", async () => {
    const { send, a } = setup();
    expect((await send({ rows: [] }, "wrong-secret-0123456789")).status).toBe(404);
    expect((await a.request("/internal/import", { method: "POST", body: "{}" })).status).toBe(404);
    expect((await send({})).status).toBe(400);
    const broken = await a.request("/internal/import", {
      method: "POST",
      headers: bearer(SECRET),
      body: "{",
    });
    expect(broken.status).toBe(400);
  });

  it("塊に分けて送っても、最後の finish で派生表と確認が揃い、1 回で入れたのと同じになる", async () => {
    const { sql, send, calls } = setup();
    const r = converted();
    const chunks = [r.rows.slice(0, 10), r.rows.slice(10, 20), r.rows.slice(20)];
    let last: any;
    for (const [i, rows] of chunks.entries()) {
      const res = await send({
        rows,
        begin: i === 0,
        finish: i === chunks.length - 1,
        ...(i === chunks.length - 1 ? { expected: r.counts } : {}),
      });
      expect(res.status).toBe(200);
      last = await res.json();
    }
    expect(calls).toEqual(["10:begin", "10:", `${r.rows.length - 20}:finish`]);
    expect(last.verify.problemCount).toBe(0);
    expect(last.verify.tables).toMatchObject({ users: 6, works: 2, workSummaries: 2 });

    const once = target();
    importSnapshot(once, r.rows);
    expect(dump(sql)).toEqual(dump(once));

    // 流し直しても同じ（begin が keyless を空にしてから入れる）
    await send({ rows: r.rows, begin: true, finish: true });
    expect(dump(sql)).toEqual(dump(once));
  });

  it("createApp に組み込んだ口も同じ道を通る（Durable Object の importRows 越し）。秘密が未設定なら 404", async () => {
    const db = fakeDb();
    const secrets: Record<string, string> = { MF100_IMPORT_SECRET: SECRET };
    const a = app(db, secrets);
    const r = converted();
    const send = (a2: typeof a, secret = SECRET) =>
      a2.request("/internal/import", {
        method: "POST",
        headers: bearer(secret),
        body: JSON.stringify({ rows: r.rows, begin: true, finish: true, expected: r.counts }),
      });
    const res = await send(a);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { verify: { problemCount: number } };
    expect(body.verify.problemCount).toBe(0);
    const once = target();
    importSnapshot(once, r.rows);
    expect(dump(db.sql)).toEqual(dump(once));

    expect((await send(a, "wrong-secret-0123456789")).status).toBe(404);
    expect((await send(app(fakeDb(), {}))).status).toBe(404);
  });

  it("resetKeyless は keyless の表だけを空にする", () => {
    const sql = target();
    importSnapshot(sql, converted().rows);
    resetKeyless(sql);
    expect(sql.exec("SELECT count(*) AS n FROM grants")[0]!.n).toBe(0);
    expect(sql.exec("SELECT count(*) AS n FROM audit")[0]!.n).toBe(0);
    expect(sql.exec("SELECT count(*) AS n FROM works")[0]!.n).toBe(2);
  });
});
