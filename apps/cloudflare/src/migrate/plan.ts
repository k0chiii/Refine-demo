import { personDisplayName } from "@mf100/domain";

/**
 * Convex の export（表ごとの JSONL）を、Cloudflare の SQLite（sqlite/schema.ts）の行へ写す対応表。
 * 表は値で持つ（MAPPINGS）。ここを読めば「何を移し、何を捨て、何を作り直すか」が分かるようにしてある。
 *
 * 約束（Convex の lib/adapters.ts と同じ）:
 * - `_id` は業務の ID としてそのまま使う。参照（`v.id` ・文字列の ID）も書き換えない。だから取り込み後も URL・通知の中の ID は生きる
 * - `_creationTime` はドメインに持ち込まない。使うのは「追加順（rowid）を元と同じにする」ための並べ替えと、Cloudflare にしか無い項目の既定値だけ
 *
 * Node から直に読めるよう（scripts/migrate/*.mjs）、このファイルは @mf100/domain 以外の workspace の .ts を import しない
 * （sqlite/docs.ts は parameter property を使うので Node の型除去では読めない）。
 */

export type Doc = Record<string, unknown>;
export interface ConvexDoc extends Doc {
  _id: string;
  _creationTime: number;
}

/**
 * 取り込む 1 行。table は Cloudflare の表の名前。
 * - id: 文書表の主キー。doc に `id` を持つ表（STORAGE が "docs"）では省く
 * - doc: 行の中身（SQLite の doc 列。raw の表は列の名前→値）
 */
export interface MigrateRow {
  table: string;
  id?: string;
  doc: Doc;
}

/**
 * 表ごとの置き方。
 * - docs: `id TEXT PRIMARY KEY` ＋ doc（doc に id を残す。Docs<T> の表）
 * - keyed: 同じだが doc に id を持たない。主キーは row.id（自然キー `a|b`、または users の払い出し ID）
 * - keyless: 追記だけ。主キーが無い
 * - raw: 生の列（共同編集の表）。key は主キーの列。列の名前は columns に限る
 */
export type Storage =
  | { kind: "docs" }
  | { kind: "keyed" }
  | { kind: "keyless" }
  | { kind: "raw"; key: readonly string[]; columns: readonly string[] };

export const STORAGE: Readonly<Record<string, Storage>> = {
  users: { kind: "keyed" },
  works: { kind: "docs" },
  revisions: { kind: "docs" },
  artifacts: { kind: "docs" },
  uploadSessions: { kind: "docs" },
  uploadItems: { kind: "docs" },
  uploadAttempts: { kind: "docs" },
  threads: { kind: "docs" },
  events: { kind: "docs" },
  commentReads: { kind: "keyed" },
  threadSubscriptions: { kind: "keyed" },
  assignments: { kind: "keyed" },
  grants: { kind: "keyless" },
  approvals: { kind: "keyless" },
  confirmations: { kind: "docs" },
  checks: { kind: "docs" },
  notifications: { kind: "docs" },
  pushSubscriptions: { kind: "docs" },
  notificationPrefs: { kind: "keyed" },
  deliveries: { kind: "keyed" },
  slackWorkspaces: { kind: "docs" },
  slackMembers: { kind: "keyed" },
  documents: { kind: "docs" },
  socialProfiles: { kind: "docs" },
  teams: { kind: "docs" },
  memberGroups: { kind: "docs" },
  alignments: { kind: "docs" },
  categories: { kind: "keyed" },
  rules: { kind: "keyed" },
  ruleRevisions: { kind: "keyless" },
  managers: { kind: "keyed" },
  proposals: { kind: "docs" },
  runs: { kind: "docs" },
  pins: { kind: "keyed" },
  feedbackThreads: { kind: "docs" },
  feedbackPosts: { kind: "docs" },
  feedbackFiles: { kind: "docs" },
  feedbackReads: { kind: "keyed" },
  commentFiles: { kind: "docs" },
  audit: { kind: "keyless" },
  idempotency: { kind: "keyed" },
  processingJobs: { kind: "docs" },
  ruleEmbeddings: { kind: "keyed" },
  collabSnapshots: {
    kind: "raw",
    key: ["docId", "version"],
    columns: ["docId", "version", "content"],
  },
  collabSteps: {
    kind: "raw",
    key: ["docId", "version"],
    columns: ["docId", "version", "step", "clientId"],
  },
  collaborativeDrafts: {
    kind: "raw",
    key: ["workId"],
    columns: ["workId", "snapshotVersion", "enabledAt", "enabledBy"],
  },
};

