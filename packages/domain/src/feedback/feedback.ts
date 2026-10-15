import { canViewWork, type AuthorizationContext } from "../acl/authorize.ts";
import type { Principal } from "../acl/Permission.ts";
import { MENTION_MAX } from "../comment/mentions.ts";
import { DomainError } from "../shared/DomainError.ts";
import type { UserId, WorkId } from "../shared/ids.ts";
import type { Instant } from "../shared/time.ts";

/**
 * 制作のフィードバック（表現の議論）。利用者決定 2026-10-15「Slack ではなく MF100 の中で議論する」。
 * - 制作物ごとに話題（スレッド）を複数立て、投稿を時系列に並べる。添付・テンプレート・メンション・リアクションを持つ。
 * - 正式な校正（版・コメント・採否）とは別物。版にも指摘にも変換しない。
 * - 見られる人: サインインした委員なら誰でも。機密区分が restricted の制作物だけは、その制作物を見られる人（canViewWork）。
 */

/** スレッドの題名の上限（文字数） */
export const FEEDBACK_TITLE_MAX = 80;
/** 投稿本文の上限（文字数） */
export const FEEDBACK_BODY_MAX = 5000;
/** 1 つの投稿に付けられるファイルの数 */
export const FEEDBACK_FILES_MAX = 10;
/** 使えるリアクション（この並びで表示する） */
export const FEEDBACK_REACTIONS = ["👍", "🙏", "👀", "🎉", "💡", "❤️"] as const;
export type FeedbackReaction = (typeof FEEDBACK_REACTIONS)[number];
/** 添付の置き場（R2 のオブジェクトキーの頭）。版の提出物（works/…）と名前空間を分ける */
export const FEEDBACK_OBJECT_PREFIX = "feedback/";
/** 投稿に付けないまま放置された添付を清掃の対象にするまでの時間 */
export const FEEDBACK_FILE_TTL_MS = 24 * 60 * 60 * 1000;

export const feedbackTemplateIds = ["creator_first", "creator_update", "reviewer"] as const;
export type FeedbackTemplateId = (typeof feedbackTemplateIds)[number];

export interface FeedbackThread {
  id: string;
  workId: WorkId;
  title: string;
  createdBy: UserId;
  createdAt: Instant;
  /** 最後に投稿された時刻（一覧の並び・未読の判定） */
  lastPostAt: Instant;
  /** 削除されていない投稿の数 */
  postCount: number;
  /** 投稿したことのある人（通知の宛先） */
  participantIds: UserId[];
}

export interface FeedbackReactionEntry {
  emoji: FeedbackReaction;
  userIds: UserId[];
}

export interface FeedbackPost {
  id: string;
  threadId: string;
  workId: WorkId;
  authorId: UserId;
  body: string;
  mentions: UserId[];
  fileIds: string[];
  template?: FeedbackTemplateId;
  reactions: FeedbackReactionEntry[];
  createdAt: Instant;
  editedAt?: Instant;
  /** 削除（論理削除）。一覧には「削除された投稿」として残し、本文・添付は出さない */
  deletedAt?: Instant;
}

export type FeedbackFileType = "pdf" | "image" | "document" | "other";
export type FeedbackFileStatus = "pending" | "uploaded" | "verified" | "failed";

export interface FeedbackFile {
  id: string;
  workId: WorkId;
  uploaderId: UserId;
  fileName: string;
  mimeType: string;
  type: FeedbackFileType;
  declaredSize?: number;
  size?: number;
  sha256?: string;
  /** R2 キーの名前空間（準備時に予約）。試行ごとのキーはこの下に作る */
  keyPrefix?: string;
  /** 採用された試行のキー（実体の検証が済んだときだけ。それまでは空文字） */
  objectKey: string;
  status: FeedbackFileStatus;
  /** 付けた投稿（付けるまでは未設定。付けた後は他の投稿に付け替えない） */
  postId?: string;
  createdAt: Instant;
  failureMessage?: string;
  /** 投稿に付けないまま期限を過ぎ、清掃の対象になった時刻 */
  abandonedAt?: Instant;
  /** R2 から実体を削除し終えた時刻（objectKey は履歴のため残す） */
  purgedAt?: Instant;
}

// ---------------------------------------------------------------- 権限

