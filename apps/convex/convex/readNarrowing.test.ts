import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { createCast, createHarness } from "../test/harness";
import { profileReads } from "../test/readProfile";
import { setupWork, submitFiles } from "../test/flows";
import { createReadContext } from "./lib/adapters";

const pdf = [{ fileName: "a.pdf", mimeType: "application/pdf", type: "pdf" as const }];

describe("Convex 統合: 版の画面・通知の読み取りを絞っても結果は同じ", () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: Date.UTC(2026, 10, 1, 9, 0, 0), toFake: ["Date"] });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("削除済みのスレッドは、一覧にも出ず、削除済みの ID としてだけ引ける（版ごと）", async () => {
    const t = createHarness();
    const cast = await createCast(t);
    const workId = await setupWork(t, cast);
    const first = await submitFiles(cast, workId, pdf);
    const post = async (revisionId: Id<"revisions">, body: string) =>
      (await cast.reviewer.as.mutation(api.comments.post, {
        revisionId,
        body,
        kind: "correction",
        severity: "info",
      })) as Id<"commentThreads">;
    // 前の版に付けてから、新しい版を出す（前の版は受付が終わる）
    const otherRevision = await post(first.revisionId, "別の版");
    vi.setSystemTime(Date.now() + 3_600_000);
    const second = await submitFiles(cast, workId, pdf);
    const keep = await post(second.revisionId, "残る");
    const gone = await post(second.revisionId, "消える");
    await cast.reviewer.as.mutation(api.comments.remove, { threadId: gone });
    await cast.reviewer.as.mutation(api.comments.remove, { threadId: otherRevision });

    const out = await t.run(async (ctx) => {
      const app = createReadContext(ctx.db);
      return {
        live: (await app.threads.listByRevision(second.revisionId)).map((x) => x.id),
        deleted: await app.threads.listDeletedIdsByRevision(second.revisionId),
        deletedFirst: await app.threads.listDeletedIdsByRevision(first.revisionId),
        liveFirst: (await app.threads.listByRevision(first.revisionId)).map((x) => x.id),
      };
    });
    expect(out.live).toEqual([keep]);
    expect(out.deleted).toEqual([gone]);
    expect(out.deletedFirst).toEqual([otherRevision]);
    expect(out.liveFirst).toEqual([]);
    const shown = await cast.reviewer.as.query(api.revisions.get, {
      revisionId: second.revisionId,
    });
    expect(shown.threads.map((x) => x.id)).toEqual([keep]);
  });

  it("通知の一覧は、スレッドの文書を読まず、削除されたコメントの通知を伏せる", async () => {
    const t = createHarness();
    const cast = await createCast(t);
    const workId = await setupWork(t, cast);
    const { revisionId } = await submitFiles(cast, workId, pdf);
    const post = async (body: string) =>
      (await cast.reviewer.as.mutation(api.comments.post, {
        revisionId,
        body,
        kind: "correction",
        severity: "info",
      })) as Id<"commentThreads">;
    const gone = await post("消える");
    const stays = await post("残る");
    await cast.reviewer.as.mutation(api.comments.remove, { threadId: gone });
    const { result, byTable } = await profileReads(() =>
      cast.creator.as.query(api.notifications.list, { limit: 20 }),
    );
    // 読むのは削除済みの 1 件だけ（生きているスレッドの文書は読まない）
    expect(byTable.commentThreads?.docs).toBe(1);
    expect(result.some((n) => n.threadId === gone)).toBe(false);
    expect(result.some((n) => n.threadId === stays)).toBe(true);
    expect(result.some((n) => n.body === "削除されたコメントの通知です")).toBe(true);
  });

  it("版の画面は本人に当たる許可だけを読み、他の人の許可は判定にも読み取りにも入らない", async () => {
    const t = createHarness();
    const cast = await createCast(t);
    const workId = await setupWork(t, cast);
    const { revisionId } = await submitFiles(cast, workId, pdf);
    // 校正者（review）のほかに、別の人へ edit を付ける。stranger には何も付けない
    await cast.admin.as.mutation(api.acl.grant, {
      workId,
      userIds: [cast.manager.id, cast.approver.id],
      permission: "edit",
    });
    const asStranger = await profileReads(() =>
      cast.stranger.as.query(api.revisions.get, { revisionId }),
    );
    // 負の確認: 他の人の edit は stranger の操作可否に効かない
    expect(asStranger.result.can.assign).toBe(false);
    expect(asStranger.result.can.decide).toBe(false);
    expect(asStranger.byTable.workPermissions).toBeUndefined();
    // 本人に edit があれば操作できる。読むのは本人の 1 件だけ
    await cast.admin.as.mutation(api.acl.grant, {
      workId,
      userIds: [cast.stranger.id],
      permission: "edit",
    });
    const granted = await profileReads(() =>
      cast.stranger.as.query(api.revisions.get, { revisionId }),
    );
    expect(granted.result.can.assign).toBe(true);
    expect(granted.result.can.decide).toBe(true);
    expect(granted.byTable.workPermissions?.docs).toBe(1);
    // 取り消されれば元に戻る
    await cast.admin.as.mutation(api.acl.revoke, {
      workId,
      userId: cast.stranger.id,
    });
    const revoked = await cast.stranger.as.query(api.revisions.get, { revisionId });
    expect(revoked.can.assign).toBe(false);
  });
});
