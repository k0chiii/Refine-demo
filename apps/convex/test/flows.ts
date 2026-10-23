import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { HOUR, uploadVerified, type createCast, type Harness } from "./harness";

type Cast = Awaited<ReturnType<typeof createCast>>;

/** 制作物を登録し、校正者に review 権限を付ける（新機能の統合テストで共用） */
export async function setupWork(
  _t: Harness,
  cast: Cast,
  over: {
    title?: string;
    mediaType?: "pdf" | "image" | "document" | "video" | "web" | "figma" | "other";
    notationCategories?: string[];
    /** 非公開・取扱注意（通常の制作物は委員なら誰でも見られるので、閲覧権限の境目はこちらで確かめる） */
    confidentiality?: "normal" | "restricted";
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
    ...(over.notationCategories ? { notationCategories: over.notationCategories } : {}),
    ...(over.confidentiality ? { confidentiality: over.confidentiality } : {}),
  })) as Id<"works">;
  await cast.admin.as.mutation(api.acl.grant, {
    workId,
    userIds: [cast.reviewer.id],
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
    type: "pdf" | "image" | "document" | "video" | "other" | "external_link";
    /** 外部リンク（role external。実体は送らない） */
    externalUrl?: string;
  }>,
) {
  const prepared = await cast.creator.as.mutation(api.submissions.prepare, {
    workId,
    kind: "standard",
    reviewType: "general",
    deadlineAt: Date.now() + 48 * HOUR,
    changeSummary: "提出",
    focusNotes: "",
    items: items.map((i) =>
      i.externalUrl
        ? { ...i, role: "external" as const }
        : { fileName: i.fileName, mimeType: i.mimeType, type: i.type, role: "source" as const },
    ),
  });
  for (const [k, it] of prepared.items.entries())
    if (it.keyPrefix !== null)
      await uploadVerified(cast.creator, it.id, { size: 10 + k, sha256: `sha-${k}` });
  const confirmed = await cast.creator.as.mutation(api.submissions.confirm, {
    sessionId: prepared.sessionId as Id<"uploadSessions">,
  });
  const rev = await cast.creator.as.query(api.revisions.get, { revisionId: confirmed.revisionId });
  return { revisionId: confirmed.revisionId as Id<"revisions">, artifacts: rev.artifacts };
}