/**
 * フィードバックを見られるか。restricted の制作物はその制作物を見られる人だけ、それ以外はサインインした委員なら誰でも。
 * システム管理者でも restricted の制作物は職責か ACL が無ければ見られない（D3）。
 */
export function canViewFeedback(ctx: AuthorizationContext): boolean {
  if (ctx.work.confidentiality === "restricted") return canViewWork(ctx);
  return true;
}

/** 投稿できるか（見られる人は投稿できる） */
export function canPostFeedback(ctx: AuthorizationContext): boolean {
  return canViewFeedback(ctx);
}

/** 投稿の訂正・削除: 訂正は投稿した本人だけ、削除は本人かシステム管理者（運用上の削除）。削除済みには何もできない */
export function canModifyFeedbackPost(
  post: Pick<FeedbackPost, "authorId" | "deletedAt">,
  principal: Principal,
): { edit: boolean; delete: boolean } {
  if (post.deletedAt !== undefined) return { edit: false, delete: false };
  const own = post.authorId === principal.userId;
  return { edit: own, delete: own || principal.isSystemAdmin };
}

/** スレッドの題名の変更: 立てた本人かシステム管理者 */
export function canRenameFeedbackThread(
  thread: Pick<FeedbackThread, "createdBy">,
  principal: Principal,
): boolean {
  return thread.createdBy === principal.userId || principal.isSystemAdmin;
}

// ---------------------------------------------------------------- 検査

const invalid = (field: string, reason: string, extra: Record<string, unknown> = {}): never => {
  throw new DomainError("feedback_invalid", { field, reason, ...extra });
};

/** 題名: 前後の空白を除いて 1〜80 文字 */
export function validateFeedbackThreadTitle(title: string): string {
  const t = title.trim();
  if (t === "") invalid("title", "required");
  if (Array.from(t).length > FEEDBACK_TITLE_MAX)
    invalid("title", "too_long", { max: FEEDBACK_TITLE_MAX });
  return t;
}

/** 本文: 前後の空白を除く。空はファイルを付けた投稿だけ許す。5000 文字まで */
export function validateFeedbackBody(body: string, opts: { hasFiles: boolean }): string {
  const b = body.trim();
  if (b === "" && !opts.hasFiles) invalid("body", "required");
  if (Array.from(b).length > FEEDBACK_BODY_MAX)
    invalid("body", "too_long", { max: FEEDBACK_BODY_MAX });
  return b;
}

export function isFeedbackReaction(value: string): value is FeedbackReaction {
  return (FEEDBACK_REACTIONS as readonly string[]).includes(value);
}

export function validateFeedbackReaction(emoji: string): FeedbackReaction {
  if (!isFeedbackReaction(emoji)) invalid("emoji", "unknown");
  return emoji as FeedbackReaction;
}

export function validateFeedbackTemplate(
  template: string | undefined,
): FeedbackTemplateId | undefined {
  if (template === undefined || template === "") return undefined;
  if (!(feedbackTemplateIds as readonly string[]).includes(template))
    invalid("template", "unknown");
  return template as FeedbackTemplateId;
}

/** 添付の数（重複を除いて 10 件まで） */
export function validateFeedbackFileIds(fileIds: readonly string[] | undefined): string[] {
  const ids = [...new Set(fileIds ?? [])];
  if (ids.length > FEEDBACK_FILES_MAX) invalid("files", "too_many", { max: FEEDBACK_FILES_MAX });
  return ids;
}

/**
 * メンションの検査: 重複を除き、上限（コメントと同じ 10 人）を超えたら mention_too_many、
 * メンションできない人（restricted の制作物を見られない人・委員でない人）を含めば mention_not_allowed。
 */
export function validateFeedbackMentions(
  mentions: readonly string[] | undefined,
  isMentionable: (userId: string) => boolean,
): string[] {
  const ids = [...new Set(mentions ?? [])];
  if (ids.length > MENTION_MAX)
    throw new DomainError("mention_too_many", { count: ids.length, max: MENTION_MAX });
  for (const id of ids)
    if (!isMentionable(id)) throw new DomainError("mention_not_allowed", { userId: id });
  return ids;
}

// ---------------------------------------------------------------- リアクション

