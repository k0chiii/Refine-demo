import type { RuleDraft } from "@mf100/domain";
import { PROOFREADER_ID } from "@mf100/domain";
import { describe, expect, it } from "vite-plus/test";
import { grantWorkPermission } from "../usecases/acl.ts";
import { finalizeWork } from "../usecases/approvals.ts";
import {
  claimProofreadArtifact,
  failProofreadArtifact,
  getProofreadingRun,
  retryProofreadingRun,
  submitProofreadSegments,
} from "../usecases/autoProofread.ts";
import { decideThread, editThread } from "../usecases/comments.ts";
import { saveRule } from "../usecases/notation.ts";
import { createInMemoryContext } from "../testing/inMemory.ts";
import { HOUR, principals, seedWork, submitRevision } from "../testing/scenario.ts";

const code = (c: string) => expect.objectContaining({ code: c });
const { sysadmin, reviewer, stranger, creator, approver } = principals;

const rule: RuleDraft = {
  ruleId: "A1-0001",
  categoryCode: "A1",
  title: "五月祭",
  description: "固有名詞は漢数字",
  correct: ["五月祭"],
  incorrect: [],
  patterns: ["[5５]月祭"],
  exceptions: [],
  language: "ja",
  scopes: [],
  years: [],
  priority: 0,
  strictness: "required",
  enabled: true,
};
const page = (text: string) => ({
  kind: "page" as const,
  page: 1,
  text,
  boxes: [{ start: 0, end: text.length, rect: { x: 0.1, y: 0.1, w: 0.5, h: 0.04 } }],
});

async function setup() {
  const ctx = createInMemoryContext();
  await saveRule(ctx, sysadmin, { rule });
  const work = await seedWork(ctx, { notationCategories: ["A1"] });
  await grantWorkPermission(ctx, sysadmin, {
    workId: work.id,
    userIds: [reviewer.userId],
    permission: "review",
  });
  const rev = await submitRevision(ctx, work.id);
  const view = await getProofreadingRun(ctx, creator, rev.id);
  return { ctx, work, rev, run: view.run!, view };
}

