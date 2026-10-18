import {
  adoptAttempt,
  anchorFitsArtifact,
  assertAttemptAdoptable,
  discardAttempt,
  assertFeedbackFileAttachable,
  assertFeedbackFileUploadable,
  canModifyFeedbackPost,
  canPostFeedback,
  canRenameFeedbackThread,
  canViewFeedback,
  computeWorkStats,
  deriveFeedbackThreadTitle,
  feedbackExcerptSource,
  DomainError,
  failFeedbackFile,
  FEEDBACK_FILE_TTL_MS,
  FEEDBACK_FILES_MAX,
  feedbackFileType,
  feedbackObjectKey,
  mentionableUserIds,
  revisionLabel,
  summarizeFeedbackReactions,
  toggleFeedbackReaction as toggleReaction,
  validateFeedbackBody,
  validateFeedbackFileIds,
  validateFeedbackFileName,
  validateFeedbackMentions,
  validateFeedbackReaction,
  validateFeedbackTemplate,
  validateAnchor,
  validateFeedbackThreadTitle,
  verifyFeedbackFile,
  workMatchesTeam,
  type Confidentiality,
  type FeedbackFile,
  type FeedbackFileStatus,
  type FeedbackFileType,
  type FeedbackPost,
  type FeedbackReaction,
  type FeedbackTemplateId,
  type Anchor,
  type FeedbackThread,
  type MediaType,
  type Principal,
  type Work,
  type WorkLifecycle,
  type WorkPermissionGrant,
  type WorkStatsRow,
} from "@mf100/domain";
import type { AppContext, PersonProfile } from "../ports.ts";
import { canView, principalOf, searchPeopleByText } from "../shared.ts";
import { about, excerpt, notify, personName } from "./notifications.ts";
import { loadOwnUploadAttempt, reserveUploadAttempt } from "./uploadAttempts.ts";

/*
 * 制作のフィードバック（表現の議論）。利用者決定 2026-10-15。
 * - 制作物ごとにスレッドを複数立て、委員が Slack の代わりに議論する。正式な校正（版・コメント・採否）には変換しない。
 * - 見られる人・投稿できる人は domain の canViewFeedback（restricted の制作物はその制作物を見られる人だけ）。
 * - 見られない人には、スレッドも制作物も「無い」のと同じに見せる（forbidden / 一覧に出さない）。
 */

const UNKNOWN_NAME = "（不明なユーザー）";
const DELETED_PLACEHOLDER = "削除された投稿";

interface LoadedFeedbackWork {
  work: Work;
  grants: WorkPermissionGrant[];
}

/** 制作物を読み、フィードバックを見られるか確かめる。見られなければ存在を漏らさない */
async function loadFeedbackWork(
  ctx: AppContext,
  principal: Principal,
  workId: string,
): Promise<LoadedFeedbackWork> {
  const work = await ctx.works.findById(workId);
  if (!work) throw new DomainError("forbidden", { workId });
  const grants = await ctx.acl.listByWork(workId);
  if (!canViewFeedback({ work, grants, principal })) throw new DomainError("forbidden", { workId });
  return { work, grants };
}

async function loadThread(
  ctx: AppContext,
  principal: Principal,
  threadId: string,
): Promise<LoadedFeedbackWork & { thread: FeedbackThread }> {
  const thread = await ctx.feedback.findThread(threadId);
  if (!thread) throw new DomainError("feedback_not_found", { threadId });
  try {
    return { thread, ...(await loadFeedbackWork(ctx, principal, thread.workId)) };
  } catch (e) {
    // 見られないスレッドは「無い」と同じに見せる
    if (e instanceof DomainError && e.code === "forbidden")
      throw new DomainError("feedback_not_found", { threadId });
    throw e;
  }
}

async function loadPost(ctx: AppContext, principal: Principal, postId: string) {
  const post = await ctx.feedback.findPost(postId);
  if (!post) throw new DomainError("feedback_not_found", { postId });
  const loaded = await loadThread(ctx, principal, post.threadId);
  return { post, ...loaded };
}

async function nameOf(ctx: AppContext, userId: string): Promise<string> {
  return (await ctx.people.displayName(userId).catch(() => null)) ?? UNKNOWN_NAME;
}

/** 名前の引き当て（同じ人を何度も引かない） */
function nameCache(ctx: AppContext) {
  const cache = new Map<string, Promise<string>>();
  return (userId: string) => {
    let hit = cache.get(userId);
    if (!hit) cache.set(userId, (hit = nameOf(ctx, userId)));
    return hit;
  };
}

// ---------------------------------------------------------------- メンション

/** メンションできる人の判定（restricted は制作物を見られる人、それ以外は委員） */
async function mentionPolicy(
  ctx: AppContext,
  { work, grants }: LoadedFeedbackWork,
  ids: readonly string[],
): Promise<(userId: string) => boolean> {
  if (work.confidentiality === "restricted") {
    const allowed = new Set(mentionableUserIds(work, grants, await ctx.teams.list()));
    return (id) => allowed.has(id);
  }
  const members = new Set((await ctx.people.profiles([...new Set(ids)])).map((p) => p.id));
  return (id) => members.has(id);
}

