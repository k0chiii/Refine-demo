import type { Principal, Revision } from "@mf100/domain";
import { createWork } from "../usecases/works.ts";
import {
  beginItemUpload,
  completeItemUpload,
  confirmSubmission,
  prepareSubmission,
} from "../usecases/submissions.ts";
import type { InMemoryContext } from "./inMemory.ts";
import { principals } from "./principals.ts";

export { principals } from "./principals.ts";

export const HOUR = 3_600_000;

export async function seedWork(
  ctx: InMemoryContext,
  over: Partial<Parameters<typeof createWork>[2]> = {},
) {
  return createWork(ctx, principals.manager, {
    title: "MF100 パンフレット",
    purpose: "来場者向け案内",
    category: "印刷物",
    mediaType: "pdf",
    year: 100,
    creatorIds: [principals.creator.userId],
    approverId: principals.approver.userId,
    ...over,
  });
}

/**
 * 決定（2026-10-18「制作者が校了者になることはないです」）より前に保存された行を作る: 制作者が校了者でもある制作物。
 * 登録・変更はこの形を作れないので、リポジトリへ直接書く（旧データの再現。approverIds・approvalQuorum の無い 1 人の校了者）。
 */
export async function seedLegacyCreatorApproverWork(
  ctx: InMemoryContext,
  over: Partial<Parameters<typeof createWork>[2]> = {},
) {
  const work = await seedWork(ctx, over);
  const { approverIds: _ids, approvalQuorum: _quorum, ...rest } = work;
  void _ids;
  void _quorum;
  const legacy = { ...rest, creatorIds: [principals.approver.userId] };
  await ctx.works.update(legacy);
  return legacy;
}

/**
 * Hono が実体を検証して記録するのと同じ手順（試行の開始 → 検証完了）。テスト・サンプルデータ用。
 * 本番ではサービス認証付きの境界からしか呼ばれない。
 */
export async function uploadVerifiedItem(
  ctx: InMemoryContext,
  principal: Principal,
  input: {
    itemId: string;
    size: number;
    sha256: string;
    pageCount?: number;
    pdfCompatible?: boolean;
  },
) {
  const { attemptId } = await beginItemUpload(ctx, principal, { itemId: input.itemId });
  const { itemId, ...meta } = input;
  void itemId;
  return completeItemUpload(ctx, principal, { attemptId, ...meta });
}

/** 準備 → 全ファイル検証済み → 確定、を一気に行うヘルパ。 */
export async function submitRevision(
  ctx: InMemoryContext,
  workId: string,
  opts: {
    kind?: "rough" | "standard";
    deadlineInHours?: number;
    /** 締切の時刻を直接指定する（deadlineInHours より優先） */
    deadlineAt?: number;
    files?: number;
    requestId?: string;
    principal?: Principal;
  } = {},
): Promise<Revision> {
  const principal = opts.principal ?? principals.creator;
  const files = opts.files ?? 1;
  const prepared = await prepareSubmission(ctx, principal, {
    workId,
    kind: opts.kind ?? "standard",
    reviewType: "general",
    deadlineAt: opts.deadlineAt ?? ctx.clock.now() + (opts.deadlineInHours ?? 24) * HOUR,
    changeSummary: "初稿",
    focusNotes: "表紙の配色",
    items: Array.from({ length: files }, (_, i) => ({
      fileName: `file${i}.pdf`,
      mimeType: "application/pdf",
      type: "pdf" as const,
      role: "source" as const,
    })),
  });
  for (const item of prepared.items) {
    await uploadVerifiedItem(ctx, principal, {
      itemId: item.id,
      size: 1234,
      sha256: "abc",
      pageCount: 2,
    });
  }
  const confirmInput: Parameters<typeof confirmSubmission>[2] = { sessionId: prepared.session.id };
  if (opts.requestId !== undefined) confirmInput.requestId = opts.requestId;
  const { revision } = await confirmSubmission(ctx, principal, confirmInput);
  return revision;
}
