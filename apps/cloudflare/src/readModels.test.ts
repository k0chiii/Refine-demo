import { describe, expect, it } from "vite-plus/test";
import type { Principal } from "@mf100/domain";
import type { FnCtx } from "./functions/define.ts";
import { listWorksRelatedTo } from "./functions/workList.ts";
import { app, fakeDb, post, signIn, UPLOAD_SECRET } from "./testing/http.ts";

// Convex の読み取りモデルのテスト（works.get.threadStats / revisionsGet / workSearch / workSummary / worksRowMenu ほか）の期待を、
// HTTP から 1 周して写す。戻りは Convex と同じ形かを見るので、型は付けずに値だけ引く

// oxlint-disable-next-line typescript/no-explicit-any
type Json = any;

const HOUR = 3_600_000;
const T0 = Date.UTC(2026, 10, 1);
const KEY = { "X-MF100-Service-Key": UPLOAD_SECRET };

function world() {
  const db = fakeDb(undefined, { MF100_SYSTEM_ADMIN_SUBJECTS: "u_admin" });
  const a = app(db);
  const call = async (
    name: string,
    args: unknown,
    subject = "u_manager",
    headers: Record<string, string> = {},
  ): Promise<Json> => {
    const res = await post(a, name, args, subject, headers);
    const body = (await res.json()) as { value?: unknown };
    expect(res.status, `${name}: ${JSON.stringify(body)}`).toBe(200);
    return body.value;
  };
  const fail = async (name: string, args: unknown, subject = "u_manager") => {
    const res = await post(a, name, args, subject);
    return { status: res.status, ...((await res.json()) as { code?: string }) };
  };
  return { a, db, call, fail, sql: db.sql };
}
type World = ReturnType<typeof world>;

async function cast(w: World) {
  const [creator, approver, reviewer, manager, stranger, admin] = await Promise.all(
    ["u_creator", "u_approver", "u_reviewer", "u_manager", "u_stranger", "u_admin"].map((s) =>
      signIn(w.a, s),
    ),
  );
  return {
    creator: creator!,
    approver: approver!,
    reviewer: reviewer!,
    manager: manager!,
    stranger: stranger!,
    admin: admin!,
  };
}
type Cast = Awaited<ReturnType<typeof cast>>;

/** 制作物を登録する（進行中。既定は校正者 1 人） */
async function createWork(w: World, c: Cast, over: Record<string, unknown> = {}): Promise<string> {
  return w.call("works:create", {
    title: "ポスター",
    purpose: "告知",
    category: "印刷物",
    mediaType: "pdf",
    year: 100,
    creatorIds: [c.creator],
    approverId: c.approver,
    reviewerIds: [c.reviewer],
    activate: true,
    ...over,
  });
}