/** 自然キー。sqlite/docs.ts の keyOf と同じ（そちらは Node で直に読めないので写した。migrate.test.ts が読み出しで確かめる） */
export const keyOf = (...parts: string[]): string => parts.join("|");

// ---------------------------------------------------------------- 変換の道具

type Skip = string;
/** 1 行の変換の結果。文字列は「移さない」理由 */
type Converted = readonly MigrateRow[] | Skip;

/** 変換が見る、表をまたぐ手がかり */
interface Ctx {
  /** auth の accounts 表の providerAccountId（Nogiku の sub）。users.nogikuSubject が無い行の代わり */
  accountSubject: Map<string, string>;
  seenSubjects: Set<string>;
}

interface Mapping {
  /** export の中の場所（表の名前。component の表は `_components/<名前>/<表>`） */
  from: string;
  /** Cloudflare の表。STORAGE の鍵 */
  to: string;
  convert(doc: ConvexDoc, ctx: Ctx): Converted;
}

const str = (v: unknown): string | undefined => (typeof v === "string" && v !== "" ? v : undefined);
const num = (v: unknown): number | undefined => (typeof v === "number" ? v : undefined);

/** `_id` と `_creationTime` を除き、さらに drop の項目を除いた残り（Convex の adapters の strip） */
function rest(d: ConvexDoc, drop: readonly string[] = []): Doc {
  const { _id, _creationTime, ...fields } = d;
  void _id;
  void _creationTime;
  for (const k of drop) delete fields[k];
  return fields;
}

/** doc に id を持つ表。Convex の adapters の fromDoc（`_id` → `id`） */
const docs = (from: string, to: string, drop: readonly string[] = []): Mapping => ({
  from,
  to,
  convert: (d) => [{ table: to, doc: { id: d._id, ...rest(d, drop) } }],
});

/** doc に id を持たない表。key が決まらない行は移さない */
function keyed(
  from: string,
  to: string,
  key: (d: ConvexDoc) => string | undefined,
  shape: (d: ConvexDoc) => Doc = (d) => rest(d),
): Mapping {
  return {
    from,
    to,
    convert: (d) => {
      const id = key(d);
      return id === undefined ? "no-key" : [{ table: to, id, doc: shape(d) }];
    },
  };
}

/** 追記だけの表 */
const keyless = (from: string, to: string): Mapping => ({
  from,
  to,
  convert: (d) => [{ table: to, doc: rest(d) }],
});

const pair = (a: unknown, b: unknown): string | undefined => {
  const x = str(a);
  const y = str(b);
  return x && y ? keyOf(x, y) : undefined;
};

// ---------------------------------------------------------------- 対応表

/**
 * 移す表。順番はそのまま取り込みの順（users が先）。
 *
 * ponytail: 取り込み中の進行中の仕事（processingJobs の queued / running、open の uploadSession）は元の Convex の
 * workpool・workflow に結び付いていて、移しても続きは動かない。切り替えは静かな時間に行い、verify の inflight で数を確かめる。
 */
