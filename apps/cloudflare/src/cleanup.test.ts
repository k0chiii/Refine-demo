import { expireUploadSessions } from "@mf100/application";
import { describe, expect, it } from "vite-plus/test";
import { app, callFn, fakeDb, post, signIn, UPLOAD_SECRET } from "./testing/http.ts";

// R2 の清掃の口（submissions:listOrphanObjects / markObjectsPurged）を HTTP から 1 周させる。
// 期待は apps/convex/convex/{commentFiles,mvp}.test.ts の清掃の部分から写した（Convex では http.ts の /internal/upload-orphans が束ねる）

const HOUR = 3_600_000;
const CLEANUP_SECRET = "cleanup-secret-0123456789";
const BEARER = { Authorization: `Bearer ${CLEANUP_SECRET}` };
const KEY = { "X-MF100-Service-Key": UPLOAD_SECRET };

function world() {
  const db = fakeDb(undefined, { MF100_SYSTEM_ADMIN_SUBJECTS: "u_admin" });
  const a = app(db, { MF100_UPLOAD_SECRET: UPLOAD_SECRET, MF100_CLEANUP_SECRET: CLEANUP_SECRET });
  const call = (
    name: string,
    args: unknown,
    subject: string | null = "u_creator",
    headers: Record<string, string> = {},
  ) => callFn(a, name, args, subject, headers);
  /** apps/api の cloudflareCleanupGateway と同じ呼び方（利用者なし・Bearer だけ） */
  const cleanup = (name: string, args: unknown, headers: Record<string, string> = BEARER) =>
    post(a, `submissions:${name}`, args, null, headers);
  return { db, a, call, cleanup };
}
type World = ReturnType<typeof world>;

/** 版の提出の準備 → 実体の転送の開始（まだ検証はしない）。戻りは項目と、払い出された試行 */
async function prepareItem(w: World, workId: string) {
  const prepared = await w.call("submissions:prepare", {
    workId,
    kind: "standard",
    reviewType: "general",
    deadlineAt: w.db.clock.current + 48 * HOUR,
    changeSummary: "提出",
    focusNotes: "",
    items: [{ fileName: "a.pdf", mimeType: "application/pdf", type: "pdf", role: "source" }],
  });
  const itemId = prepared.items[0].id as string;
  const begun = await w.call("submissions:beginUpload", { itemId }, "u_creator", KEY);
  return { sessionId: prepared.sessionId as string, itemId, attemptId: begun.attemptId as string };
}