/** 版を 1 つ提出する（準備 → 実体の検証 → 確定）。締切は今から hours 時間後 */
async function submit(w: World, workId: string, hours = 48): Promise<string> {
  const prepared = await w.call(
    "submissions:prepare",
    {
      workId,
      kind: "standard",
      reviewType: "general",
      deadlineAt: w.db.clock.current + hours * HOUR,
      changeSummary: "提出",
      focusNotes: "配色",
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
  const confirmed = await w.call(
    "submissions:confirm",
    { sessionId: prepared.sessionId },
    "u_creator",
  );
  return confirmed.revisionId;
}

const comment = (
  w: World,
  revisionId: string,
  body: string,
  extra: object = {},
  who = "u_reviewer",
) =>
  w.call(
    "comments:post",
    { revisionId, body, kind: "correction", severity: "major", ...extra },
    who,
  );

/** 制作物の版のうち、いちばん新しいものの ID */
async function latestRevision(w: World, workId: string): Promise<string> {
  const detail = await w.call("works:get", { workId }, "u_manager");
  return detail.revisions[0].id;
}

/** 同じ時刻の動きは「未読」の前後が付かないので、時計を進める */
const tick = (w: World, ms = 1000) => void (w.db.clock.current += ms);

describe("works:get（制作物詳細）", () => {
  it("版の指摘件数（派生の数え直し）・専門確認の未完了・can・既定で開く版の添付・people", async () => {
    const w = world();
    const c = await cast(w);
    const workId = await createWork(w, c);
    // 版が無い間は既定の添付も無い
    expect((await w.call("works:get", { workId }, "u_reviewer")).defaultArtifacts).toBeNull();
    const revisionId = await submit(w, workId);
    const a = await comment(w, revisionId, "誤字");
    await comment(w, revisionId, "表記ゆれ");
    await comment(w, revisionId, "配色");
    tick(w);
    await w.call("comments:decide", { threadId: a, action: "resolved" }, "u_creator");
    await w.call("checks:add", { revisionId, type: "name", label: "名前の確認" });

    const detail = await w.call("works:get", { workId }, "u_reviewer");
    expect(detail.revisions).toHaveLength(1);
    expect(detail.revisions[0]).toMatchObject({
      id: revisionId,
      label: "第1版",
      unresolvedCount: 2,
      openBotCount: 0,
      pendingChecks: ["名前の確認"],
      submitter: { id: c.creator, name: "u_creator" },
    });
    expect(detail.acceptingRevisionId).toBe(revisionId);
    expect(detail.defaultArtifacts).toMatchObject({
      revisionId,
      artifacts: [{ fileName: "a.pdf", type: "pdf", role: "source" }],
    });
    expect(detail.people.creators.map((u: Json) => u.id)).toEqual([c.creator]);
    expect(detail.people.approver.id).toBe(c.approver);
    expect(detail.approval).toMatchObject({ quorum: 1, canDeclare: false });
    // can{}: 校正者はコメントできるが編集はできない。主管は編集できる
    expect(detail.can).toMatchObject({ comment: true, edit: false, finalize: false });
    expect((await w.call("works:get", { workId }, "u_manager")).can).toMatchObject({ edit: true });
    expect((await w.call("works:get", { workId }, "u_approver")).approval.canDeclare).toBe(true);
    // 105A: サインインした委員なら誰でも取得できる。無い ID は存在ごと隠す
    expect((await w.call("works:get", { workId }, "u_stranger")).work.id).toBe(workId);
    expect(
      (await w.fail("works:get", { workId: "work_none" }, "u_stranger")).status,
    ).toBeGreaterThanOrEqual(403);
  });

  it("版に件数が無い古い行は、スレッドから数え直す", async () => {
    const w = world();
    const c = await cast(w);
    const workId = await createWork(w, c);
    const revisionId = await submit(w, workId);
    await comment(w, revisionId, "誤字");
    await comment(w, revisionId, "表記ゆれ");
    const stored = w.sql.exec("SELECT doc FROM revisions WHERE id = ?", revisionId)[0]!
      .doc as string;
    expect(JSON.parse(stored)).toMatchObject({
      unresolvedCount: 2,
      openBotCount: 0,
      threadCount: 2,
    });
    w.sql.exec(
      "UPDATE revisions SET doc = json_remove(doc, '$.unresolvedCount', '$.openBotCount', '$.threadCount')",
    );
    const detail = await w.call("works:get", { workId }, "u_reviewer");
    expect(detail.revisions[0].unresolvedCount).toBe(2);
  });
});

describe("revisions:get（校正ワークスペース）", () => {
  it("threads: 未読・リアクション・メンション・添付・返信、assignments、checks の canComplete / canWaive", async () => {
    const w = world();
    const c = await cast(w);
    const workId = await createWork(w, c);
    const revisionId = await submit(w, workId);
    // 校正者に許可（review）が無いと専門確認に参加できない（割当 ≠ 閲覧権限）
    await w.call("acl:grant", { workId, userIds: [c.reviewer], permission: "review" }, "u_admin");

    // 添付つきのコメント（実体の検証はサービスの鍵 + 本人の JWT）
    const [{ fileId }] = await w.call(
      "commentFiles:prepare",
      {
        revisionId,
        purpose: "comment",
        files: [{ fileName: "赤字.png", mimeType: "image/png", size: 10 }],
      },
      "u_reviewer",
    );
    const begun = await w.call("commentFiles:beginFileUpload", { fileId }, "u_reviewer", KEY);
    await w.call(
      "commentFiles:completeFileUpload",
      { attemptId: begun.attemptId, size: 10, sha256: "abc" },
      "u_reviewer",
      KEY,
    );
    const threadId = await comment(w, revisionId, "誤字です", {
      mentions: [c.creator],
      fileIds: [fileId],
    });
    const plain = await comment(w, revisionId, "別の指摘");

    const asCreator = async () =>
      (await w.call("revisions:get", { revisionId }, "u_creator")).threads;
    const find = (ts: Json[], id: string) => ts.find((t) => t.id === id);
    // 自分以外の動きがあるスレッドは未読。自分が立てたものは既読
    expect(find(await asCreator(), threadId)).toMatchObject({ unread: true, replyCount: 0 });
    const asReviewer = (await w.call("revisions:get", { revisionId }, "u_reviewer")).threads;
    expect(find(asReviewer, threadId)).toMatchObject({ unread: false });
    // 添付（検証済みのもの）とメンション
    const t = find(await asCreator(), threadId);
    expect(t.files).toMatchObject([{ id: fileId, name: "赤字.png", mime: "image/png", size: 10 }]);
    expect(t.mentionUsers.map((u: Json) => u.id)).toEqual([c.creator]);
    expect(t.author).toMatchObject({ id: c.reviewer, name: "u_reviewer" });

    // 既読にすると未読が消え、あとの返信でまた未読になる
    tick(w);
    await w.call("comments:markRead", { threadId }, "u_creator");
    expect(find(await asCreator(), threadId).unread).toBe(false);
    tick(w);
    await w.call("comments:reply", { threadId, body: "直します" }, "u_manager");
    const replied = find(await asCreator(), threadId);
    expect(replied).toMatchObject({ unread: true, replyCount: 1 });
    expect(replied.latestReplies[0]).toMatchObject({ body: "直します", author: { id: c.manager } });
    expect(replied.participantIds).toEqual(expect.arrayContaining([c.reviewer, c.manager]));
    expect(find(await asCreator(), plain)).toMatchObject({ replyCount: 0 });

    // リアクション: 集計と、付けた人の名前
    await w.call("comments:toggleReaction", { threadId, emoji: "👍" }, "u_creator");
    const reacted = find(await asCreator(), threadId).reactions;
    expect(reacted).toMatchObject([
      { emoji: "👍", count: 1, users: [{ id: c.creator, name: "u_creator" }] },
    ]);
    const others = find(
      (await w.call("revisions:get", { revisionId }, "u_reviewer")).threads,
      threadId,
    );
    expect(others.reactions).toMatchObject([{ emoji: "👍", count: 1 }]);

    // 専門確認と割当
    const checkId = await w.call("checks:add", {
      revisionId,
      type: "name",
      assigneeId: c.reviewer,
    });
    const flags = async (who: string) => {
      const r = await w.call("revisions:get", { revisionId }, who);
      return r.checks.map((x: Json) => [x.canComplete, x.canWaive]);
    };
    expect(await flags("u_reviewer")).toEqual([[true, false]]);
    expect(await flags("u_manager")).toEqual([[true, true]]);
    expect(await flags("u_creator")).toEqual([[false, false]]);
    const view = await w.call("revisions:get", { revisionId }, "u_reviewer");
    expect(view.checks[0]).toMatchObject({ assignee: { id: c.reviewer } });
    expect(view.assignments).toMatchObject([
      { reviewerId: c.reviewer, reviewer: { id: c.reviewer } },
    ]);
    expect(view.myAssignment).toMatchObject({ reviewerId: c.reviewer });
    expect(view.can).toMatchObject({ comment: true, completeReview: true, reply: true });
    await w.call("checks:complete", { checkId }, "u_reviewer");
    expect(await flags("u_manager")).toEqual([[false, false]]);
    expect(view.work).toMatchObject({ id: workId, finalRevisionId: null });
    expect(view.commentBlockedReason).toBeNull();

    await w.call("reviews:complete", { revisionId }, "u_reviewer");
    expect((await w.call("revisions:get", { revisionId }, "u_reviewer")).can.completeReview).toBe(
      false,
    );
  });

  it("前の版を開くと受付中の版（新しい版）を返す。期限を過ぎると投稿できない理由が変わる", async () => {
    const w = world();
    const c = await cast(w);
    const workId = await createWork(w, c);
    const first = await submit(w, workId, 24);
    tick(w, HOUR);
    const second = await submit(w, workId, 48);
    const latest = await w.call("revisions:get", { revisionId: second }, "u_reviewer");
    expect(latest).toMatchObject({ acceptingRevisionId: second });
    expect(latest.can.comment).toBe(true);
    const old = await w.call("revisions:get", { revisionId: first }, "u_reviewer");
    expect(old.acceptingRevisionId).toBe(second);
    expect(old.can.comment).toBe(false);
    expect(old.commentBlockedReason).toBe(old.revision.reviewClosedReason ?? "closed");

    // 要約の行が無い（揃う前の）制作物は、版から探す
    w.sql.exec("DELETE FROM workSummaries");
    const legacy = await w.call("revisions:get", { revisionId: first }, "u_reviewer");
    expect(legacy.acceptingRevisionId).toBe(second);
    expect(legacy.commentBlockedReason).toBe(old.commentBlockedReason);

    // 締切を過ぎた（まだ閉じる job が走っていない）受付中の版
    w.db.clock.current += 100 * HOUR;
    const lapsed = await w.call("revisions:get", { revisionId: second }, "u_reviewer");
    expect(lapsed.can.comment).toBe(false);
    expect(lapsed.commentBlockedReason).toBe("deadline");
    expect((await w.fail("revisions:get", { revisionId: "rev_none" }, "u_reviewer")).status).toBe(
      403,
    );
    expect(workId).toEqual(expect.any(String));
  });
});

describe("works:listMine / listMinePage", () => {
  async function seed(w: World, c: Cast) {
    const ids: Record<string, string> = {};
    for (const [title, hours] of [
      ["え制作", null],
      ["あ制作", null],
      ["い制作", 72],
      ["う制作", 24],
    ] as const) {
      ids[title] = await createWork(w, c, { title });
      if (hours !== null) await submit(w, ids[title]!, hours);
    }
    return ids;
  }

  it("並びは受付中の締切 → 題名（日本語順）。行に can* と要約が付く", async () => {
    const w = world();
    const c = await cast(w);
    await seed(w, c);
    const rows = await w.call("works:listMine", {}, "u_stranger");
    expect(rows.map((r: Json) => r.title)).toEqual(["う制作", "い制作", "あ制作", "え制作"]);
    expect(rows[0]).toMatchObject({
      latestRevisionLabel: "第1版",
      acceptingDeadlineAt: T0 + 24 * HOUR,
      creators: ["u_creator"],
      approvers: [{ id: c.approver, name: "u_approver" }],
      canEdit: false,
    });
    expect(rows[2]).toMatchObject({ latestRevisionLabel: null, acceptingRevisionId: null });

    // 一覧の行メニュー（worksRowMenu.test.ts）
    const flags = async (who: string) =>
      (await w.call("works:listMine", {}, who)).find((r: Json) => r.title === "あ制作");
    expect(await flags("u_manager")).toMatchObject({
      canEdit: true,
      canTransferCreators: true,
      canCancel: true,
    });
    expect(await flags("u_admin")).toMatchObject({ canEdit: true });
    expect(await flags("u_creator")).toMatchObject({ canEdit: false, canTransferCreators: false });
    expect(await flags("u_approver")).toMatchObject({ canEdit: false, canTransferCreators: true });
  });

  it("year / lifecycle / genre / text で絞る。中止した制作物は編集できる（再開のため）", async () => {
    const w = world();
    const c = await cast(w);
    const ids = await seed(w, c);
    await createWork(w, c, { title: "別年度", year: 99 });
    await w.call("works:update", { workId: ids["あ制作"], patch: { genre: "graphic" } });
    await w.call("works:changeLifecycle", { workId: ids["え制作"], to: "cancelled" });
    const titles = async (args: object) =>
      (await w.call("works:listMine", args, "u_manager")).map((r: Json) => r.title);
    expect(await titles({ year: 99 })).toEqual(["別年度"]);
    expect(await titles({ lifecycle: "cancelled" })).toEqual(["え制作"]);
    expect(await titles({ genre: "graphic" })).toEqual(["あ制作"]);
    expect(await titles({ text: "い制" })).toEqual(["い制作"]);
    expect(await titles({ text: "  告知  ", year: 99 })).toEqual(["別年度"]);
    const cancelled = (await w.call("works:listMine", { lifecycle: "cancelled" }, "u_manager"))[0];
    expect(cancelled.canEdit).toBe(true);
  });

  /** isDone まで続きを読んで、読んだ id を返す */
  async function readAll(w: World, args: object, numItems: number, who = "u_stranger") {
    const ids: string[] = [];
    const cursors: (string | null)[] = [];
    let cursor: string | null = null;
    for (let n = 0; n < 40; n++) {
      const page: Json = await w.call(
        "works:listMinePage",
        { ...args, paginationOpts: { numItems, cursor } },
        who,
      );
      ids.push(...page.page.map((r: Json) => r.id));
      cursors.push(page.continueCursor);
      if (page.isDone) return { ids: ids.sort((a, b) => a.localeCompare(b)), cursors };
      cursor = page.continueCursor;
    }
    throw new Error("cursor did not finish");
  }

  it("cursor で全件を読み切れる（text なし・あり、year / lifecycle つき）", async () => {
    const w = world();
    const c = await cast(w);
    const all: string[] = [];
    for (const [title, year] of [
      ["五月祭の受付", 100],
      ["五月祭の案内", 100],
      ["五月祭の旧年度", 99],
      ["雙子祭の受付", 100],
      ["春の展示", 100],
    ] as const)
      all.push(await createWork(w, c, { title, year, tags: ["来場者向け"] }));

    for (const size of [1, 2, 10]) {
      const sorted = (xs: (string | undefined)[]) =>
        [...xs].sort((a, b) => String(a).localeCompare(String(b)));
      expect((await readAll(w, {}, size)).ids).toEqual(sorted(all));
      expect((await readAll(w, { year: 100 }, size)).ids).toEqual(
        sorted([all[0], all[1], all[3], all[4]]),
      );
      // text あり: 部分一致（日本語 2 文字）。ページの中は一覧の並び。全件が過不足なく読めることを見る
      expect((await readAll(w, { text: "祭の" }, size)).ids).toEqual(sorted(all.slice(0, 4)));
      expect((await readAll(w, { text: "祭の", year: 100 }, size)).ids).toEqual(
        sorted([all[0], all[1], all[3]]),
      );
      expect((await readAll(w, { text: "場者" }, size)).ids).toEqual(sorted(all));
    }
    // 1 回で読み切れるなら isDone。text なしの続きの印は不透明な文字列、text ありは Convex と同じ { phase, cursor } の JSON
    const one = await w.call(
      "works:listMinePage",
      { paginationOpts: { numItems: 100, cursor: null } },
      "u_stranger",
    );
    expect(one).toMatchObject({ isDone: true, continueCursor: expect.any(String) });
    expect(one.page).toHaveLength(5);
    const text = await readAll(w, { text: "祭の" }, 2);
    expect(JSON.parse(text.cursors[0]!)).toEqual({ phase: "rows", cursor: expect.any(String) });
    expect(JSON.parse(text.cursors.at(-1)!)).toEqual({ phase: "unindexed", cursor: null });
  });

  it("genre の絞り込みはページの後なので、ページは短い・空のことがあるが、続きで読み切れる", async () => {
    const w = world();
    const c = await cast(w);
    const ids: string[] = [];
    for (const [i, title] of ["案内A", "案内B", "案内C", "案内D"].entries()) {
      ids.push(await createWork(w, c, { title }));
      if (i === 3) await w.call("works:update", { workId: ids[i], patch: { genre: "ui" } });
    }
    const first = await w.call(
      "works:listMinePage",
      { genre: "ui", paginationOpts: { numItems: 1, cursor: null } },
      "u_stranger",
    );
    expect(first.page).toEqual([]);
    expect(first.isDone).toBe(false);
    expect((await readAll(w, { genre: "ui" }, 1)).ids).toEqual([ids[3]]);
    expect((await readAll(w, { genre: "ui", text: "案内" }, 1)).ids).toEqual([ids[3]]);
  });
});

describe("workSearch（FTS5 の 1/2-gram）", () => {
  const search = async (w: World, text: string, filters: object = {}) =>
    (
      (await w.call(
        "works:listMinePage",
        { text, ...filters, paginationOpts: { numItems: 50, cursor: null } },
        "u_stranger",
      )) as Json
    ).page.map((r: Json) => r.title);

  it("部分一致（日本語 1・2・3 文字）・大小文字・年度と状態の絞り込み・更新と状態の変更に追随する", async () => {
    const w = world();
    const c = await cast(w);
    const cur = await createWork(w, c, { title: "五月祭の受付", tags: ["来場者向け"] });
    await createWork(w, c, { title: "五月祭の別年度", year: 99 });
    await createWork(w, c, { title: "ABC Poster" });

    expect(await search(w, "祭の")).toEqual(["五月祭の受付", "五月祭の別年度"]);
    expect(await search(w, "場者")).toEqual(["五月祭の受付"]);
    expect(await search(w, "祭")).toEqual(["五月祭の受付", "五月祭の別年度"]);
    // 3 文字以上は先頭 2 文字で候補を絞り、本文での包含で確かめる（token が当たっても部分一致でなければ出ない）
    expect(await search(w, "五月祭")).toEqual(["五月祭の受付", "五月祭の別年度"]);
    expect(await search(w, "月祭の案")).toEqual([]);
    expect(await search(w, "poster")).toEqual(["ABC Poster"]);
    expect(await search(w, "BC")).toEqual(["ABC Poster"]);
    expect(await search(w, "祭の", { year: 99 })).toEqual(["五月祭の別年度"]);
    expect(await search(w, "存在しない語")).toEqual([]);

    // 検索の行は works の行と 1 対 1（rowid も同じ）
    const rows = w.sql.exec(
      "SELECT s.rowid AS a, k.rowid AS b FROM workSearch s JOIN works k ON k.id = s.workId",
    );
    expect(rows).toHaveLength(3);
    expect(rows.every((r) => r.a === r.b)).toBe(true);

    await w.call("works:update", { workId: cur, patch: { title: "春の受付", tags: ["案内所"] } });
    expect(await search(w, "祭の")).toEqual(["五月祭の別年度"]);
    expect(await search(w, "内所")).toEqual(["春の受付"]);
    expect(w.sql.exec("SELECT count(*) AS n FROM workSearch")[0]!.n).toBe(3);

    await w.call("works:changeLifecycle", { workId: cur, to: "cancelled" });
    expect(w.sql.exec("SELECT lifecycle FROM workSearch WHERE workId = ?", cur)[0]!.lifecycle).toBe(
      "cancelled",
    );
    expect(await search(w, "春の", { year: 100, lifecycle: "cancelled" })).toEqual(["春の受付"]);
    expect(await search(w, "春の", { year: 100, lifecycle: "active" })).toEqual([]);
  });
});

describe("派生表（書いたのと同じトランザクションで作り直す）", () => {
  it("workRoles: 職責が変わると行が入れ替わり、dashboard:make の候補も追随する", async () => {
    const w = world();
    const c = await cast(w);
    const workId = await createWork(w, c);
    const roles = () =>
      w.sql
        .exec(
          "SELECT userId, json_extract(doc, '$.role') AS role FROM workRoles WHERE workId = ?",
          workId,
        )
        .map((r) => `${String(r.role)}:${String(r.userId)}`)
        .sort((a, b) => a.localeCompare(b));
    expect(roles()).toEqual(
      [`creator:${c.creator}`, `approver:${c.approver}`, `manager:${c.manager}`].sort((a, b) =>
        a.localeCompare(b),
      ),
    );
    const submitTitles = async (who: string) =>
      (await w.call("dashboard:make", {}, who)).works.map((r: Json) => r.title);
    // 制作者の行は自分が制作者の制作物。関係のない人には候補に出ない
    expect(await submitTitles("u_creator")).toEqual(["ポスター"]);
    expect(await submitTitles("u_stranger")).toEqual([]);

    await w.call("works:update", { workId, patch: { creatorIds: [c.reviewer] } });
    expect(roles()).toContain(`creator:${c.reviewer}`);
    expect(roles()).not.toContain(`creator:${c.creator}`);
    expect(await submitTitles("u_creator")).toEqual([]);
    expect(await submitTitles("u_reviewer")).toEqual(["ポスター"]);
  });

  it("workSummaries: 提出・指摘・採否で作り直され、揃っていれば一覧は版とスレッドを読まない", async () => {
    const w = world();
    const c = await cast(w);
    const workId = await createWork(w, c);
    const summary = () =>
      JSON.parse(
        w.sql.exec("SELECT doc FROM workSummaries WHERE id = ?", workId)[0]!.doc as string,
      );
    expect(summary()).toMatchObject({
      latestId: null,
      acceptingId: null,
      summaryVersion: 2,
      declared: 0,
    });
    const revisionId = await submit(w, workId);
    expect(summary()).toMatchObject({ latestId: revisionId, acceptingId: revisionId });
    const a = await comment(w, revisionId, "誤字");
    await comment(w, revisionId, "表記");
    expect(summary().threads).toMatchObject({ unresolved: 2, total: 2 });
    tick(w);
    await w.call("comments:decide", { threadId: a, action: "resolved" }, "u_creator");
    expect(summary().threads).toMatchObject({ unresolved: 1, total: 2 });
    await w.call("comments:remove", { threadId: a }, "u_reviewer");
    expect(summary().threads).toMatchObject({ unresolved: 1, total: 1 });
    expect(
      JSON.parse(
        w.sql.exec("SELECT doc FROM revisions WHERE id = ?", revisionId)[0]!.doc as string,
      ),
    ).toMatchObject({ unresolvedCount: 1, threadCount: 1 });

    const read = async () => ({
      list: await w.call("works:listMine", {}, "u_manager"),
      get: (await w.call("works:get", { workId }, "u_manager")).revisions.length,
    });
    const current = await read();
    // 要約の行が古い版（summaryVersion が無い）・行が無い、のどちらでも一覧は同じ（版から数え直す）
    w.sql.exec("UPDATE workSummaries SET doc = json_remove(doc, '$.summaryVersion')");
    expect(await read()).toEqual(current);
    w.sql.exec("DELETE FROM workSummaries");
    expect(await read()).toEqual(current);
    // 数え直した行を作り直すには書込みが要る。表が揃っていれば、版とスレッドを消しても一覧は変わらない
    await w.call("works:update", { workId, patch: { purpose: "告知（改）" } });
    const rebuilt = await w.call("works:listMine", {}, "u_manager");
    w.sql.exec("DELETE FROM threads");
    w.sql.exec("DELETE FROM revisions");
    expect(await w.call("works:listMine", {}, "u_manager")).toEqual(rebuilt);
  });

  it("書き込みが巻き戻ると、派生表も巻き戻る（同じトランザクション）", async () => {
    const w = world();
    const c = await cast(w);
    await createWork(w, c);
    const before = w.sql.exec("SELECT count(*) AS n FROM workRoles")[0]!.n;
    // 登録の途中で DomainError になる呼び出し（校了者が制作者を兼ねる）。works を書いた後に落ちても派生表は残らない
    const res = await w.fail("works:create", {
      title: "不正",
      purpose: "",
      category: "印刷物",
      mediaType: "pdf",
      year: 100,
      creatorIds: [c.creator],
      approverId: c.creator,
    });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(w.sql.exec("SELECT count(*) AS n FROM workRoles")[0]!.n).toBe(before);
    expect(w.sql.exec("SELECT count(*) AS n FROM workSearch")[0]!.n).toBe(1);
    expect(w.sql.exec("SELECT count(*) AS n FROM workSummaries")[0]!.n).toBe(1);
  });
});

describe("reviews:myQueue / dashboard", () => {
  it("myQueue: 締切順・件数・期限超過。dashboard:checkBadge は未完了の割当と専門確認を数える", async () => {
    const w = world();
    const c = await cast(w);
    const w1 = await createWork(w, c, { title: "早い" });
    const w2 = await createWork(w, c, { title: "遅い" });
    // 割当 ≠ 閲覧権限（D3）: 許可（ACL）の無い校正者の待ちには出ない。先に確かめてから許可を付ける
    await submit(w, w1, 24);
    expect(await w.call("reviews:myQueue", {}, "u_reviewer")).toEqual([]);
    for (const id of [w1, w2])
      await w.call(
        "acl:grant",
        { workId: id, userIds: [c.reviewer], permission: "review" },
        "u_admin",
      );
    const r1 = (
      await w.call("revisions:get", { revisionId: await latestRevision(w, w1) }, "u_manager")
    ).revision.id;
    const r2 = await submit(w, w2, 72);
    await comment(w, r1, "指摘1");
    await comment(w, r1, "指摘2");
    await comment(w, r1, "他人の指摘", {}, "u_manager");

    const queue = await w.call("reviews:myQueue", {}, "u_reviewer");
    expect(queue.map((q: Json) => q.workTitle)).toEqual(["早い", "遅い"]);
    expect(queue[0]).toMatchObject({
      revisionId: r1,
      workId: w1,
      revisionLabel: "第1版",
      kind: "standard",
      focusNotes: "配色",
      deadlineAt: T0 + 24 * HOUR,
      isOpen: true,
      overdue: false,
      // コメントすると「確認中」になる（pending → viewed）
      assignmentState: "viewed",
      myCommentCount: 2,
      totalCommentCount: 3,
    });
    expect(queue[1]).toMatchObject({ assignmentState: "pending", myCommentCount: 0 });
    // 割当の無い人の待ちは空
    expect(await w.call("reviews:myQueue", {}, "u_creator")).toEqual([]);

    // 未着手・確認中の割当 2 件 + 専門確認 1 件。確認完了（responded）は数えない
    await w.call("checks:add", { revisionId: r2, type: "name", assigneeId: c.reviewer });
    expect(await w.call("dashboard:checkBadge", {}, "u_reviewer")).toEqual({ count: 3 });
    await w.call("revisions:markViewed", { revisionId: r1 }, "u_reviewer");
    expect(await w.call("dashboard:checkBadge", {}, "u_reviewer")).toEqual({ count: 3 });
    await w.call("reviews:complete", { revisionId: r1 }, "u_reviewer");
    expect(await w.call("dashboard:checkBadge", {}, "u_reviewer")).toEqual({ count: 2 });
    expect(await w.call("dashboard:checkBadge", {}, "u_creator")).toEqual({ count: 0 });
    // 確認完了のあとも待ちには残る（responded）
    expect((await w.call("reviews:myQueue", {}, "u_reviewer"))[0]).toMatchObject({
      assignmentState: "responded",
    });

    // 早い方の締切を過ぎる: 期限超過になり、受付中の遅い方が先に来る
    w.db.clock.current += 30 * HOUR;
    const later = await w.call("reviews:myQueue", {}, "u_reviewer");
    expect(later.map((q: Json) => [q.workTitle, q.isOpen, q.overdue])).toEqual([
      ["遅い", true, false],
      ["早い", false, true],
    ]);
  });

  it("dashboard:check / make は workRoles・割当・許可から候補を引く（関係のない制作物は出ない）", async () => {
    const w = world();
    const c = await cast(w);
    const mine = await createWork(w, c, { title: "自分の" });
    await createWork(w, c, { title: "関係ない", reviewerIds: [] });
    await submit(w, mine, 24);
    const review = async (who: string) =>
      (await w.call("dashboard:check", {}, who)).mine.review.map(
        (r: Json) => r.workTitle ?? r.title,
      );
    expect(await review("u_reviewer")).toEqual(["自分の"]);
    expect(await review("u_stranger")).toEqual([]);
    // 候補の引き方そのもの（workRoles・許可・割当・専門確認）。dashboard の build* が絞る前の、読む対象を確かめる
    const related = (userId: string, assignments: boolean, groupIds: string[] = []) =>
      listWorksRelatedTo({ sql: w.sql } as FnCtx, { userId, groupIds } as unknown as Principal, {
        assignments,
      }).map((x) => x.title);
    expect(related(c.creator, false)).toEqual(["自分の", "関係ない"]);
    expect(related(c.stranger, true)).toEqual([]);
    // 校正の割当は「受付中の版」がある制作物だけ。版の無い制作物は出ない
    expect(related(c.reviewer, false)).toEqual([]);
    expect(related(c.reviewer, true)).toEqual(["自分の"]);
    // 許可（edit 以上・取り消されていないもの）の付いた人・グループは、職責が無くても候補に入る
    await w.call(
      "acl:grant",
      { workId: mine, userIds: [c.stranger], permission: "edit" },
      "u_admin",
    );
    expect(related(c.stranger, false)).toEqual(["自分の"]);
    await w.call(
      "acl:grant",
      { workId: mine, userIds: [c.admin], permission: "review" },
      "u_admin",
    );
    expect(related(c.admin, false)).toEqual([]);
    await w.call("acl:revoke", { workId: mine, userId: c.stranger }, "u_admin");
    expect(related(c.stranger, false)).toEqual([]);
    expect(await w.call("dashboard:works", {}, "u_stranger")).toEqual(expect.any(Object));
    // システム管理者は全件から作る
    expect(await w.call("dashboard:check", {}, "u_admin")).toEqual(expect.any(Object));
  });
});

describe("notifications:unreadCount（notificationCounters）", () => {
  const counter = (w: World, userId: string) =>
    (w.sql.exec("SELECT doc FROM notificationCounters WHERE id = ?", userId)[0]?.doc as
      | string
      | undefined) &&
    JSON.parse(
      w.sql.exec("SELECT doc FROM notificationCounters WHERE id = ?", userId)[0]!.doc as string,
    ).unread;

  it("通知の作成・既読・未読に戻す・全て既読で、数の行と一覧の未読が合う", async () => {
    const w = world();
    const c = await cast(w);
    expect(await w.call("notifications:unreadCount", {}, "u_manager")).toBe(0);
    await w.call("notifications:sendTest", {}, "u_manager");
    expect(await w.call("notifications:unreadCount", {}, "u_manager")).toBe(1);
    expect(counter(w, c.manager)).toBe(1);
    const [n] = await w.call("notifications:list", { unreadOnly: true }, "u_manager");
    await w.call("notifications:markRead", { notificationId: n.id }, "u_manager");
    expect(await w.call("notifications:unreadCount", {}, "u_manager")).toBe(0);
    // 既読にしたものをもう一度既読にしても減らない（0 を割らない）
    await w.call("notifications:markRead", { notificationId: n.id }, "u_manager");
    expect(counter(w, c.manager)).toBe(0);
    await w.call("notifications:markUnread", { notificationId: n.id }, "u_manager");
    expect(await w.call("notifications:unreadCount", {}, "u_manager")).toBe(1);
    tick(w, 61_000);
    await w.call("notifications:sendTest", {}, "u_manager");
    expect(await w.call("notifications:unreadCount", {}, "u_manager")).toBe(2);
    expect(await w.call("notifications:markAllRead", {}, "u_manager")).toBe(2);
    expect(await w.call("notifications:unreadCount", {}, "u_manager")).toBe(0);
    expect(await w.call("notifications:list", { unreadOnly: true }, "u_manager")).toEqual([]);
    // 他の人の数は動かない
    expect(await w.call("notifications:unreadCount", {}, "u_creator")).toBe(0);
  });

  it("コメントの通知（他の人宛）でも合う。行が無い利用者は未読を数えて返す（Convex の fallback と同じ）", async () => {
    const w = world();
    const c = await cast(w);
    const workId = await createWork(w, c);
    const revisionId = await submit(w, workId);
    const threadId = await comment(w, revisionId, "誤字です", { mentions: [c.creator] });
    const listed = await w.call("notifications:list", { unreadOnly: true }, "u_creator");
    expect(listed.length).toBeGreaterThan(0);
    expect(await w.call("notifications:unreadCount", {}, "u_creator")).toBe(listed.length);
    expect(counter(w, c.creator)).toBe(listed.length);

    // 数の行が無くても、未読を数えて同じ値を返す
    w.sql.exec("DELETE FROM notificationCounters");
    expect(await w.call("notifications:unreadCount", {}, "u_creator")).toBe(listed.length);
    // 行が無いまま既読にしても、書込みのついでに正しい数で行が作られる
    await w.call("notifications:markThreadRead", { threadId }, "u_creator");
    const rest = await w.call("notifications:list", { unreadOnly: true }, "u_creator");
    expect(await w.call("notifications:unreadCount", {}, "u_creator")).toBe(rest.length);
    expect(counter(w, c.creator)).toBe(rest.length);
  });
});

describe("works:importDirectory", () => {
  it("メール・名前（ふりがな）で、サインイン済みの委員だけを引く。キーが空なら空", async () => {
    const w = world();
    const c = await cast(w);
    w.sql.exec(
      "UPDATE users SET doc = json_set(doc, '$.hurigana', 'さつき めい', '$.email', 'mei@example.com') WHERE id = ?",
      c.creator,
    );
    const hit = await w.call("works:importDirectory", { keys: ["mei@example.com"] }, "u_manager");
    expect(hit).toEqual([
      { id: c.creator, name: "さつき めい", email: "mei@example.com", otherNames: ["u_creator"] },
    ]);
    expect(
      await w.call("works:importDirectory", { keys: ["u_creator"] }, "u_manager"),
    ).toHaveLength(1);
    expect(await w.call("works:importDirectory", { keys: [] }, "u_manager")).toEqual([]);
  });
});
