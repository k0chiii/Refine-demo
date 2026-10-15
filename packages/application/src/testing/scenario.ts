import type { Principal, Revision } from "@mf100/domain";
import { createWork } from "../usecases/works.ts";
import {
  confirmSubmission,
  prepareSubmission,
  recordItemVerified,
} from "../usecases/submissions.ts";
import type { InMemoryContext } from "./inMemory.ts";

/** テスト・サンプルデータ生成で共用する主体 */
export const principals = {
  manager: { userId: "u_manager", isSystemAdmin: false, groupIds: [], orgPermissions: ["*"] },
  creator: { userId: "u_creator", isSystemAdmin: false, groupIds: [], orgPermissions: ["*"] },
  approver: { userId: "u_approver", isSystemAdmin: false, groupIds: [], orgPermissions: ["*"] },
  reviewer: { userId: "u_reviewer", isSystemAdmin: false, groupIds: [], orgPermissions: ["*"] },
  stranger: { userId: "u_stranger", isSystemAdmin: false, groupIds: [], orgPermissions: ["*"] },
  sysadmin: { userId: "u_sysadmin", isSystemAdmin: true, groupIds: [], orgPermissions: ["*"] },
} satisfies Record<string, Principal>;

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
    await recordItemVerified(ctx, principal, {
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