async function validateMentionsFor(
  ctx: AppContext,
  loaded: LoadedFeedbackWork,
  mentions: readonly string[] | undefined,
): Promise<string[]> {
  const ids = mentions ?? [];
  // 上限の検査を先に（大量の ID で名簿を引かない）
  validateFeedbackMentions(ids, () => true);
  return validateFeedbackMentions(ids, await mentionPolicy(ctx, loaded, ids));
}

/**
 * メンションの候補（その制作物のフィードバックでメンションできる人。自分は除く）。名前順。
 * restricted は制作物を見られる人、それ以外は一度でもサインインした委員（500 人まで）。
 */
export async function listFeedbackMentionCandidates(
  ctx: AppContext,
  principal: Principal,
  workId: string,
): Promise<PersonProfile[]> {
  const { work, grants } = await loadFeedbackWork(ctx, principal, workId);
  const people =
    work.confidentiality === "restricted"
      ? await ctx.people.profiles(mentionableUserIds(work, grants, await ctx.teams.list()))
      : await ctx.people.listMembers(500);
  return people
    .filter((p) => p.id !== principal.userId)
    .sort((a, b) => a.name.localeCompare(b.name, "ja"))
    .slice(0, 500);
}

/** メンションの候補を名前・メールで絞る（10 人まで） */
/**
 * メンションの候補を「@」に続けて打った文字で探す（名前・メールの部分一致。名前順・limit 人まで。自分は除く）。
 * 画面は候補の一覧を丸ごと購読せず、打つたびにこの検索を引く（docs/UI_M3E.md §60）。
 */
export async function searchFeedbackPeople(
  ctx: AppContext,
  principal: Principal,
  input: { workId: string; text: string; limit?: number },
): Promise<PersonProfile[]> {
  return searchPeopleByText(
    await listFeedbackMentionCandidates(ctx, principal, input.workId),
    input.text,
    input.limit,
  );
}

// ---------------------------------------------------------------- 一覧・詳細

/** スレッドが指す版（無効化・削除で無くなっていれば null） */
async function revisionRef(
  ctx: AppContext,
  thread: FeedbackThread,
): Promise<{ id: string; label: string; number: number } | null> {
  if (thread.revisionId === undefined) return null;
  const r = await ctx.revisions.findById(thread.revisionId);
  // number: URL の版番号（0版は 0）。/works/:id/v/:n で開く
  return r
    ? { id: r.id, label: revisionLabel(r), number: r.kind === "rough" ? 0 : r.sequence }
    : null;
}

export interface FeedbackThreadSummary {
  id: string;
  workId: string;
  workTitle: string;
  confidentiality: Confidentiality;
  title: string;
  createdBy: { id: string; name: string };
  createdAt: number;
  lastPostAt: number;
  postCount: number;
  /** 版の上の場所についての相談なら、その版と場所（紙面に印を出し、押すとその場所を開く） */
  revision: { id: string; label: string; number: number } | null;
  anchor: Anchor | null;
  /** 最後の（削除されていない）投稿。本文が空ならファイルの数を書く */
  lastPost: {
    author: { id: string; name: string };
    authorName: string;
    excerpt: string;
    createdAt: number;
  } | null;
  unread: boolean;
}

/**
 * スレッドの一覧（最後の投稿が新しい順）。見られる制作物のものだけ。
 * mine: 自分が投稿したことのあるスレッドだけ。
 */
export async function listFeedbackThreads(
  ctx: AppContext,
  principal: Principal,
  input: { workId?: string; revisionId?: string; mine?: boolean; limit?: number } = {},
): Promise<FeedbackThreadSummary[]> {
  const limit = Math.min(Math.max(input.limit ?? 50, 1), 200);
  if (input.workId !== undefined) await loadFeedbackWork(ctx, principal, input.workId);
  const candidates = await ctx.feedback.listThreads({
    ...(input.workId !== undefined ? { workId: input.workId } : {}),
    limit: Math.min(limit * 4, 500),
  });
  const works = new Map<string, Work | null>();
  const name = nameCache(ctx);
  const out: FeedbackThreadSummary[] = [];
  for (const thread of candidates) {
    if (out.length >= limit) break;
    if (input.mine && !thread.participantIds.includes(principal.userId)) continue;
    if (input.revisionId !== undefined && thread.revisionId !== input.revisionId) continue;
    if (!works.has(thread.workId)) {
      const work = await ctx.works.findById(thread.workId);
      const visible =
        work && canViewFeedback({ work, grants: await ctx.acl.listByWork(work.id), principal });
      works.set(thread.workId, visible ? work : null);
    }
    const work = works.get(thread.workId);
    if (!work) continue;
    const posts = await ctx.feedback.listPosts(thread.id);
    const last = [...posts].reverse().find((p) => p.deletedAt === undefined) ?? null;
    const readAt = await ctx.feedback.readAt(principal.userId, thread.id);
    out.push({
      id: thread.id,
      workId: work.id,
      workTitle: work.title,
      confidentiality: work.confidentiality,
      title: thread.title,
      createdBy: { id: thread.createdBy, name: await name(thread.createdBy) },
      createdAt: thread.createdAt,
      lastPostAt: thread.lastPostAt,
      postCount: thread.postCount,
      revision: await revisionRef(ctx, thread),
      anchor: thread.anchor ?? null,
      lastPost: last
        ? {
            author: { id: last.authorId, name: await name(last.authorId) },
            authorName: await name(last.authorId),
            excerpt: feedbackExcerptSource(last.body)
              ? excerpt(feedbackExcerptSource(last.body), 80)
              : `ファイル ${last.fileIds.length} 件`,
            createdAt: last.createdAt,
          }
        : null,
      unread: readAt === null || readAt < thread.lastPostAt,
    });
  }
  return out;
}