describe("提出時の自動校正", () => {
  it("提出で実行が待ち状態で作られ、サーバーがルールで照合して自動校正の指摘を作る（重複しない）", async () => {
    const { ctx, work, rev, run, view } = await setup();
    expect(view.canRun).toBe(true);
    expect(run.status).toBe("pending");
    const artifactId = run.artifacts[0]!.artifactId;

    // コメントを書けるだけの人（校正に加われない人）は担当も送信もできず、実行も進められない
    expect((await getProofreadingRun(ctx, stranger, rev.id)).canRun).toBe(false);
    await expect(
      claimProofreadArtifact(ctx, stranger, { runId: run.id, artifactId }),
    ).rejects.toEqual(code("forbidden"));

    expect(
      (await claimProofreadArtifact(ctx, reviewer, { runId: run.id, artifactId })).claimed,
    ).toBe(true);
    // 担当中は他の端末は担当できない
    expect(
      (await claimProofreadArtifact(ctx, creator, { runId: run.id, artifactId })).claimed,
    ).toBe(false);

    const r = await submitProofreadSegments(ctx, reviewer, {
      runId: run.id,
      artifactId,
      segments: [page("今年の5月祭と５月祭")],
    });
    expect(r.created).toBe(2);
    const threads = await ctx.threads.listByRevision(rev.id);
    expect(threads.every((t) => t.authorId === PROOFREADER_ID)).toBe(true);
    expect(threads[0]!.origin).toMatchObject({
      kind: "bot",
      ruleId: "A1-0001",
      ruleRevision: 1,
      runId: run.id,
      textSource: "pdf_text",
    });
    expect(threads[0]!.anchor?.type).toBe("pdf_rect");
    expect(threads[0]!.resolution).toBe("open");
    // 送り直しても増えない
    expect(
      (
        await submitProofreadSegments(ctx, reviewer, {
          runId: run.id,
          artifactId,
          segments: [page("今年の5月祭")],
        })
      ).skipped,
    ).toBe("already_done");
    const after = await getProofreadingRun(ctx, creator, rev.id);
    expect(after.run!.status).toBe("done");
    expect(after.run!.artifacts[0]!.findings).toBe(2);
    // 制作者へは 1 件だけ通知
    expect(
      ctx.state.notifications
        .all()
        .filter((n) => n.kind === "auto_proofread_done")
        .map((n) => n.recipientId),
    ).toEqual([creator.userId]);

    // 人は自動校正の本文を書き換えられない。採否判断は人の指摘と同じ
    await expect(
      editThread(ctx, reviewer, { threadId: threads[0]!.id, body: "x" }),
    ).rejects.toEqual(code("comment_edit_not_author"));
    await decideThread(ctx, creator, { threadId: threads[0]!.id, action: "accepted" });

    // 校了は止めないが、未確認の自動校正の件数と理由を記録する
    ctx.clock.advance(30 * HOUR);
    const { event } = await finalizeWork(ctx, approver, {
      workId: work.id,
      revisionId: rev.id,
      autoProofreadNote: "表記は印刷所で確認済み",
    });
    expect(event.reason).toContain("1 件");
    expect(event.reason).toContain("印刷所");
  });

  it("文字の種類が添付と合わないものは拒否し、失敗は理由を残して再試行できる", async () => {
    const { ctx, rev, run } = await setup();
    const artifactId = run.artifacts[0]!.artifactId;
    await expect(
      submitProofreadSegments(ctx, creator, {
        runId: run.id,
        artifactId,
        segments: [{ kind: "text", text: "5月祭" }],
      }),
    ).rejects.toEqual(code("forbidden"));
    await failProofreadArtifact(ctx, creator, {
      runId: run.id,
      artifactId,
      error: "PDF を読み込めません",
    });
    let v = await getProofreadingRun(ctx, creator, rev.id);
    expect(v.run!.status).toBe("failed");
    expect(v.run!.artifacts[0]!.error).toBe("PDF を読み込めません");
    await retryProofreadingRun(ctx, creator, { runId: run.id });
    v = await getProofreadingRun(ctx, creator, rev.id);
    expect(v.run!.status).toBe("pending");
    expect(v.run!.attempts).toBe(2);
  });

  it("カテゴリ未選択の制作物は実行を作らない。受付が終わった版には作らない", async () => {
    const ctx = createInMemoryContext();
    await saveRule(ctx, sysadmin, { rule });
    const w1 = await seedWork(ctx);
    const r1 = await submitRevision(ctx, w1.id);
    expect((await getProofreadingRun(ctx, creator, r1.id)).run).toBeNull();

    const w2 = await seedWork(ctx, { notationCategories: ["A1"] });
    const r2 = await submitRevision(ctx, w2.id, { deadlineInHours: 1 });
    const run = (await getProofreadingRun(ctx, creator, r2.id)).run!;
    // 新しい版を出して旧版を締める
    await submitRevision(ctx, w2.id);
    const res = await submitProofreadSegments(ctx, creator, {
      runId: run.id,
      artifactId: run.artifacts[0]!.artifactId,
      segments: [page("5月祭")],
    });
    expect(res.skipped).toBe("not_accepting");
    expect(await ctx.threads.listByRevision(r2.id)).toEqual([]);
  });

  it("締切を過ぎたら、締切のジョブが版を閉じる前でも自動の指摘を作らない（人と同じ受付判定）", async () => {
    const ctx = createInMemoryContext();
    await saveRule(ctx, sysadmin, { rule });
    const work = await seedWork(ctx, { notationCategories: ["A1"] });
    const rev = await submitRevision(ctx, work.id, { deadlineInHours: 1 });
    const run = (await getProofreadingRun(ctx, creator, rev.id)).run!;
    ctx.clock.advance(2 * HOUR);
    // 版はまだ open のまま（締切のジョブが未実行）
    expect((await ctx.revisions.findById(rev.id))!.reviewState).toBe("open");
    const res = await submitProofreadSegments(ctx, creator, {
      runId: run.id,
      artifactId: run.artifacts[0]!.artifactId,
      segments: [page("5月祭")],
    });
    expect(res.skipped).toBe("not_accepting");
    expect(await ctx.threads.listByRevision(rev.id)).toEqual([]);
    const after = await getProofreadingRun(ctx, creator, rev.id);
    expect(after.run!.artifacts[0]!.status).toBe("skipped");
  });

  it("添付ごとの上限は分割送信の合計で数える（保存済みの数を差し引く）", async () => {
    const { BOT_THREADS_PER_ARTIFACT } = await import("@mf100/domain");
    const { ctx, rev, run } = await setup();
    const artifactId = run.artifacts[0]!.artifactId;
    const many = (n: number) => page(Array.from({ length: n }, () => "5月祭").join("、"));
    const first = await submitProofreadSegments(ctx, creator, {
      runId: run.id,
      artifactId,
      segments: [{ ...many(BOT_THREADS_PER_ARTIFACT), page: 1 }],
      partial: true,
    });
    expect(first.created).toBe(BOT_THREADS_PER_ARTIFACT);
    const second = await submitProofreadSegments(ctx, creator, {
      runId: run.id,
      artifactId,
      segments: [{ ...many(BOT_THREADS_PER_ARTIFACT), page: 2 }],
    });
    expect(second.created).toBe(0);
    expect(second.truncated).toBe(true);
    const bots = (await ctx.threads.listByRevision(rev.id)).filter(
      (t) => t.origin?.kind === "bot" && t.artifactId === artifactId,
    );
    expect(bots).toHaveLength(BOT_THREADS_PER_ARTIFACT);
  });
});
