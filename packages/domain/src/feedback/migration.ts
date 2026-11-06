import type { Anchor } from "../comment/Anchor.ts";
import type { CommentFile } from "../comment/attachments.ts";
import { decideThread, type CommentThread } from "../comment/CommentThread.ts";
import type { Revision } from "../revision/Revision.ts";
import type { ReactionEntry } from "../shared/reactions.ts";
import type { Instant } from "../shared/time.ts";
import type { WorkLifecycle } from "../work/Work.ts";
import {
  deriveFeedbackThreadTitle,
  isLiveFeedbackThread,
  type FeedbackFile,
  type FeedbackPost,
  type FeedbackThread,
} from "./feedback.ts";

/**
 * FB（フィードバック）のコメントへの移行（利用者決定 2026-10-20「既存の FB はコメントへ移す」「過去の FB データは消して良い」）。
 * ここは「何をどう移すか」の規則だけ（純粋な計算）。保存・分割実行・認可は application / Convex が受け持つ。
 *
 * 規則:
 * - 対象: 削除されておらず、削除されていない投稿が 1 件以上ある FB のスレッド。
 * - 移し先の版: スレッドが版を持っていればその版、無ければ制作物の最新の（void でない）版。版が 1 つも無ければ移さない。
 * - コメントになるのは最初の（削除されていない）投稿。投稿者・本文・リアクション・メンション・時刻はそのまま。
 *   本文は旧来の平文として持つ（書式を付けない。「*」などを Markdown として読み替えない）。
 *   題名を明示していた（本文から作られる題名と違う）ときは、本文の頭に「【題名】」の行を足す。
 *   場所（anchor）があればそのまま。種別は「修正提案」、重要度は「重要」（Web の入力欄が付けるものと同じ）。
 * - 残りの投稿は返信（replied）になる。訂正された投稿は最新の本文を持つ。
 * - 解決の状態: 移し先が「校了前の制作物の、最新の受付中の版」のときだけ未解決（open）。進行中の議論が見え続け、
 *   校了の前に解決が要る（利用者決定 1.A）。それ以外は解決済み（resolved）にし、履歴に「FB から移行」と残す。
 */

/** 解決済みで移すときの採否の理由（履歴に出る） */
export const FEEDBACK_MIGRATION_REASON = "FB から移行";
/** 移行が記録する操作者（履歴の採否の行に出る。人ではなく仕組みがした） */
export const FEEDBACK_MIGRATION_ACTOR = "system";

export type FeedbackMigrationRevision = Pick<
  Revision,
  "id" | "kind" | "sequence" | "submittedAt" | "reviewState"
>;

/** 返信になる投稿 */
export interface FeedbackMigrationReply {
  sourcePostId: string;
  authorId: string;
  body: string;
  mentions: string[];
  reactions: ReactionEntry[];
  createdAt: Instant;
  /** 移す添付（FB の添付の ID）。投稿が持つ順 */
  sourceFileIds: string[];
}

export interface FeedbackMigrationPlan {
  sourceThreadId: string;
  workId: string;
  revisionId: string;
  /** 移し先で未解決にするか（false なら解決済みにして履歴に残す） */
  resolution: "open" | "resolved";
  /** コメントのスレッド（添付の ID・やり取りは移した後に付ける） */
  thread: Omit<CommentThread, "id">;
  /** コメント本体になる投稿の添付（FB の添付の ID） */
  sourceFileIds: string[];
  replies: FeedbackMigrationReply[];
  /** 場所を持ち越したか（移し先の版が FB の版と違うときは持ち越さない） */
  anchorKept: boolean;
}

export type FeedbackMigrationDecision =
  | { kind: "skip"; reason: "not_live" | "no_posts" | "no_revision" }
  | { kind: "migrate"; plan: FeedbackMigrationPlan };

/** 版の新しさの順（提出時刻、同じなら通常版 → 版の番号） */
function newerFirst(a: FeedbackMigrationRevision, b: FeedbackMigrationRevision): number {
  return (
    b.submittedAt - a.submittedAt ||
    (b.kind === "standard" ? 1 : 0) - (a.kind === "standard" ? 1 : 0) ||
    b.sequence - a.sequence
  );
}

/** 制作物の最新の（void でない）版 */
export function latestNonVoidRevision(
  revisions: readonly FeedbackMigrationRevision[],
): FeedbackMigrationRevision | null {
  return [...revisions].filter((r) => r.reviewState !== "void").sort(newerFirst)[0] ?? null;
}

/** 移し先の版（スレッドの版が今もあればそれ、無ければ最新の void でない版）。無ければ null */
export function feedbackMigrationTarget(
  thread: Pick<FeedbackThread, "revisionId">,
  revisions: readonly FeedbackMigrationRevision[],
): { revision: FeedbackMigrationRevision; own: boolean } | null {
  const own =
    thread.revisionId === undefined ? undefined : revisions.find((r) => r.id === thread.revisionId);
  if (own) return { revision: own, own: true };
  const latest = latestNonVoidRevision(revisions);
  return latest ? { revision: latest, own: false } : null;
}

/** 本文の頭に足す題名の行。題名が本文から作られるものと同じなら足さない */
export function feedbackMigrationBody(
  thread: Pick<FeedbackThread, "title" | "anchor">,
  first: Pick<FeedbackPost, "body" | "fileIds">,
): string {
  const quote = thread.anchor?.type === "text_range" ? thread.anchor.quote : undefined;
  const derived = deriveFeedbackThreadTitle({
    body: first.body,
    ...(quote !== undefined ? { quote } : {}),
    fileCount: first.fileIds.length,
  });
  const title = thread.title.trim();
  return title !== "" && title !== derived ? `【${title}】\n${first.body}` : first.body;
}