/** リアクションを付ける・外す（同じ人が同じ絵文字を押すと外れる）。誰も付けていない絵文字は消す */
export function toggleFeedbackReaction(
  post: FeedbackPost,
  emoji: FeedbackReaction,
  userId: UserId,
): FeedbackPost {
  validateFeedbackReaction(emoji);
  const reactions = post.reactions.map((r) => ({ emoji: r.emoji, userIds: [...r.userIds] }));
  const entry = reactions.find((r) => r.emoji === emoji);
  if (!entry) reactions.push({ emoji, userIds: [userId] });
  else if (entry.userIds.includes(userId))
    entry.userIds = entry.userIds.filter((id) => id !== userId);
  else entry.userIds.push(userId);
  const order = (e: FeedbackReaction) => FEEDBACK_REACTIONS.indexOf(e);
  return {
    ...post,
    reactions: reactions
      .filter((r) => r.userIds.length > 0)
      .sort((a, b) => order(a.emoji) - order(b.emoji)),
  };
}

/** 表示用の集計（絵文字・人数・自分が付けたか）。決まった並びで、0 人の絵文字は出さない */
export function summarizeFeedbackReactions(
  reactions: readonly FeedbackReactionEntry[],
  viewerId: UserId,
): Array<{ emoji: FeedbackReaction; count: number; mine: boolean }> {
  return FEEDBACK_REACTIONS.flatMap((emoji) => {
    const r = reactions.find((x) => x.emoji === emoji);
    if (!r || r.userIds.length === 0) return [];
    return [{ emoji, count: r.userIds.length, mine: r.userIds.includes(viewerId) }];
  });
}

// ---------------------------------------------------------------- 添付

const IMAGE_MIME = new Set(["image/png", "image/jpeg", "image/gif", "image/webp", "image/avif"]);
const IMAGE_EXT = new Set(["png", "jpg", "jpeg", "gif", "webp", "avif"]);
const DOCUMENT_EXT = new Set(["txt", "md", "doc", "docx"]);

/**
 * 添付の種類: PDF と画像は投稿の中に表示し、それ以外（.ai など）はダウンロードだけ。
 * SVG は中にスクリプトを持てるので画像として表示しない（other）。
 */
export function feedbackFileType(mimeType: string, fileName: string): FeedbackFileType {
  const mime = mimeType.toLowerCase().split(";")[0]!.trim();
  const ext = /\.([a-z0-9]+)$/i.exec(fileName)?.[1]?.toLowerCase() ?? "";
  if (mime === "application/pdf" || ext === "pdf") return "pdf";
  if (IMAGE_MIME.has(mime) || (mime === "" && IMAGE_EXT.has(ext))) return "image";
  if (mime === "text/plain" || mime === "text/markdown" || DOCUMENT_EXT.has(ext)) return "document";
  return "other";
}

/** 添付のファイル名の検査（1〜200 文字） */
export function validateFeedbackFileName(fileName: string): string {
  const n = fileName.trim();
  if (n === "") invalid("fileName", "required");
  if (Array.from(n).length > 200) invalid("fileName", "too_long", { max: 200 });
  return n;
}

/**
 * R2 キーの名前空間: feedback/{制作物}/{添付 ID}/{ファイル名}。推測困難な ID で名前空間を分ける。
 * 実体はこの下の試行ごとのキー（uploadAttemptObjectKey）に置く。
 */
export function feedbackObjectKey(workId: WorkId, fileId: string, fileName: string): string {
  const safe = fileName.replace(/[^\w.\-぀-ヿ一-龯]+/g, "_").slice(0, 120) || "file";
  return `${FEEDBACK_OBJECT_PREFIX}${workId}/${fileId}/${safe}`;
}

/**
 * R2 上の実体確認が済んだことを記録する（版の提出の markItemVerified と同じ意味）。申告サイズと違えば failed。
 * objectKey は検証した試行のキー。成功したときだけ添付が参照する（採用）。
 */
export function verifyFeedbackFile(
  file: FeedbackFile,
  meta: { size: number; sha256: string; objectKey: string },
): FeedbackFile {
  if (file.declaredSize !== undefined && file.declaredSize !== meta.size) {
    return {
      ...file,
      status: "failed",
      failureMessage: `サイズ不一致: 申告 ${file.declaredSize} / 実体 ${meta.size}`,
    };
  }
  const next: FeedbackFile = {
    ...file,
    status: "verified",
    size: meta.size,
    sha256: meta.sha256,
    objectKey: meta.objectKey,
  };
  delete next.failureMessage;
  return next;
}

