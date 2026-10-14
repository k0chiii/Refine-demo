import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { HOUR, type createCast, type Harness } from "./harness";

type Cast = Awaited<ReturnType<typeof createCast>>;

/** 制作物を登録し、校正者に review 権限を付ける（新機能の統合テストで共用） */
export async function setupWork(
  _t: Harness,
  cast: Cast,
  over: {
    title?: string;
    mediaType?: "pdf" | "image" | "document" | "other";
    notationCategories?: string[];
  } = {},
) {
  const workId = (await cast.manager.as.mutation(api.works.create, {
    title: over.title ?? "MF100 パンフレット",
    purpose: "来場者案内",
    category: "印刷物",
    mediaType: over.mediaType ?? "pdf",
    year: 100,
    creatorIds: [cast.creator.id],
    approverId: cast.approver.id,
  })) as Id<"works">;
  await cast.admin.as.mutation(api.acl.grant, {
    workId,
    principalType: "user",
    principalId: cast.reviewer.id,
    permission: "review",
  });
  return workId;
}

/** 準備 → 全項目検証済み → 確定 */
export async function submitFiles(
  cast: Cast,
  workId: Id<"works">,
  items: Array<{
    fileName: string;
    mimeType: string;
    type: "pdf" | "image" | "document" | "other";
  }>,
) {
  const prepared = await cast.creator.as.mutation(api.submissions.prepare, {
    workId,
    kind: "standard",
    reviewType: "general",
    deadlineAt: Date.now() + 48 * HOUR,
    changeSummary: "提出",
    focusNotes: "",
    items: items.map((i) => ({ ...i, role: "source" as const })),
  });
  for (const [k, it] of prepared.items.entries())
    await cast.creator.as.mutation(api.submissions.markVerified, {
      itemId: it.id as Id<"uploadItems">,
      size: 10 + k,
      sha256: `sha-${k}`,
    });
  const confirmed = await cast.creator.as.mutation(api.submissions.confirm, {
    sessionId: prepared.sessionId as Id<"uploadSessions">,
  });
  const rev = await cast.creator.as.query(api.revisions.get, { revisionId: confirmed.revisionId });
  return { revisionId: confirmed.revisionId as Id<"revisions">, artifacts: rev.artifacts };
}