export const MAPPINGS: readonly Mapping[] = [
  {
    // IdP が正本。id は払い出し済みの _id を残し、subject（Nogiku の sub）で本人を引く（sqlite/users.ts・auth/store.ts）
    from: "users",
    to: "users",
    convert: (d, ctx) => {
      const subject = str(d.nogikuSubject) ?? ctx.accountSubject.get(d._id);
      // 一度もサインインしていない行は名簿（委員）に入れない: Convex の listMembers / profiles も nogikuSubject の無い行を除く
      if (!subject) return "no-subject";
      if (ctx.seenSubjects.has(subject)) return "duplicate-subject";
      ctx.seenSubjects.add(subject);
      const name = str(d.name);
      const hurigana = str(d.hurigana);
      // auth/store.ts の upsertUserFromProfile と同じ形: name は表示名（ふりがな優先）、漢字は nameKanji に残す
      const display = personDisplayName({ name, hurigana });
      const doc: Doc = {
        subject,
        ...(str(d.source) ? { source: d.source } : {}),
        ...(num(d.lastLoginAt) !== undefined ? { lastLoginAt: d.lastLoginAt } : {}),
        isSystemAdmin: d.isSystemAdmin === true,
        ...(name ? { nameKanji: name } : {}),
        ...(display !== "" ? { name: display } : {}),
        ...(str(d.email) ? { email: d.email } : {}),
        // Convex の image は Nogiku の picture
        ...(str(d.image) ? { picture: d.image } : {}),
        ...(hurigana ? { hurigana } : {}),
        ...(num(d.generation) !== undefined ? { generation: d.generation } : {}),
        ...(Array.isArray(d.orgPermissions) ? { orgPermissions: d.orgPermissions } : {}),
        ...(d.avatar !== undefined ? { avatar: d.avatar } : {}),
      };
      // emailVerificationTime は捨てる（Convex Auth の内部。Cloudflare は見ない）
      return [{ table: "users", id: d._id, doc }];
    },
  },
  // Convex にしか無い印（派生表の作り直しの目印）と、廃止の項目（利用者指示 2026-10-17）は持ち込まない
  docs("works", "works", [
    "rolesVersion",
    "searchVersion",
    "aggregateVersion",
    "driveFolderUrl",
    "slackChannelId",
  ]),
  docs("revisions", "revisions"),
  docs("artifacts", "artifacts"),
  docs("uploadSessions", "uploadSessions"),
  docs("uploadItems", "uploadItems"),
  docs("uploadAttempts", "uploadAttempts"),
  docs("commentThreads", "threads"),
  docs("commentEvents", "events"),
  // Convex の readAt は Cloudflare では at（sqlite/context.ts の markRead）
  keyed(
    "commentReads",
    "commentReads",
    (d) => pair(d.userId, d.threadId),
    (d) => ({ userId: d.userId, threadId: d.threadId, at: d.readAt }),
  ),
  keyed(
    "threadSubscriptions",
    "threadSubscriptions",
    (d) => pair(d.userId, d.threadId),
    (d) => ({ userId: d.userId, threadId: d.threadId, subscribedAt: d.subscribedAt }),
  ),
  keyed("reviewAssignments", "assignments", (d) => pair(d.revisionId, d.reviewerId)),
  keyless("workPermissions", "grants"),
  keyless("approvalEvents", "approvals"),
  docs("approvalConfirmations", "confirmations"),
  docs("requiredChecks", "checks"),
  docs("notifications", "notifications"),
  docs("pushSubscriptions", "pushSubscriptions"),
  keyed("notificationPrefs", "notificationPrefs", (d) => str(d.userId)),
  keyed("notificationDeliveries", "deliveries", (d) => pair(d.notificationId, d.destination)),
  docs("slackWorkspaces", "slackWorkspaces"),
  // 行の中身は SlackLink だけ（teamId・email は主キーに移る。sqlite/context.ts の slackMembers.save）
  keyed(
    "slackMembers",
    "slackMembers",
    (d) => pair(d.teamId, d.email),
    (d) => rest(d, ["teamId", "email"]),
  ),
  docs("documentDrafts", "documents"),
  docs("socialProfiles", "socialProfiles"),
  docs("teams", "teams"),
  docs("memberGroups", "memberGroups"),
  docs("alignmentOverrides", "alignments"),
  keyed("ruleCategories", "categories", (d) => str(d.code)),
  keyed("notationRules", "rules", (d) => str(d.ruleId)),
  keyless("ruleRevisions", "ruleRevisions"),
  keyed("ruleCategoryManagers", "managers", (d) => pair(d.userId, d.categoryCode)),
  docs("ruleProposals", "proposals"),
  docs("proofreadingRuns", "runs"),
  keyed("workPins", "pins", (d) => pair(d.userId, d.workId)),
  docs("feedbackThreads", "feedbackThreads"),
  docs("feedbackPosts", "feedbackPosts"),
  docs("feedbackFiles", "feedbackFiles"),
  keyed(
    "feedbackReads",
    "feedbackReads",
    (d) => pair(d.userId, d.threadId),
    (d) => ({ userId: d.userId, threadId: d.threadId, at: d.readAt }),
  ),
  docs("commentFiles", "commentFiles"),
  keyless("auditEvents", "audit"),
  // Cloudflare の行は { result } だけ（sqlite/context.ts の idempotency.put）
  keyed(
    "idempotencyKeys",
    "idempotency",
    (d) => pair(d.scope, d.key),
    (d) => ({ result: d.result }),
  ),
  docs("processingJobs", "processingJobs"),
  // 埋め込みは作り直すと外部 API の課金が要るので移す。updatedAt は Cloudflare にだけある項目（functions/semanticRules.ts）
  keyed(
    "ruleEmbeddings",
    "ruleEmbeddings",
    (d) => str(d.ruleId),
    (d) => ({
      id: d.ruleId,
      ruleId: d.ruleId,
      revision: d.revision,
      vector: d.vector,
      model: d.model,
      updatedAt: Math.floor(d._creationTime),
    }),
  ),
  // ---- 文章の共同編集（@convex-dev/prosemirror-sync の component。collab/store.ts が同じ意味で持つ）
  {
    from: "_components/prosemirrorSync/snapshots",
    to: "collabSnapshots",
    convert: (d) =>
      typeof d.id === "string" && typeof d.version === "number" && typeof d.content === "string"
        ? [
            {
              table: "collabSnapshots",
              id: keyOf(d.id, String(d.version)),
              doc: { docId: d.id, version: d.version, content: d.content },
            },
          ]
        : "malformed",
  },
  {
    // Convex の 1 行は「ステップの塊」（version = 塊の最後の版）。Cloudflare は 1 ステップ 1 行（version = そのステップの後の版）
    from: "_components/prosemirrorSync/deltas",
    to: "collabSteps",
    convert: (d) => {
      const { id, version, clientId, steps } = d;
      if (
        typeof id !== "string" ||
        typeof version !== "number" ||
        !Array.isArray(steps) ||
        !(typeof clientId === "string" || typeof clientId === "number")
      )
        return "malformed";
      const first = version - steps.length;
      return steps.map((step, i) => ({
        table: "collabSteps",
        id: keyOf(id, String(first + i + 1)),
        doc: { docId: id, version: first + i + 1, step, clientId },
      }));
    },
  },
  {
    // 切り替えた時刻と人は Convex に無い。時刻は行の作成時刻、人は移行と分かる印
    from: "collaborativeDrafts",
    to: "collaborativeDrafts",
    convert: (d) =>
      typeof d.workId === "string" && typeof d.snapshotVersion === "number"
        ? [
            {
              table: "collaborativeDrafts",
              id: d.workId,
              doc: {
                workId: d.workId,
                snapshotVersion: d.snapshotVersion,
                enabledAt: Math.floor(d._creationTime),
                enabledBy: "convex-migration",
              },
            },
          ]
        : "malformed",
  },
];