/**
 * 制作物ごとの FB（相談）の数と未読の数（制作物一覧で、FB がある制作物と新しい投稿を示す）。
 * 呼び出し側が見られる制作物だけを渡す（自分が関わる制作物の一覧）。
 */
export async function summarizeFeedbackActivity(
  ctx: AppContext,
  principal: Principal,
  workIds: readonly string[],
): Promise<Map<string, { threads: number; unread: number }>> {
  const out = new Map<string, { threads: number; unread: number }>();
  for (const workId of workIds) {
    const threads = await ctx.feedback.listThreads({ workId, limit: 200 });
    let unread = 0;
    for (const t of threads) {
      const readAt = await ctx.feedback.readAt(principal.userId, t.id);
      if (readAt === null || readAt < t.lastPostAt) unread++;
    }
    out.set(workId, { threads: threads.length, unread });
  }
  return out;
}

/**
 * 制作物ごとの FB スペース（Slack のチャンネルに当たる。利用者決定 2026-10-16「制作物ごとに一つの FB スペース」）。
 * スペースの中に、紙面の範囲についてのスレッドと、制作物全体についてのスレッドが立つ。
 */
export interface FeedbackSpaceSummary {
  workId: string;
  title: string;
  confidentiality: Confidentiality;
  mediaType: MediaType;
  lifecycle: WorkLifecycle;
  /** 制作物そのもの（紙面）を見られるか。見られなくても FB は読み書きできる（委員なら誰でも） */
  canOpen: boolean;
  threads: number;
  unread: number;
  /** いちばん新しい投稿の時刻（スレッドが無ければ null） */
  lastPostAt: number | null;
  /** いちばん新しい版（無効にした版を除く。まだ版が無ければ null） */
  latestRevision: { id: string; label: string; number: number } | null;
}

/**
 * FB スペースの一覧: その人が FB を見られる制作物ぜんぶ（非公開は閲覧権限のある人だけ）。
 * 新しい投稿のあったスペースが上、スレッドの無いスペースは題名順で下。
 */
export async function listFeedbackSpaces(
  ctx: AppContext,
  principal: Principal,
  input: { limit?: number } = {},
): Promise<FeedbackSpaceSummary[]> {
  const limit = Math.min(Math.max(input.limit ?? 300, 1), 500);
  const out: FeedbackSpaceSummary[] = [];
  for (const work of await ctx.works.list(500)) {
    const grants = await ctx.acl.listByWork(work.id);
    if (!canViewFeedback({ work, grants, principal })) continue;
    const threads = await ctx.feedback.listThreads({ workId: work.id, limit: 200 });
    let unread = 0;
    let lastPostAt: number | null = null;
    for (const t of threads) {
      const readAt = await ctx.feedback.readAt(principal.userId, t.id);
      if (readAt === null || readAt < t.lastPostAt) unread++;
      if (lastPostAt === null || t.lastPostAt > lastPostAt) lastPostAt = t.lastPostAt;
    }
    const latest = (await ctx.revisions.listByWork(work.id))
      .filter((r) => r.reviewState !== "void")
      .sort((a, b) => b.submittedAt - a.submittedAt)[0];
    out.push({
      workId: work.id,
      title: work.title,
      confidentiality: work.confidentiality,
      mediaType: work.mediaType,
      lifecycle: work.lifecycle,
      canOpen: await canView(ctx, principal, work, grants),
      threads: threads.length,
      unread,
      lastPostAt,
      latestRevision: latest
        ? {
            id: latest.id,
            label: revisionLabel(latest),
            number: latest.kind === "rough" ? 0 : latest.sequence,
          }
        : null,
    });
  }
  out.sort(
    (a, b) => (b.lastPostAt ?? -1) - (a.lastPostAt ?? -1) || a.title.localeCompare(b.title, "ja"),
  );
  return out.slice(0, limit);
}

export interface FeedbackFileView {
  id: string;
  fileName: string;
  mimeType: string;
  type: FeedbackFileType;
  size: number | null;
  status: FeedbackFileStatus;
}

export interface FeedbackPostView {
  id: string;
  /** isCreator: その制作物の制作者か（スレッドでは制作者だけ示す。利用者指示 2026-10-18） */
  author: { id: string; name: string; isCreator: boolean };
  /** 削除された投稿は「削除された投稿」（ファイル・メンション・リアクションは空） */
  body: string;
  deleted: boolean;
  mentions: Array<{ id: string; name: string }>;
  files: FeedbackFileView[];
  template?: FeedbackTemplateId;
  reactions: Array<{ emoji: FeedbackReaction; count: number; mine: boolean }>;
  createdAt: number;
  editedAt?: number;
  can: { edit: boolean; delete: boolean };
}