describe("submissions:listOrphanObjects / markObjectsPurged（R2 の清掃）", () => {
  it("秘密が無い・違う・利用者の鍵では、関数があることも教えない（404）", async () => {
    const w = world();
    for (const headers of [
      {},
      { Authorization: "Bearer wrong-secret-0123456789" },
      { Authorization: "Bearer short" },
      KEY,
    ]) {
      expect((await w.cleanup("listOrphanObjects", {}, headers)).status).toBe(404);
      expect((await w.cleanup("markObjectsPurged", { itemIds: [] }, headers)).status).toBe(404);
    }
    // 利用者の JWT だけでも入れない
    expect((await post(w.a, "submissions:listOrphanObjects", {}, "u_admin")).status).toBe(404);
    // 秘密が未設定の環境
    const none = app(fakeDb(), {});
    expect((await post(none, "submissions:listOrphanObjects", {}, null, BEARER)).status).toBe(404);
    // 合っていれば、利用者なしで通る。空なら空
    const ok = await w.cleanup("listOrphanObjects", {});
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ value: [] });
  });

  it("版の提出物・コメントの添付（サムネイルは extraObjectKeys）・採用されなかった試行が 1 本の一覧に載り、記録すると消える", async () => {
    const w = world();
    const creator = await signIn(w.a, "u_creator");
    const approver = await signIn(w.a, "u_approver");
    const reviewer = await signIn(w.a, "u_reviewer");
    const workId: string = await w.call(
      "works:create",
      {
        title: "ポスター",
        purpose: "告知",
        category: "印刷物",
        mediaType: "pdf",
        year: 100,
        creatorIds: [creator],
        approverId: approver,
        reviewerIds: [reviewer],
        activate: true,
      },
      "u_manager",
    );

    // 1 つ目の版を確定する（コメントを付けるため）
    const first = await prepareItem(w, workId);
    await w.call(
      "submissions:completeUpload",
      { attemptId: first.attemptId, size: 10, sha256: "abc" },
      "u_creator",
      KEY,
    );
    const { revisionId } = await w.call("submissions:confirm", { sessionId: first.sessionId });
    await w.call("acl:grant", { workId, userIds: [reviewer], permission: "review" }, "u_admin");

    // サムネイル付きの添付をコメントに付け、そのコメントを消す → 手放した添付
    const [{ fileId }] = await w.call(
      "commentFiles:prepare",
      {
        revisionId,
        purpose: "comment",
        files: [{ fileName: "赤字.webp", mimeType: "image/webp", size: 10 }],
      },
      "u_reviewer",
    );
    const fileAttempt = await w.call("commentFiles:beginFileUpload", { fileId }, "u_reviewer", KEY);
    await w.call(
      "commentFiles:completeFileUpload",
      { attemptId: fileAttempt.attemptId, size: 10, sha256: "abc" },
      "u_reviewer",
      KEY,
    );
    await w.call("commentFiles:beginThumbUpload", { fileId }, "u_reviewer", KEY);
    await w.call(
      "commentFiles:completeThumbUpload",
      { fileId, size: 4, mimeType: "image/webp" },
      "u_reviewer",
      KEY,
    );
    const threadId = await w.call(
      "comments:post",
      { revisionId, body: "誤字です", kind: "correction", severity: "major", fileIds: [fileId] },
      "u_reviewer",
    );
    // 付いたままの添付は清掃の対象にならない
    expect(await (await w.cleanup("listOrphanObjects", {})).json()).toEqual({ value: [] });
    await w.call("comments:remove", { threadId }, "u_reviewer");

    // 検証まで済んだのに確定されないまま放置された提出準備（abandoned になる）と、転送に失敗した試行
    const abandoned = await prepareItem(w, workId);
    await w.call(
      "submissions:completeUpload",
      { attemptId: abandoned.attemptId, size: 10, sha256: "abc" },
      "u_creator",
      KEY,
    );
    const failed = await prepareItem(w, workId);
    await w.call(
      "submissions:failUpload",
      { attemptId: failed.attemptId, message: "lost" },
      "u_creator",
      KEY,
    );
    w.db.clock.current += 25 * HOUR;
    await expireUploadSessions(w.db.db);

    const listed = (await (await w.cleanup("listOrphanObjects", {})).json()) as {
      value: Array<{ itemId: string; objectKey: string; extraObjectKeys?: string[] }>;
    };
    // 順序は Convex と同じ: 版の提出物 → コメントの添付 → 採用されなかった試行
    expect(listed.value.map((o) => o.itemId)).toEqual([
      abandoned.itemId,
      `comment:${fileId}`,
      `attempt:${failed.attemptId}`,
    ]);
    expect(listed.value[0]!.objectKey).toContain(abandoned.attemptId);
    expect(listed.value[1]).toMatchObject({
      objectKey: expect.stringContaining("comments/"),
      extraObjectKeys: [expect.stringMatching(/\/thumb$/)],
    });
    expect(listed.value[2]!.objectKey).toContain(failed.attemptId);

    // limit を守る（上限 500 まで。小さければその数で切る）
    const two = (await (await w.cleanup("listOrphanObjects", { limit: 2 })).json()) as {
      value: unknown[];
    };
    expect(two.value).toHaveLength(2);

    // 記録: 接頭辞で振り分ける。feedback: は読み捨て（数えない）。知らない ID・二重の記録は 0
    const purged = await w.cleanup("markObjectsPurged", {
      itemIds: [...listed.value.map((o) => o.itemId), "feedback:old", "nope", "comment:nope"],
    });
    expect(await purged.json()).toEqual({ value: 3 });
    expect(await (await w.cleanup("listOrphanObjects", {})).json()).toEqual({ value: [] });
    const again = await w.cleanup("markObjectsPurged", {
      itemIds: listed.value.map((o) => o.itemId),
    });
    expect(await again.json()).toEqual({ value: 0 });
  });

  it("引数が壊れていれば 400", async () => {
    const w = world();
    expect((await w.cleanup("markObjectsPurged", { itemIds: "x" })).status).toBe(400);
    expect((await w.cleanup("listOrphanObjects", { limit: "many" })).status).toBe(400);
  });
});
