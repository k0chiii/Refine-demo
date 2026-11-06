import type {
  ApprovalConfirmation,
  ApprovalEvent,
  Artifact,
  CommentEvent,
  CommentFile,
  CommentThread,
  DocumentDraft,
  FeedbackFile,
  FeedbackPost,
  FeedbackThread,
  MemberGroup,
  NotationRule,
  ProofreadingRun,
  RequiredCheck,
  ReviewAssignment,
  Revision,
  RuleCategory,
  RuleCategoryManager,
  RuleProposal,
  RuleRevision,
  SlackLink,
  SlackWorkspace,
  SocialProfile,
  Team,
  UploadAttempt,
  UploadItem,
  UploadSession,
  Work,
  WorkPermissionGrant,
} from "@mf100/domain";
import type {
  AlignmentOverride,
  AppContext,
  AuditEntry,
  Clock,
  Notification,
  NotificationDeliveryRecord,
  NotificationPrefsRecord,
  PushSubscriptionRecord,
  WorkPin,
} from "@mf100/application";
import {
  adjustUnreadCounter,
  computeWorkSummary,
  readUnreadCount,
  readWorkSummary,
  syncRevisionThreadStats,
  syncWorkRoles,
  syncWorkSummary,
  threadCountsMayChange,
} from "./derived.ts";
import { Docs, keyOf, randomId, Rows, type NewId } from "./docs.ts";
import type { Job } from "../jobs.ts";
import type { Sql } from "./sql.ts";

/**
 * ports.ts を SQLite で実装する。契約（並び・limit・削除済み・冪等性）の正は packages/application/src/testing/inMemory.ts で、
 * 同じテスト（40 本）が通ることで確かめている。
 * 並びを問わない一覧は追加順（rowid）。inMemory の Map / 配列と同じ順を返すため。
 * undefined の項目は JSON で落ちる。読み戻すと「無い」になり、inMemory の clone と同じ。
 *
 * ponytail: BEGIN しない。1 リクエスト = 1 トランザクションは呼び出し側（Durable Object の入力ゲート）が保つ前提。DO 以外で動かすなら Sql の実装側で包む。
 */