export interface FeedbackThreadView {
  thread: {
    id: string;
    workId: string;
    title: string;
    createdBy: { id: string; name: string };
    createdAt: number;
    lastPostAt: number;
    postCount: number;
    participants: Array<{ id: string; name: string }>;
    revision: { id: string; label: string; number: number } | null;
    anchor: Anchor | null;
  };
  work: {
    id: string;
    title: string;
    confidentiality: Confidentiality;
    lifecycle: WorkLifecycle;
    mediaType: MediaType;
    /** 制作物そのもの（版・エディタ）を開けるか（work.view）。通常の制作物では関与の無い委員は false */
    canOpen: boolean;
  };
  posts: FeedbackPostView[];
  can: { post: boolean; editOwn: true; rename: boolean };
  /** 開いた人がこのスレッドを最後に読んだ時刻（未読の区切りを引く。読んだことが無ければ null） */
  readAt: number | null;
}

/** スレッドを開く（投稿は古い順）。既読の印は markFeedbackRead で別に付ける */
export async function getFeedbackThread(
  ctx: AppContext,
  principal: Principal,
  threadId: string,
): Promise<FeedbackThreadView> {
  const { thread, work, grants } = await loadThread(ctx, principal, threadId);
  const name = nameCache(ctx);
  const posts: FeedbackPostView[] = [];
  for (const p of await ctx.feedback.listPosts(thread.id)) {
    const author = {
      id: p.authorId,
      name: await name(p.authorId),
      isCreator: work.creatorIds.includes(p.authorId),
    };
    if (p.deletedAt !== undefined) {
      posts.push({
        id: p.id,
        author,
        body: DELETED_PLACEHOLDER,
        deleted: true,
        mentions: [],
        files: [],
        reactions: [],
        createdAt: p.createdAt,
        can: { edit: false, delete: false },
      });
      continue;
    }
    const files: FeedbackFileView[] = [];
    for (const id of p.fileIds) {
      const f = await ctx.feedback.findFile(id);
      if (!f) continue;
      files.push({
        id: f.id,
        fileName: f.fileName,
        mimeType: f.mimeType,
        type: f.type,
        size: f.size ?? null,
        status: f.status,
      });
    }
    const mentions = [];
    for (const id of p.mentions) mentions.push({ id, name: await name(id) });
    posts.push({
      id: p.id,
      author,
      body: p.body,
      deleted: false,
      mentions,
      files,
      ...(p.template !== undefined ? { template: p.template } : {}),
      reactions: summarizeFeedbackReactions(p.reactions, principal.userId),
      createdAt: p.createdAt,
      ...(p.editedAt !== undefined ? { editedAt: p.editedAt } : {}),
      can: canModifyFeedbackPost(p, principal),
    });
  }
  const participants = [];
  for (const id of thread.participantIds) participants.push({ id, name: await name(id) });
  return {
    thread: {
      id: thread.id,
      workId: thread.workId,
      title: thread.title,
      createdBy: { id: thread.createdBy, name: await name(thread.createdBy) },
      createdAt: thread.createdAt,
      lastPostAt: thread.lastPostAt,
      postCount: thread.postCount,
      participants,
      revision: await revisionRef(ctx, thread),
      anchor: thread.anchor ?? null,
    },
    work: {
      id: work.id,
      title: work.title,
      confidentiality: work.confidentiality,
      lifecycle: work.lifecycle,
      mediaType: work.mediaType,
      canOpen: await canView(ctx, principal, work, grants),
    },
    posts,
    can: {
      post: canPostFeedback({ work, grants, principal }),
      editOwn: true,
      rename: canRenameFeedbackThread(thread, principal),
    },
    readAt: await ctx.feedback.readAt(principal.userId, thread.id),
  };
}

// ---------------------------------------------------------------- 投稿

export interface FeedbackPostInput {
  body: string;
  mentions?: string[];
  fileIds?: string[];
  template?: string;
}

interface CheckedPost {
  body: string;
  mentions: string[];
  files: FeedbackFile[];
  template: FeedbackTemplateId | undefined;
}

async function checkPost(
  ctx: AppContext,
  principal: Principal,
  loaded: LoadedFeedbackWork,
  input: FeedbackPostInput,
): Promise<CheckedPost> {
  if (!canPostFeedback({ ...loaded, principal }))
    throw new DomainError("forbidden", { workId: loaded.work.id });
  const fileIds = validateFeedbackFileIds(input.fileIds);
  const body = validateFeedbackBody(input.body, { hasFiles: fileIds.length > 0 });
  const template = validateFeedbackTemplate(input.template);
  const mentions = await validateMentionsFor(ctx, loaded, input.mentions);
  const files: FeedbackFile[] = [];
  for (const id of fileIds)
    files.push(
      assertFeedbackFileAttachable(await ctx.feedback.findFile(id), id, {
        uploaderId: principal.userId,
        workId: loaded.work.id,
      }),
    );
  return { body, mentions, files, template };
}