/** 失敗を記録する。検証済み（採用済み）の添付は、別の試行の失敗や遅れた補償で failed に戻さない */
export function failFeedbackFile(file: FeedbackFile, message: string): FeedbackFile {
  if (file.status === "verified") return file;
  return { ...file, status: "failed", failureMessage: message };
}

/** アップロードを受け付けられる添付か（本人の・投稿に付ける前の・放置されていない・未検証のもの） */
export function assertFeedbackFileUploadable(file: FeedbackFile, uploaderId: UserId): void {
  if (file.uploaderId !== uploaderId)
    throw new DomainError("feedback_not_found", { fileId: file.id });
  if (file.postId !== undefined || file.abandonedAt !== undefined || file.keyPrefix === undefined)
    throw new DomainError("feedback_invalid", { fileId: file.id, reason: "closed" });
  if (file.status === "verified")
    throw new DomainError("feedback_invalid", { fileId: file.id, reason: "already_verified" });
}

/** 投稿に付けられる添付か（本人が同じ制作物に上げた・検証済みの・まだどの投稿にも付けていないもの） */
export function assertFeedbackFileAttachable(
  file: FeedbackFile | null,
  fileId: string,
  by: { uploaderId: UserId; workId: WorkId },
): FeedbackFile {
  if (
    !file ||
    file.uploaderId !== by.uploaderId ||
    file.workId !== by.workId ||
    file.status !== "verified" ||
    file.postId !== undefined ||
    file.abandonedAt !== undefined
  )
    throw new DomainError("feedback_file_not_ready", {
      fileId,
      fileName: file?.fileName ?? null,
      status: file?.status ?? null,
    });
  return file;
}

/** 放置された添付か（投稿に付けないまま期限を過ぎた） */
export function isFeedbackFileStale(file: FeedbackFile, now: Instant): boolean {
  return (
    file.postId === undefined &&
    file.abandonedAt === undefined &&
    now - file.createdAt >= FEEDBACK_FILE_TTL_MS
  );
}

// ---------------------------------------------------------------- テンプレート

/**
 * 投稿のテンプレート（利用者の FB 提案から）。見出し【】の下に「・」の観点を並べ、節の間は 1 行空ける。
 * 制作者は初回と版の更新で使い分け、校正er は 1 種類。
 */
export const feedbackTemplates: ReadonlyArray<{
  id: FeedbackTemplateId;
  label: string;
  role: "creator" | "reviewer";
  body: string;
}> = [
  {
    id: "creator_first",
    label: "制作者・初回",
    role: "creator",
    body: [
      "【この案の意図】",
      "・意識したこと",
      "・この表現にした理由",
      "",
      "【今回見てほしい点】",
      "・迷っていること",
      "・判断したいこと",
      "",
      "【補足〈必要な場合のみ〉】",
      "・リファレンス",
      "・未確定・未調整の部分",
      "・変更できない条件",
    ].join("\n"),
  },
  {
    id: "creator_update",
    label: "制作者・版更新",
    role: "creator",
    body: [
      "【変更した点】",
      "・なぜその変更をしたか",
      "・どこを変更したか",
      "・この表現にした理由",
      "",
      "【補足〈必要な場合のみ〉】",
      "・変更によって生まれた新たな迷い",
      "・まだ見てほしい点",
    ].join("\n"),
  },
  {
    id: "reviewer",
    label: "校正er",
    role: "reviewer",
    body: [
      "【初見の印象】",
      "・パッと見た時に感じた全体のイメージ",
      "・見受けられる方向性の言語化",
      "",
      "【よく機能しているところ】",
      "・目的に沿っている箇所",
      "・表現がうまく使えている箇所",
      "・さらに狙うならどのようにすればいいか",
      "",
      "【改善できそうなところ】",
      "・意図を確認する質問",
      "・リファレンスを用いた解説",
      "・具体的な提案",
      "・整列などは具体的に言い過ぎず、どの観点で気になるかを述べる",
    ].join("\n"),
  },
];

export function feedbackTemplate(id: FeedbackTemplateId) {
  return feedbackTemplates.find((t) => t.id === id)!;
}