/**
 * 移さない表と、その理由。MAPPINGS にも REBUILT にも無く、ここにも無い場所は「未知」として止める
 * （Convex に表が増えたのに対応表が古いまま、本番の取り込みへ進まないため）。
 */
export const DROPPED: readonly { path: string; why: string }[] = [
  // 認証: サインインのやり直し（OIDC）で作り直る。refresh token を持ち越すと Convex の鍵で署名したものが残る
  { path: "authAccounts", why: "subject の代わりに読むだけ（users の変換）。行は移さない" },
  { path: "authSessions", why: "セッション。再サインインさせる" },
  { path: "authRefreshTokens", why: "refresh token。再サインインさせる" },
  { path: "authVerificationCodes", why: "一時コード" },
  { path: "authVerifiers", why: "PKCE の途中状態" },
  { path: "authRateLimits", why: "サインインの試行回数" },
  // 一時・使い捨て
  { path: "aiJobs", why: "AI 校正の一時保存。本文を持たず 1 時間で消える" },
  { path: "pushDeliveries", why: "Web Push の二重送り防止。切り替えの時点で届いた通知は戻さない" },
  {
    path: "workAggregateEntries",
    why: "集計 component の入力。Cloudflare は works を GROUP BY で数える（sqlite/derived.ts）",
  },
  // component の内部
  { path: "_components/presence", why: "在席。心拍で作り直る" },
  { path: "_components/rateLimiter", why: "rate limit の窓。短命" },
  { path: "_components/pushPool", why: "workpool の待ち行列。Cloudflare は jobs（alarm）" },
  { path: "_components/workflow", why: "workflow の途中状態。Cloudflare は jobs（alarm）" },
  { path: "_components/aggregate", why: "集計の木。作り直す側が無い" },
  { path: "_components/migrations", why: "Convex の移行の記録" },
  // Cloudflare 側に表が無い（本線で足すかどうかを決める。足すまでは失う）
  { path: "dashboardLayouts", why: "Cloudflare に表が無い（ダッシュボードの並び）" },
  { path: "recentWorks", why: "Cloudflare に表が無い（最近開いた制作物）" },
  // export の付録
  {
    path: "_storage",
    why: "ファイル本体。業務データはオブジェクトストレージ（objectKey）にあり、ここでは動かさない",
  },
  { path: "_tables", why: "Convex の表の一覧（export の付録）" },
];