/** 投稿を書き込み、添付を投稿に結び付け、スレッドの最終投稿・参加者を進める。通知も送る */
async function writePost(
  ctx: AppContext,
  principal: Principal,
  loaded: LoadedFeedbackWork,
  thread: FeedbackThread,
  checked: CheckedPost,
  opts: { isNewThread: boolean },
): Promise<FeedbackPost> {
  const now = ctx.clock.now();
  const data: Omit<FeedbackPost, "id"> = {
    threadId: thread.id,
    workId: thread.workId,
    authorId: principal.userId,
    body: checked.body,
    mentions: checked.mentions,
    fileIds: checked.files.map((f) => f.id),
    reactions: [],
    createdAt: now,
  };
  if (checked.template !== undefined) data.template = checked.template;
  const post = await ctx.feedback.insertPost(data);
  for (const f of checked.files) await ctx.feedback.updateFile({ ...f, postId: post.id });
  const previousParticipants = thread.participantIds;
  const participantIds = previousParticipants.includes(principal.userId)
    ? previousParticipants
    : [...previousParticipants, principal.userId];
  await ctx.feedback.updateThread({
    ...thread,
    lastPostAt: now,
    postCount: opts.isNewThread ? thread.postCount : thread.postCount + 1,
    participantIds,
  });
  // 自分の投稿で未読にしない
  await ctx.feedback.markRead(principal.userId, thread.id, now);

  const text = checked.body || `ファイルを ${checked.files.length} 件添付しました`;
  await notifyFeedback(ctx, principal, loaded, thread, {
    recipients: [...previousParticipants, ...loaded.work.creatorIds],
    mentions: checked.mentions,
    text,
    title: opts.isNewThread ? "新しいフィードバック" : "フィードバックに新しい投稿",
  });
  return post;
}

/**
 * 通知: スレッドの参加者と制作者には「新しい投稿」、メンションされた人には「メンション」だけ（重ねない）。
 * 本人には送らない。restricted の制作物では、今は見られない人に送らない。
 */
async function notifyFeedback(
  ctx: AppContext,
  principal: Principal,
  { work, grants }: LoadedFeedbackWork,
  thread: FeedbackThread,
  msg: { recipients: string[]; mentions: string[]; text: string; title: string | null },
): Promise<void> {
  // 非公開の制作物は見られる人だけに知らせる（担当の所属も数える）
  const teams = work.confidentiality === "restricted" ? await ctx.teams.list() : [];
  const canSee = (userId: string) =>
    canViewFeedback({ work, grants, principal: principalOf(userId, teams) });
  const who = await personName(ctx, principal.userId);
  const head = about(work.title, `のスレッド「${excerpt(thread.title, 40)}」`, who);
  const at = { workId: work.id, threadId: thread.id };
  if (msg.title !== null)
    await notify(
      ctx,
      msg.recipients.filter((id) => !msg.mentions.includes(id) && canSee(id)),
      principal.userId,
      {
        kind: "feedback_posted",
        title: msg.title,
        body: `${head}: ${excerpt(msg.text)}`,
        preview: msg.text,
        ...at,
      },
    );
  if (msg.mentions.length)
    await notify(ctx, msg.mentions, principal.userId, {
      kind: "feedback_mentioned",
      title: "フィードバックでメンションされました",
      body: `${head}: ${excerpt(msg.text)}`,
      preview: msg.text,
      ...at,
    });
}

/**
 * スレッドを立てる（最初の投稿も作る）。スレッドの ID を返す。
 * 版の上の場所から立てるとき（エディタで範囲を選んで「相談」）は revisionId と anchor を付ける。
 * 相談は解決しない話し合いなので、受付が終わった版・校了した版にも立てられる。
 * 題名は省ける（本文の 1 行目・引用から作る）。
 */
export async function createFeedbackThread(
  ctx: AppContext,
  principal: Principal,
  input: FeedbackPostInput & {
    workId: string;
    title?: string;
    revisionId?: string;
    anchor?: Anchor;
  },
): Promise<string> {
  const loaded = await loadFeedbackWork(ctx, principal, input.workId);
  const place = await checkPlace(ctx, loaded.work.id, input);
  const checked = await checkPost(ctx, principal, loaded, input);
  const title = input.title?.trim()
    ? validateFeedbackThreadTitle(input.title)
    : deriveFeedbackThreadTitle({
        body: checked.body,
        ...(place.anchor?.type === "text_range" ? { quote: place.anchor.quote } : {}),
        fileCount: checked.files.length,
      });
  const now = ctx.clock.now();
  const thread = await ctx.feedback.insertThread({
    workId: loaded.work.id,
    title,
    createdBy: principal.userId,
    createdAt: now,
    lastPostAt: now,
    postCount: 1,
    participantIds: [],
    ...place,
  });
  await writePost(ctx, principal, loaded, thread, checked, { isNewThread: true });
  return thread.id;
}

/** 相談の場所: 版はその制作物のもの、場所の添付はその版のもの（コメントと同じ検査） */
async function checkPlace(
  ctx: AppContext,
  workId: string,
  input: { revisionId?: string; anchor?: Anchor },
): Promise<{ revisionId?: string; anchor?: Anchor }> {
  if (input.revisionId === undefined) {
    if (input.anchor) throw new DomainError("anchor_invalid", { reason: "revision_required" });
    return {};
  }
  const revision = await ctx.revisions.findById(input.revisionId);
  if (!revision || revision.workId !== workId)
    throw new DomainError("forbidden", { revisionId: input.revisionId });
  if (!input.anchor) return { revisionId: revision.id };
  validateAnchor(input.anchor);
  const artifact = await ctx.artifacts.findById(input.anchor.artifactId);
  if (
    !artifact ||
    artifact.revisionId !== revision.id ||
    !anchorFitsArtifact(input.anchor, artifact)
  )
    throw new DomainError("anchor_artifact_mismatch", {
      artifactId: input.anchor.artifactId,
      revisionId: revision.id,
    });
  return { revisionId: revision.id, anchor: input.anchor };
}