/** 誰も付けていない絵文字を除いて写す */
const copyReactions = (reactions: readonly ReactionEntry[]): ReactionEntry[] =>
  reactions
    .filter((r) => r.userIds.length > 0)
    .map((r) => ({ emoji: r.emoji, userIds: [...r.userIds] }));

/**
 * FB のスレッド 1 つをどう移すか決める。posts はそのスレッドの全投稿（削除済みを含んでよい。古い順でなくてもよい）。
 * revisions は制作物の全ての版、workLifecycle は制作物の状態。
 */
export function planFeedbackThreadMigration(input: {
  thread: FeedbackThread;
  posts: readonly FeedbackPost[];
  revisions: readonly FeedbackMigrationRevision[];
  workLifecycle: WorkLifecycle;
}): FeedbackMigrationDecision {
  const { thread } = input;
  if (!isLiveFeedbackThread(thread)) return { kind: "skip", reason: "not_live" };
  const live = input.posts
    .filter((p) => p.deletedAt === undefined)
    .map((p, i) => ({ p, i }))
    .sort((a, b) => a.p.createdAt - b.p.createdAt || a.i - b.i)
    .map((x) => x.p);
  const first = live[0];
  if (!first) return { kind: "skip", reason: "no_posts" };
  const target = feedbackMigrationTarget(thread, input.revisions);
  if (!target) return { kind: "skip", reason: "no_revision" };

  const latestAccepting = [...input.revisions]
    .filter((r) => r.reviewState === "open")
    .sort(newerFirst)[0];
  const resolution: "open" | "resolved" =
    input.workLifecycle !== "finalized" && latestAccepting?.id === target.revision.id
      ? "open"
      : "resolved";

  // 場所は、FB が立てられた版へ移すときだけ持ち越す（別の版に移すと、場所の添付がその版のものでなくなる）
  const anchor: Anchor | undefined = target.own ? thread.anchor : undefined;
  const mentions = [...new Set(first.mentions)];
  const reactions = copyReactions(first.reactions);
  const data: Omit<CommentThread, "id"> = {
    revisionId: target.revision.id,
    authorId: first.authorId,
    body: feedbackMigrationBody(thread, first),
    kind: "correction",
    severity: "major",
    resolution: "open",
    createdAt: first.createdAt,
    migratedFromFeedbackThreadId: thread.id,
  };
  if (anchor) {
    data.anchor = anchor;
    data.artifactId = anchor.artifactId;
  }
  if (mentions.length) data.mentions = mentions;
  if (reactions.length) data.reactions = reactions;

  return {
    kind: "migrate",
    plan: {
      sourceThreadId: thread.id,
      workId: thread.workId,
      revisionId: target.revision.id,
      resolution,
      thread: data,
      sourceFileIds: [...first.fileIds],
      replies: live.slice(1).map((p) => ({
        sourcePostId: p.id,
        authorId: p.authorId,
        body: p.body,
        mentions: [...new Set(p.mentions)],
        reactions: copyReactions(p.reactions),
        createdAt: p.createdAt,
        sourceFileIds: [...p.fileIds],
      })),
      anchorKept: anchor !== undefined,
    },
  };
}

/**
 * 解決済みで移すときのスレッド。採否の遷移表（decideThread）を通すので、未解決から「反映済み」へ行けない状態にはならない
 */
export function resolveMigratedThread<T extends CommentThread>(thread: T): T {
  return decideThread(thread, "resolved", FEEDBACK_MIGRATION_REASON) as T;
}

/**
 * 移せる添付か（実体の検証が済んでいて、R2 に実体があり、放置扱いでないもの）。
 * そうでない添付（失敗・準備だけ・放置・削除済み）は移さない。
 */
export function isMigratableFeedbackFile(file: FeedbackFile): boolean {
  return (
    file.status === "verified" &&
    file.objectKey !== "" &&
    file.purgedAt === undefined &&
    file.abandonedAt === undefined
  );
}

/**
 * FB の添付をコメントの添付にする。R2 の実体はコピーせず、同じ objectKey（feedback/…）を指す。
 * 検証済みで付ける先がある状態にし、サムネイルは持たない（画面は原本から表示する）。
 * 付ける先の版はコメントの版にそろえる。移せない添付は null
 */
export function commentFileFromFeedbackFile(
  file: FeedbackFile,
  to: { threadId: string; revisionId: string },
): Omit<CommentFile, "id"> | null {
  if (!isMigratableFeedbackFile(file)) return null;
  const out: Omit<CommentFile, "id"> = {
    workId: file.workId,
    revisionId: to.revisionId,
    uploaderId: file.uploaderId,
    fileName: file.fileName,
    originalName: file.fileName,
    mimeType: file.mimeType,
    type: file.type,
    objectKey: file.objectKey,
    status: "verified",
    threadId: to.threadId,
    createdAt: file.createdAt,
  };
  if (file.declaredSize !== undefined) out.declaredSize = file.declaredSize;
  if (file.size !== undefined) out.size = file.size;
  if (file.sha256 !== undefined) out.sha256 = file.sha256;
  return out;
}