/** 移さず、取り込みのあとに元の行から作り直す表（sqlite/derived.ts。migrate/rebuild.ts が呼ぶ） */
export const REBUILT: readonly { path: string; rebuiltAs: string }[] = [
  { path: "workSummaries", rebuiltAs: "workSummaries（syncWorkSummary）" },
  { path: "workRoles", rebuiltAs: "workRoles（syncWorkRoles）" },
  { path: "workSearch", rebuiltAs: "workSearch（FTS5。syncWorkSearch）" },
  { path: "notificationCounters", rebuiltAs: "notificationCounters（未読の数え直し）" },
];

const under = (path: string, prefix: string): boolean =>
  path === prefix || path.startsWith(`${prefix}/`) || path.endsWith(`/${prefix}`);

// ---------------------------------------------------------------- 変換の本体

/** 移さなかった行の数と、先頭の数件の ID（理由ごと） */
export type Skipped = Record<string, { count: number; examples: string[] }>;

export function noteSkip(skipped: Skipped, key: string, example: string): void {
  const entry = (skipped[key] ??= { count: 0, examples: [] });
  entry.count += 1;
  if (entry.examples.length < 5) entry.examples.push(example);
}

export interface ExportResult {
  rows: MigrateRow[];
  /** Cloudflare の表ごとの、取り込む行の数（突き合わせの元） */
  counts: Record<string, number>;
  skipped: Skipped;
  /** 捨てた場所と行数 */
  dropped: Record<string, number>;
  rebuilt: string[];
  /** どの対応にも入っていない場所。空でなければ対応表を直してから進む */
  unknown: string[];
}

/**
 * export の中身（場所 → 行）を、取り込む行に変える。
 * 同じ表の中は `_creationTime` の昇順（Cloudflare の rowid = 追加順を Convex と同じにする。feedback の pageThreads が頼る）。
 * 同じ主キーが 2 度出たら後の行が勝つ（再実行で結果が変わらないため）。
 *
 * ponytail: 全部をメモリに載せる。数 GB を超えるなら場所ごとに流す形へ変える（今の規模は数十 MB）。
 */
export function convertExport(tables: ReadonlyMap<string, readonly ConvexDoc[]>): ExportResult {
  const ctx: Ctx = { accountSubject: new Map(), seenSubjects: new Set() };
  for (const a of tables.get("authAccounts") ?? []) {
    const provider = str(a.provider);
    const sub = str(a.providerAccountId);
    const userId = str(a.userId);
    // provider は nogiku（本物もモックも同じ id。providers/nogiku.ts・nogikuMock.ts）
    if (provider === "nogiku" && sub && userId && !ctx.accountSubject.has(userId))
      ctx.accountSubject.set(userId, sub);
  }

  const rows: MigrateRow[] = [];
  const counts: Record<string, number> = {};
  const skipped: Skipped = {};
  const dropped: Record<string, number> = {};
  const rebuilt: string[] = [];
  const unknown: string[] = [];

  for (const m of MAPPINGS) {
    const docs = [...(tables.get(m.from) ?? [])].sort(
      (a, b) => (a._creationTime ?? 0) - (b._creationTime ?? 0),
    );
    // 主キーのある表は Map で後勝ち（最初に出た位置は動かさない）。無い表（keyless）は全部残す
    const byKey = new Map<string, MigrateRow>();
    const loose: MigrateRow[] = [];
    for (const d of docs) {
      if (typeof d._id !== "string") {
        noteSkip(skipped, `${m.from}: no-_id`, "(行に _id が無い)");
        continue;
      }
      const out = m.convert(d, ctx);
      if (typeof out === "string") {
        noteSkip(skipped, `${m.from}: ${out}`, d._id);
        continue;
      }
      for (const row of out) {
        const key = row.id ?? (typeof row.doc.id === "string" ? row.doc.id : undefined);
        if (key === undefined) loose.push(row);
        else {
          if (byKey.has(key)) noteSkip(skipped, `${m.from}: duplicate-key（後の行が勝つ）`, key);
          byKey.set(key, row);
        }
      }
    }
    const emitted = [...byKey.values(), ...loose];
    rows.push(...emitted);
    if (emitted.length > 0) counts[m.to] = (counts[m.to] ?? 0) + emitted.length;
  }

  const mapped = new Set(MAPPINGS.map((m) => m.from));
  for (const [path, docs] of tables) {
    if (mapped.has(path)) continue;
    if (REBUILT.some((r) => under(path, r.path))) rebuilt.push(path);
    else if (DROPPED.some((x) => under(path, x.path))) dropped[path] = docs.length;
    else unknown.push(path);
  }
  return { rows, counts, skipped, dropped, rebuilt, unknown };
}