/** スレッドに投稿する。投稿の ID を返す */
export async function postFeedback(
  ctx: AppContext,
  principal: Principal,
  input: FeedbackPostInput & { threadId: string },
): Promise<string> {
  const { thread, ...loaded } = await loadThread(ctx, principal, input.threadId);
  const checked = await checkPost(ctx, principal, loaded, input);
  const post = await writePost(ctx, principal, loaded, thread, checked, { isNewThread: false });
  return post.id;
}

/**
 * 投稿の訂正（本人だけ）。本文とメンションを変える（mentions を省くと今のまま）。
 * 新しくメンションした人にだけ知らせる
 */
export async function editFeedbackPost(
  ctx: AppContext,
  principal: Principal,
  input: { postId: string; body: string; mentions?: string[] },
): Promise<void> {
  const { post, thread, ...loaded } = await loadPost(ctx, principal, input.postId);
  if (!canModifyFeedbackPost(post, principal).edit)
    throw new DomainError("forbidden", { postId: post.id });
  const body = validateFeedbackBody(input.body, { hasFiles: post.fileIds.length > 0 });
  const mentions = await validateMentionsFor(ctx, loaded, input.mentions ?? post.mentions);
  await ctx.feedback.updatePost({ ...post, body, mentions, editedAt: ctx.clock.now() });
  const added = mentions.filter((id) => !post.mentions.includes(id));
  if (added.length)
    await notifyFeedback(ctx, principal, loaded, thread, {
      recipients: [],
      mentions: added,
      text: body || `ファイル ${post.fileIds.length} 件`,
      title: null,
    });
}

/** 投稿の削除（本人かシステム管理者）。論理削除で、一覧には「削除された投稿」として残る */
export async function deleteFeedbackPost(
  ctx: AppContext,
  principal: Principal,
  input: { postId: string },
): Promise<void> {
  const { post, thread } = await loadPost(ctx, principal, input.postId);
  if (!canModifyFeedbackPost(post, principal).delete)
    throw new DomainError("forbidden", { postId: post.id });
  const now = ctx.clock.now();
  await ctx.feedback.updatePost({ ...post, deletedAt: now });
  await ctx.feedback.updateThread({ ...thread, postCount: Math.max(0, thread.postCount - 1) });
  await ctx.audit.record({
    entityType: "feedbackPost",
    entityId: post.id,
    operation: "delete",
    actorId: principal.userId,
    after: { threadId: thread.id, byAuthor: post.authorId === principal.userId },
    at: now,
  });
}

/** リアクションを付ける・外す。付いた後の集計を返す */
export async function toggleFeedbackReaction(
  ctx: AppContext,
  principal: Principal,
  input: { postId: string; emoji: string },
): Promise<Array<{ emoji: FeedbackReaction; count: number; mine: boolean }>> {
  const emoji = validateFeedbackReaction(input.emoji);
  const { post } = await loadPost(ctx, principal, input.postId);
  if (post.deletedAt !== undefined)
    throw new DomainError("feedback_not_found", { postId: post.id });
  const next = toggleReaction(post, emoji, principal.userId);
  await ctx.feedback.updatePost(next);
  return summarizeFeedbackReactions(next.reactions, principal.userId);
}

/** スレッドの題名を変える（立てた本人かシステム管理者） */
export async function renameFeedbackThread(
  ctx: AppContext,
  principal: Principal,
  input: { threadId: string; title: string },
): Promise<void> {
  const { thread } = await loadThread(ctx, principal, input.threadId);
  if (!canRenameFeedbackThread(thread, principal))
    throw new DomainError("forbidden", { threadId: thread.id });
  const title = validateFeedbackThreadTitle(input.title);
  await ctx.feedback.updateThread({ ...thread, title });
  await ctx.audit.record({
    entityType: "feedbackThread",
    entityId: thread.id,
    operation: "rename",
    actorId: principal.userId,
    before: { title: thread.title },
    after: { title },
    at: ctx.clock.now(),
  });
}

/** 既読の印を付ける（スレッドを開いたとき） */
export async function markFeedbackRead(
  ctx: AppContext,
  principal: Principal,
  threadId: string,
): Promise<void> {
  const { thread } = await loadThread(ctx, principal, threadId);
  await ctx.feedback.markRead(principal.userId, thread.id, ctx.clock.now());
}

// ---------------------------------------------------------------- 添付

/**
 * 添付の準備（版の提出の prepare に当たる）。R2 のキーを予約し、ブラウザが Hono に PUT する。
 * 投稿に付けられるのは、本人が同じ制作物に上げて検証済みになった添付だけ。
 */