export function createSqliteContext(
  sql: Sql,
  deps: { clock: Clock; newId?: NewId; schedule?: (job: Job) => void },
): AppContext {
  const schedule = deps.schedule;
  const newId = deps.newId ?? randomId;
  const users = new Rows<{ name?: string; email?: string; nameKanji?: string }>(sql, "users");
  const works = new Docs<Work>(sql, "works", newId);
  const revisions = new Docs<Revision>(sql, "revisions", newId);
  const artifacts = new Docs<Artifact>(sql, "artifacts", newId);
  const sessions = new Docs<UploadSession>(sql, "uploadSessions", newId);
  const items = new Docs<UploadItem>(sql, "uploadItems", newId);
  const attempts = new Docs<UploadAttempt>(sql, "uploadAttempts", newId);
  const threads = new Docs<CommentThread>(sql, "threads", newId);
  const events = new Docs<CommentEvent & { id: string }>(sql, "events", newId);
  const reads = new Rows<{ userId: string; threadId: string; at: number }>(sql, "commentReads");
  const subscriptions = new Rows<{ userId: string; threadId: string; subscribedAt: number }>(
    sql,
    "threadSubscriptions",
  );
  const assignments = new Rows<ReviewAssignment>(sql, "assignments");
  const grants = new Rows<WorkPermissionGrant>(sql, "grants");
  const approvals = new Rows<ApprovalEvent>(sql, "approvals");
  const confirmations = new Docs<ApprovalConfirmation>(sql, "confirmations", newId);
  const checks = new Docs<RequiredCheck>(sql, "checks", newId);
  const notifications = new Docs<Notification>(sql, "notifications", newId);
  const pushes = new Docs<PushSubscriptionRecord>(sql, "pushSubscriptions", newId);
  const prefs = new Rows<NotificationPrefsRecord>(sql, "notificationPrefs");
  const deliveries = new Rows<NotificationDeliveryRecord>(sql, "deliveries");
  const workspaces = new Docs<SlackWorkspace>(sql, "slackWorkspaces", newId);
  const slackMembers = new Rows<Exclude<SlackLink, { state: "unresolved" }>>(sql, "slackMembers");
  const documents = new Docs<DocumentDraft>(sql, "documents", newId);
  const socialProfiles = new Docs<SocialProfile>(sql, "socialProfiles", newId);
  const teams = new Docs<Team>(sql, "teams", newId);
  const groups = new Docs<MemberGroup>(sql, "memberGroups", newId);
  const alignments = new Docs<AlignmentOverride>(sql, "alignments", newId);
  const categories = new Rows<RuleCategory>(sql, "categories");
  const rules = new Rows<NotationRule>(sql, "rules");
  const ruleRevisions = new Rows<RuleRevision>(sql, "ruleRevisions");
  const managers = new Rows<RuleCategoryManager>(sql, "managers");
  const proposals = new Docs<RuleProposal>(sql, "proposals", newId);
  const runs = new Docs<ProofreadingRun>(sql, "runs", newId);
  const pins = new Rows<WorkPin>(sql, "pins");
  const feedbackThreads = new Docs<FeedbackThread>(sql, "feedbackThreads", newId);
  const feedbackPosts = new Docs<FeedbackPost>(sql, "feedbackPosts", newId);
  const feedbackFiles = new Docs<FeedbackFile>(sql, "feedbackFiles", newId);
  const feedbackReads = new Rows<{ userId: string; threadId: string; at: number }>(
    sql,
    "feedbackReads",
  );
  const commentFiles = new Docs<CommentFile>(sql, "commentFiles", newId);
  const audit = new Rows<AuditEntry>(sql, "audit");
  const idempotency = new Rows<{ result?: unknown }>(sql, "idempotency");
  /** 未読が多くて数の行をその場で作れなかった利用者（同じトランザクションで数え直さない。derived.ts） */
  const uncountable = new Set<string>();

  return {
    clock: deps.clock,
    people: {
      displayName: async (id) => {
        const [u] = users.select("WHERE id = ?", id);
        return u?.name ?? null;
      },
      // 名簿は users の全員。表示名の無い委員も数える（inMemory の members ∪ names と同じ）。
      // Convex は nogikuSubject の無い行を除くが、ここの users はサインインでしか作られず（subject は必ず入る）、除いても結果は同じ。
      // 除くと subject 無しで人を置くテストの土台（testing/context.ts）が通らなくなるので、除かない（ponytail:）
      listMembers: async (limit) =>
        sql
          .exec("SELECT id, name, email, nameKanji FROM users ORDER BY rowid LIMIT ?", limit)
          .map((r) => ({
            id: r.id as string,
            name: (r.name as string | null) ?? "",
            email: (r.email as string | null) ?? null,
            ...(r.nameKanji === null ? {} : { nameKanji: r.nameKanji as string }),
          })),
      profiles: async (ids) => {
        const rows = sql.exec(
          "SELECT id, name, email, nameKanji FROM users WHERE id IN (SELECT value FROM json_each(?)) ORDER BY rowid",
          JSON.stringify([...new Set(ids)]),
        );
        return rows.map((r) => ({
          id: r.id as string,
          name: (r.name as string | null) ?? "",
          email: (r.email as string | null) ?? null,
          ...(r.nameKanji === null ? {} : { nameKanji: r.nameKanji as string }),
        }));
      },
    },
    works: {
      findById: async (id) => works.get(id),
      // 職責・検索・要約の派生表は、書いたのと同じトランザクションで作り直す（Convex の syncRoles と同じ）
      insert: async (w) => {
        const row = works.insert(w);
        syncWorkRoles(sql, row);
        return row;
      },
      update: async (w) => {
        works.put(w);
        syncWorkRoles(sql, w);
      },
      list: async (limit) => works.select("ORDER BY rowid LIMIT ?", limit),
    },
    revisions: {
      findById: async (id) => revisions.get(id),
      listByWork: async (workId) => revisions.select("WHERE workId = ? ORDER BY rowid", workId),
      insert: async (r) => {
        const row = revisions.insert(r);
        syncWorkSummary(sql, row.workId);
        return row;
      },
      update: async (r) => {
        revisions.put(r);
        syncWorkSummary(sql, r.workId);
      },
      listOpenExpired: async (now, limit) =>
        revisions.select(
          "WHERE reviewState = 'open' AND deadlineAt <= ? ORDER BY rowid LIMIT ?",
          now,
          limit,
        ),
      listOpenDueWithin: async ({ after, upTo }, { cursor, limit }) => {
        // cursor は読み終えた件数（inMemory と同じ）。1 件多く読んで次があるかを見る
        // ponytail: OFFSET は後ろのページほど読み飛ばしが増える。受付中で期限が窓に入る版だけなので数千件までは足りる。超えたら (deadlineAt, id) の keyset にする。
        const start = cursor === null ? 0 : Number(cursor);
        const rows = revisions.select(
          "WHERE reviewState = 'open' AND deadlineAt > ? AND deadlineAt <= ? ORDER BY deadlineAt, rowid LIMIT ? OFFSET ?",
          after,
          upTo,
          limit + 1,
          start,
        );
        return {
          page: rows.slice(0, limit),
          continueCursor: rows.length > limit ? String(start + limit) : null,
        };
      },
    },
    artifacts: {
      findById: async (id) => artifacts.get(id),
      listByRevision: async (revisionId) =>
        artifacts.select("WHERE revisionId = ? ORDER BY rowid", revisionId),
      insert: async (a) => artifacts.insert(a),
    },
    uploads: {
      findById: async (id) => sessions.get(id),
      insert: async (s) => sessions.insert(s),
      update: async (s) => sessions.put(s),
      listItems: async (sessionId) => items.select("WHERE sessionId = ? ORDER BY rowid", sessionId),
      findItem: async (id) => items.get(id),
      insertItem: async (i) => items.insert(i),
      updateItem: async (i) => items.put(i),
      listOpenExpired: async (now, limit) =>
        sessions.select(
          "WHERE state = 'open' AND expiresAt <= ? ORDER BY rowid LIMIT ?",
          now,
          limit,
        ),
      listAbandonedUnpurged: async (limit) =>
        sessions.select(
          "WHERE state = 'abandoned' AND purgedAt IS NULL ORDER BY rowid LIMIT ?",
          limit,
        ),
    },
    attempts: {
      findById: async (id) => attempts.get(id),
      insert: async (a) => attempts.insert(a),
      update: async (a) => attempts.put(a),
      listByTarget: async (target, targetId) =>
        attempts.select("WHERE target = ? AND targetId = ? ORDER BY rowid", target, targetId),
      listOrphanCandidates: async (reservedBefore, limit) =>
        attempts.select(
          "WHERE purgedAt IS NULL AND (state = 'discarded' OR (state = 'reserved' AND createdAt <= ?)) ORDER BY rowid LIMIT ?",
          reservedBefore,
          limit,
        ),
    },
    threads: {
      findById: async (id) => threads.get(id),
      findByMigratedFrom: async (feedbackThreadId) =>
        threads.select(
          "WHERE migratedFromFeedbackThreadId = ? ORDER BY rowid LIMIT 1",
          feedbackThreadId,
        )[0] ?? null,
      listByRevision: async (revisionId) =>
        threads.select("WHERE revisionId = ? AND deletedAt IS NULL ORDER BY rowid", revisionId),
      // 版の件数と要約は、スレッドを書いたあとに数え直す（Convex の syncRevisionThreadStats と同じ）
      insert: async (t) => {
        const row = threads.insert(t);
        syncRevisionThreadStats(sql, t.revisionId);
        return row;
      },
      insertMany: async (ts) => {
        const rows = ts.map((t) => threads.insert(t));
        // 数え直しは版ごとに 1 回（足したあとの全件から数えるので、1 件ずつ数えたときと同じ値）
        for (const revisionId of new Set(ts.map((t) => t.revisionId)))
          syncRevisionThreadStats(sql, revisionId);
        return rows;
      },
      update: async (t) => {
        const before = threads.get(t.id);
        threads.put(t);
        // リアクション・返信・担当などは件数を変えない。版と要約の数え直し（スレッド全件を読む）を省く
        if (before && !threadCountsMayChange(before, t)) return;
        if (before && before.revisionId !== t.revisionId)
          syncRevisionThreadStats(sql, before.revisionId);
        syncRevisionThreadStats(sql, t.revisionId);
      },
      appendEvent: async (e) => events.insert(e).id,
      listEvents: async (threadId) => events.select("WHERE threadId = ? ORDER BY rowid", threadId),
      listLatestEvents: async (threadId, limit) =>
        limit > 0
          ? events
              .select("WHERE threadId = ? ORDER BY rowid DESC LIMIT ?", threadId, limit)
              .reverse()
          : [],
      setEventReactions: async (eventId, reactions) => {
        const e = events.get(eventId);
        if (!e) return;
        if (reactions.length > 0) e.reactions = reactions;
        else delete e.reactions;
        events.put(e);
      },
      setReplyBody: async (eventId, { body, bodyFormat }) => {
        const e = events.get(eventId);
        if (!e) return;
        const { bodyFormat: _previous, ...rest } = e.payload ?? {};
        void _previous;
        e.payload = { ...rest, body, ...(bodyFormat ? { bodyFormat } : {}) };
        events.put(e);
      },
      readAt: async (userId, threadId) =>
        reads.select("WHERE id = ?", keyOf(userId, threadId))[0]?.at ?? null,
      markRead: async (userId, threadId, at) => {
        const id = keyOf(userId, threadId);
        const before = reads.select("WHERE id = ?", id)[0]?.at ?? 0;
        reads.upsert(id, { userId, threadId, at: Math.max(at, before) });
      },
      readsOf: async (userId, threadIds) =>
        new Map(
          reads
            .select(
              "WHERE userId = ? AND threadId IN (SELECT value FROM json_each(?)) ORDER BY rowid",
              userId,
              JSON.stringify(threadIds),
            )
            .map((r) => [r.threadId, r.at]),
        ),
      listSubscribers: async (threadId) =>
        subscriptions.select("WHERE threadId = ? ORDER BY rowid", threadId).map((s) => s.userId),
      isSubscribed: async (userId, threadId) =>
        subscriptions.count("id = ?", keyOf(userId, threadId)) > 0,
      setSubscribed: async (userId, threadId, on, at) => {
        const id = keyOf(userId, threadId);
        if (!on) subscriptions.delete(id);
        else if (subscriptions.count("id = ?", id) === 0)
          subscriptions.upsert(id, { userId, threadId, subscribedAt: at });
      },
    },
    assignments: {
      listByRevision: async (revisionId) =>
        assignments.select("WHERE revisionId = ? ORDER BY rowid", revisionId),
      find: async (revisionId, reviewerId) =>
        assignments.select("WHERE id = ?", keyOf(revisionId, reviewerId))[0] ?? null,
      upsert: async (a) => assignments.upsert(keyOf(a.revisionId, a.reviewerId), a),
      delete: async (revisionId, reviewerId) => assignments.delete(keyOf(revisionId, reviewerId)),
    },
    acl: {
      listByWork: async (workId) => grants.select("WHERE workId = ? ORDER BY rowid", workId),
      listForPrincipal: async (p) =>
        grants.select(
          `WHERE (principalType = 'user' AND principalId = ?)
             OR (principalType = 'group' AND principalId IN (SELECT value FROM json_each(?)))
           ORDER BY rowid`,
          p.userId,
          JSON.stringify(p.groupIds),
        ),
      insert: async (g) => grants.append(g),
      update: async (g) => {
        // ID を持たないため (主体, 付与時刻, レベル) で同定し、複数一致時は有効なものを優先する
        const [hit] = sql.exec(
          `SELECT rowid AS rid FROM grants
           WHERE workId = ? AND principalType = ? AND principalId = ?
             AND json_extract(doc, '$.grantedAt') = ? AND json_extract(doc, '$.permission') = ?
           ORDER BY json_extract(doc, '$.revokedAt') IS NULL DESC, rowid LIMIT 1`,
          g.workId,
          g.principalType,
          g.principalId,
          g.grantedAt,
          g.permission,
        );
        if (!hit) throw new Error("grant not found");
        sql.exec("UPDATE grants SET doc = ? WHERE rowid = ?", JSON.stringify(g), hit.rid as number);
      },
    },
    approvals: {
      append: async (e) => {
        approvals.append(e);
        syncWorkSummary(sql, e.workId);
      },
      listByWork: async (workId) => approvals.select("WHERE workId = ? ORDER BY rowid", workId),
      insertConfirmation: async (c) => confirmations.insert(c),
      listConfirmationsByRevision: async (revisionId) =>
        confirmations.select("WHERE revisionId = ? ORDER BY confirmedAt, rowid", revisionId),
    },
    audit: { record: async (e) => audit.append(e) },
    checks: {
      findById: async (id) => checks.get(id),
      listByRevision: async (revisionId) =>
        checks.select("WHERE revisionId = ? ORDER BY rowid", revisionId),
      insert: async (c) => checks.insert(c),
      update: async (c) => checks.put(c),
    },
    pushSubscriptions: {
      findById: async (id) => pushes.get(id),
      findByEndpoint: async (endpoint) =>
        pushes.select("WHERE endpoint = ? ORDER BY rowid LIMIT 1", endpoint)[0] ?? null,
      listByUser: async (userId) => pushes.select("WHERE userId = ? ORDER BY rowid", userId),
      insert: async (sub) => pushes.insert(sub),
      update: async (sub) => pushes.put(sub),
      delete: async (id) => pushes.delete(id),
    },
    notificationPrefs: {
      find: async (userId) => prefs.select("WHERE id = ?", userId)[0] ?? null,
      save: async (p) => {
        const prev = prefs.select("WHERE id = ?", p.userId)[0];
        prefs.upsert(p.userId, p);
        // Slack をオンにした・オンのままワークスペースか Slack のメールアドレスを替えたら、最初の通知を待たずにメンバーを引く
        // （設定画面に状態を出すため。Convex の adapters と同じ条件）
        const sameTarget =
          prev?.channels.includes("slack") &&
          prev.slackWorkspaceId === p.slackWorkspaceId &&
          prev.slackEmail === p.slackEmail;
        if (p.channels.includes("slack") && p.slackWorkspaceId !== undefined && !sameTarget)
          schedule?.({ kind: "resolveSlack", userId: p.userId });
      },
    },
    deliveries: {
      listSettled: async (notificationId) =>
        deliveries
          .select("WHERE notificationId = ? ORDER BY rowid", notificationId)
          .map((d) => d.destination),
      settle: async (row) =>
        void sql.exec(
          "INSERT OR IGNORE INTO deliveries (id, doc) VALUES (?, ?)",
          keyOf(row.notificationId, row.destination),
          JSON.stringify(row),
        ),
    },
    slackWorkspaces: {
      list: async () => workspaces.select("ORDER BY name, rowid LIMIT 100"),
      findById: async (id) => workspaces.get(id),
      findByTeamId: async (teamId) =>
        workspaces.select("WHERE teamId = ? ORDER BY rowid LIMIT 1", teamId)[0] ?? null,
      insert: async (w) => workspaces.insert(w),
      delete: async (id) => workspaces.delete(id),
    },
    slackMembers: {
      find: async (teamId, email) =>
        slackMembers.select("WHERE id = ?", keyOf(teamId, email))[0] ?? { state: "unresolved" },
      save: async (teamId, email, link) => slackMembers.upsert(keyOf(teamId, email), link),
    },
    notifications: {
      insert: async (n) => {
        const row = notifications.insert(n);
        if (n.readAt === undefined) adjustUnreadCounter(sql, n.recipientId, 1, uncountable);
        // 外へ送るのはあとの仕事（送る内容は送る時点で計画が作り直す）。同じトランザクションで積むので、巻き戻れば消える
        schedule?.({ kind: "deliver", notificationId: row.id });
        return row;
      },
      // 同じ時刻の通知は新しく入れた方が先（Convex は索引の末尾が _creationTime なので、降順なら後から入れた方が先に来る）
      listForUser: async (userId, limit) =>
        notifications.select(
          "WHERE recipientId = ? ORDER BY createdAt DESC, rowid DESC LIMIT ?",
          userId,
          limit,
        ),
      listUnreadForUser: async (userId, { createdAtOrBefore, limit, order = "asc" }) =>
        notifications.select(
          `WHERE recipientId = ? AND readAt IS NULL AND (? IS NULL OR createdAt <= ?)
           ORDER BY createdAt ${order === "asc" ? "ASC" : "DESC"}, rowid ${order === "asc" ? "ASC" : "DESC"} LIMIT ?`,
          userId,
          createdAtOrBefore ?? null,
          createdAtOrBefore ?? null,
          limit,
        ),
      findById: async (id) => notifications.get(id),
      update: async (n) => {
        const prev = notifications.get(n.id);
        notifications.put(n);
        // 未読の数を同じトランザクションで合わせる（既読にする・未読に戻す。未読のまま・既読のままなら触らない）
        const wasUnreadOf = prev && prev.readAt === undefined ? prev.recipientId : null;
        const isUnreadOf = n.readAt === undefined ? n.recipientId : null;
        if (wasUnreadOf !== isUnreadOf) {
          if (wasUnreadOf !== null) adjustUnreadCounter(sql, wasUnreadOf, -1, uncountable);
          if (isUnreadOf !== null) adjustUnreadCounter(sql, isUnreadOf, 1, uncountable);
        }
      },
      countUnread: async (userId) => readUnreadCount(sql, userId),
    },
    documents: {
      findByWork: async (workId) =>
        documents.select("WHERE workId = ? ORDER BY rowid LIMIT 1", workId)[0] ?? null,
      insert: async (d) => documents.insert(d),
      update: async (d) => documents.put(d),
    },
    socialProfiles: {
      list: async () => socialProfiles.all(),
      findById: async (id) => socialProfiles.get(id),
      insert: async (p) => socialProfiles.insert(p),
      update: async (p) => socialProfiles.put(p),
      remove: async (id) => socialProfiles.delete(id),
      countWorksUsing: async (id) => works.count("socialProfileId = ?", id),
    },
    teams: {
      list: async () => teams.all(),
      findById: async (id) => teams.get(id),
      insert: async (t) => teams.insert(t),
      update: async (t) => teams.put(t),
      remove: async (id) => teams.delete(id),
      countWorksUsing: async (id) =>
        works.count(
          "ownerTeamId = ? OR EXISTS (SELECT 1 FROM json_each(works.doc, '$.productionTeamIds') WHERE value = ?)",
          id,
          id,
        ),
    },
    groups: {
      list: async () => groups.all(),
      findById: async (id) => groups.get(id),
      insert: async (g) => groups.insert(g),
      update: async (g) => groups.put(g),
      remove: async (id) => groups.delete(id),
    },
    workSummaries: {
      async findByWork(workId) {
        const work = works.get(workId);
        if (!work) return null;
        // 書込み側が作り直した表を読む。行が無い・古い版の行だけ、元から数え直す（Convex の読みと同じ）
        return readWorkSummary(sql, workId) ?? computeWorkSummary(sql, work);
      },
    },
    home: {
      listPins: async (userId) =>
        pins.select("WHERE userId = ? ORDER BY pinnedAt DESC, rowid", userId),
      addPin: async (pin) => pins.upsert(keyOf(pin.userId, pin.workId), pin),
      removePin: async (userId, workId) => pins.delete(keyOf(userId, workId)),
      listPinners: async (workId) =>
        pins.select("WHERE workId = ? ORDER BY rowid", workId).map((p) => p.userId),
    },
    alignments: {
      find: async (l, r) =>
        alignments.select(
          "WHERE leftArtifactId = ? AND rightArtifactId = ? ORDER BY rowid LIMIT 1",
          l,
          r,
        )[0] ?? null,
      insert: async (x) => alignments.insert(x),
      update: async (x) => alignments.put(x),
    },
    notation: {
      listCategories: async () => categories.all(),
      upsertCategory: async (c) => categories.upsert(c.code, c),
      listRules: async () => rules.all(),
      listRulesInCategories: async (codes) =>
        rules.select(
          "WHERE categoryCode IN (SELECT value FROM json_each(?)) ORDER BY rowid",
          JSON.stringify(codes),
        ),
      findRule: async (id) => rules.select("WHERE id = ?", id)[0] ?? null,
      insertRule: async (r) => {
        rules.upsert(r.ruleId, r);
        schedule?.({ kind: "indexRule", ruleId: r.ruleId });
      },
      updateRule: async (r) => {
        rules.upsert(r.ruleId, r);
        schedule?.({ kind: "indexRule", ruleId: r.ruleId });
      },
      appendRevision: async (r) => ruleRevisions.append(r),
      listRevisions: async (ruleId) =>
        ruleRevisions.select("WHERE ruleId = ? ORDER BY rowid", ruleId),
      listManagers: async () => managers.all(),
      addManager: async (m) => managers.upsert(keyOf(m.userId, m.categoryCode), m),
      removeManager: async (userId, categoryCode) => managers.delete(keyOf(userId, categoryCode)),
      findProposal: async (id) => proposals.get(id),
      findOpenProposalByKey: async (k) =>
        proposals.select("WHERE status = 'open' AND dedupeKey = ? ORDER BY rowid LIMIT 1", k)[0] ??
        null,
      listProposals: async (status, limit) =>
        proposals.select(
          "WHERE (? IS NULL OR status = ?) ORDER BY proposedAt DESC, rowid LIMIT ?",
          status,
          status,
          limit,
        ),
      insertProposal: async (p) => proposals.insert(p),
      updateProposal: async (p) => proposals.put(p),
    },
    proofreadingRuns: {
      findById: async (id) => runs.get(id),
      findByRevision: async (revisionId) =>
        runs.select("WHERE revisionId = ? ORDER BY rowid LIMIT 1", revisionId)[0] ?? null,
      insert: async (r) => runs.insert(r),
      update: async (r) => runs.put(r),
    },
    feedback: {
      // ponytail: OFFSET で数える。移行（一度きり）の読み取りにしか使わないので、keyset にはしない。
      pageThreads: async (cursor, limit) => {
        const from = cursor ?? 0;
        const rows = feedbackThreads.select("ORDER BY rowid LIMIT ? OFFSET ?", limit + 1, from);
        return {
          threads: rows.slice(0, limit),
          nextCursor: rows.length > limit ? from + limit : null,
        };
      },
      listPosts: async (threadId) =>
        feedbackPosts.select("WHERE threadId = ? ORDER BY createdAt, rowid", threadId),
      findFile: async (id) => feedbackFiles.get(id),
      listReads: async (threadId) =>
        feedbackReads
          .select("WHERE threadId = ? ORDER BY rowid", threadId)
          .map((r) => ({ userId: r.userId, readAt: r.at })),
    },
    commentFiles: {
      findFile: async (id) => commentFiles.get(id),
      insertFile: async (f) => commentFiles.insert(f),
      updateFile: async (f) => commentFiles.put(f),
      listByThread: async (threadId) =>
        commentFiles.select("WHERE threadId = ? ORDER BY rowid", threadId),
      listUnattachedFilesBefore: async (before, limit) =>
        commentFiles.select(
          "WHERE threadId IS NULL AND abandonedAt IS NULL AND createdAt <= ? ORDER BY rowid LIMIT ?",
          before,
          limit,
        ),
      listReleasedUnpurgedFiles: async (limit) =>
        commentFiles.select(
          "WHERE (abandonedAt IS NOT NULL OR removedAt IS NOT NULL) AND purgedAt IS NULL ORDER BY rowid LIMIT ?",
          limit,
        ),
    },
    idempotency: {
      get: async (scope, key) => {
        const [row] = idempotency.select("WHERE id = ?", keyOf(scope, key));
        return row ? { result: row.result } : null;
      },
      put: async (scope, key, result) => idempotency.upsert(keyOf(scope, key), { result }),
    },
  };
}