export async function prepareFeedbackFiles(
  ctx: AppContext,
  principal: Principal,
  input: { workId: string; files: Array<{ fileName: string; mimeType: string; size: number }> },
): Promise<Array<{ fileId: string }>> {
  const { work, grants } = await loadFeedbackWork(ctx, principal, input.workId);
  if (!canPostFeedback({ work, grants, principal }))
    throw new DomainError("forbidden", { workId: work.id });
  if (input.files.length === 0)
    throw new DomainError("feedback_invalid", { field: "files", reason: "required" });
  if (input.files.length > FEEDBACK_FILES_MAX)
    throw new DomainError("feedback_invalid", {
      field: "files",
      reason: "too_many",
      max: FEEDBACK_FILES_MAX,
    });
  const now = ctx.clock.now();
  const out: Array<{ fileId: string }> = [];
  for (const f of input.files) {
    const fileName = validateFeedbackFileName(f.fileName);
    if (!Number.isFinite(f.size) || f.size < 0)
      throw new DomainError("feedback_invalid", { field: "size", reason: "invalid" });
    const created = await ctx.feedback.insertFile({
      workId: work.id,
      uploaderId: principal.userId,
      fileName,
      mimeType: f.mimeType || "application/octet-stream",
      type: feedbackFileType(f.mimeType, fileName),
      declaredSize: f.size,
      objectKey: "",
      status: "pending",
      createdAt: now,
    });
    // キーの名前空間は払い出された ID で分ける（推測困難・重複しない）。実体は試行ごとにこの下へ置く
    await ctx.feedback.updateFile({
      ...created,
      keyPrefix: feedbackObjectKey(work.id, created.id, fileName),
    });
    out.push({ fileId: created.id });
  }
  return out;
}

async function loadOwnFile(ctx: AppContext, principal: Principal, fileId: string) {
  const file = await ctx.feedback.findFile(fileId);
  // 他人の添付は存在を漏らさない
  if (!file || file.uploaderId !== principal.userId)
    throw new DomainError("feedback_not_found", { fileId });
  await loadFeedbackWork(ctx, principal, file.workId);
  assertFeedbackFileUploadable(file, principal.userId);
  return file;
}

/**
 * 実体の転送の開始（Hono が PUT を受ける前に、サービス認証付きの境界から呼ぶ）。
 * 本人の、投稿に付ける前の、未検証の添付に限り、この試行だけのキーを払い出す。
 */
export async function beginFeedbackFileUpload(
  ctx: AppContext,
  principal: Principal,
  input: { fileId: string },
): Promise<{
  attemptId: string;
  objectKey: string;
  mimeType: string;
  declaredSize: number | null;
  fileName: string;
}> {
  const file = await loadOwnFile(ctx, principal, input.fileId);
  const attempt = await reserveUploadAttempt(ctx, {
    target: "feedbackFile",
    targetId: file.id,
    uploaderId: principal.userId,
    keyPrefix: file.keyPrefix!,
  });
  return {
    attemptId: attempt.id,
    objectKey: attempt.objectKey,
    mimeType: file.mimeType,
    declaredSize: file.declaredSize ?? null,
    fileName: file.fileName,
  };
}

/**
 * 実体の検証完了（Hono が R2 で sha256 を確かめた後に、サービス認証付きの境界から呼ぶ）。申告サイズと違えば failed。
 * 添付がまだ受付中・未検証で、試行が予約中・期限内のときだけ、この試行を原子的に採用する。
 */
export async function completeFeedbackFileUpload(
  ctx: AppContext,
  principal: Principal,
  input: { attemptId: string; size: number; sha256: string },
): Promise<{ status: FeedbackFileStatus; failureMessage: string | null }> {
  const now = ctx.clock.now();
  const attempt = await loadOwnUploadAttempt(ctx, principal, input.attemptId, "feedbackFile");
  const file = await loadOwnFile(ctx, principal, attempt.targetId);
  assertAttemptAdoptable(attempt, now);
  const next = verifyFeedbackFile(file, {
    size: input.size,
    sha256: input.sha256,
    objectKey: attempt.objectKey,
  });
  await ctx.attempts.update(
    next.status === "verified" ? adoptAttempt(attempt, now) : discardAttempt(attempt, now),
  );
  await ctx.feedback.updateFile(next);
  return { status: next.status, failureMessage: next.failureMessage ?? null };
}

/**
 * 転送の失敗（Hono の補償。自分の試行のキーを消した後に呼ぶ）。試行を破棄し、清掃の対象にする。
 * 添付は受付中・未検証のときだけ failed にする（採用済みの実体・投稿に付いた添付には触れない）。
 */
export async function failFeedbackFileUpload(
  ctx: AppContext,
  principal: Principal,
  input: { attemptId: string; message: string },
): Promise<void> {
  const now = ctx.clock.now();
  const attempt = await loadOwnUploadAttempt(ctx, principal, input.attemptId, "feedbackFile");
  await ctx.attempts.update(discardAttempt(attempt, now));
  const file = await ctx.feedback.findFile(attempt.targetId);
  if (!file || file.postId !== undefined || file.abandonedAt !== undefined) return;
  const next = failFeedbackFile(file, input.message);
  if (next !== file) await ctx.feedback.updateFile(next);
}

/**
 * 添付の読み取り認可（Hono の GET /feedback/files/:fileId）。署名付き URL は出さない。
 * - 投稿に付いた添付: そのフィードバックを見られる人。投稿が削除されたら誰も読めない。
 * - まだ投稿に付けていない添付: 上げた本人だけ（投稿前の確認用）。
 */
export async function authorizeFeedbackFile(
  ctx: AppContext,
  principal: Principal,
  fileId: string,
): Promise<{ objectKey: string; mimeType: string; fileName: string; size: number | null }> {
  const file = await ctx.feedback.findFile(fileId);
  if (!file) throw new DomainError("forbidden", { fileId });
  await loadFeedbackWork(ctx, principal, file.workId);
  if (file.postId === undefined) {
    if (file.uploaderId !== principal.userId) throw new DomainError("forbidden", { fileId });
  } else {
    const post = await ctx.feedback.findPost(file.postId);
    if (!post || post.deletedAt !== undefined) throw new DomainError("forbidden", { fileId });
  }
  if (file.status !== "verified" || file.purgedAt !== undefined)
    throw new DomainError("feedback_file_not_ready", { fileId, status: file.status });
  return {
    objectKey: file.objectKey,
    mimeType: file.mimeType,
    fileName: file.fileName,
    size: file.size ?? null,
  };
}

// ---------------------------------------------------------------- 清掃（D14 と同じ流れ）

/** 投稿に付けないまま 24 時間たった添付を放置扱いにする（R2 の削除は Hono の清掃が行う） */
export async function expireFeedbackFiles(ctx: AppContext, limit = 100): Promise<string[]> {
  const now = ctx.clock.now();
  const ids: string[] = [];
  for (const f of await ctx.feedback.listUnattachedFilesBefore(now - FEEDBACK_FILE_TTL_MS, limit)) {
    if (f.postId !== undefined || f.abandonedAt !== undefined) continue;
    await ctx.feedback.updateFile({ ...f, abandonedAt: now });
    ids.push(f.id);
  }
  if (ids.length)
    await ctx.audit.record({
      entityType: "feedbackFile",
      entityId: ids[0]!,
      operation: "abandoned",
      actorId: "system",
      after: { fileIds: ids },
      at: now,
    });
  return ids;
}

/** 清掃の一覧で版の提出物と区別するための頭（Hono には不透明な itemId として渡る） */
export const FEEDBACK_ORPHAN_PREFIX = "feedback:";

/** 放置扱いで R2 の実体がまだ残っている添付（itemId は "feedback:{添付 ID}"） */
export async function listOrphanFeedbackObjects(
  ctx: AppContext,
  limit = 100,
): Promise<Array<{ itemId: string; objectKey: string }>> {
  return (await ctx.feedback.listAbandonedUnpurgedFiles(limit))
    .filter((f) => f.postId === undefined && f.objectKey !== "")
    .map((f) => ({ itemId: `${FEEDBACK_ORPHAN_PREFIX}${f.id}`, objectKey: f.objectKey }));
}

/** R2 から削除済みの添付を記録する（冪等）。投稿に付いた添付は絶対に消さない */
export async function markFeedbackObjectsPurged(
  ctx: AppContext,
  fileIds: string[],
): Promise<number> {
  const now = ctx.clock.now();
  let count = 0;
  for (const id of new Set(fileIds)) {
    const f = await ctx.feedback.findFile(id);
    if (!f || f.abandonedAt === undefined || f.postId !== undefined || f.purgedAt !== undefined)
      continue;
    await ctx.feedback.updateFile({ ...f, purgedAt: now });
    count++;
  }
  return count;
}

// ---------------------------------------------------------------- A-4 集計の書き出し

/**
 * 制作物ごとの集計（システム管理者だけ）。局・担当で絞れる（局はその配下の担当も含む）。
 * 数え方は domain の computeWorkStats。並びは制作物名順。
 */
export async function exportWorkStats(
  ctx: AppContext,
  principal: Principal,
  input: { teamId?: string } = {},
): Promise<WorkStatsRow[]> {
  if (!principal.isSystemAdmin) throw new DomainError("forbidden", { action: "work_stats" });
  const teams = await ctx.teams.list();
  if (input.teamId !== undefined && !teams.some((t) => t.id === input.teamId))
    throw new DomainError("team_not_found", { teamId: input.teamId });
  const rows: WorkStatsRow[] = [];
  for (const work of await ctx.works.list(2000)) {
    if (input.teamId !== undefined && !workMatchesTeam(work, input.teamId, teams)) continue;
    const revisions = await ctx.revisions.listByWork(work.id);
    const threads = [];
    for (const r of revisions)
      for (const thread of await ctx.threads.listByRevision(r.id))
        threads.push({
          thread,
          events:
            thread.resolution === "rejected" || thread.resolution === "deferred"
              ? await ctx.threads.listEvents(thread.id)
              : [],
        });
    const fb = await ctx.feedback.listThreads({ workId: work.id, limit: 1000 });
    rows.push(
      computeWorkStats({
        work,
        teams,
        revisions,
        threads,
        approvals: await ctx.approvals.listByWork(work.id),
        feedback: {
          threadCount: fb.length,
          postCount: fb.reduce((n, t) => n + t.postCount, 0),
        },
      }),
    );
  }
  return rows.sort((a, b) => a.title.localeCompare(b.title, "ja"));
}
