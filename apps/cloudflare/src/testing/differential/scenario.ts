// 差分テストの手順表。Convex と Cloudflare の両方の実行器が、この同じ表を上から順に解釈する。
// 手順は「誰が（by）何を（call）」の行。args の { $ref: "名前.パス" } は、前の手順の save した戻りから実行器ごとに埋める
// （ID は実行器ごとに違うため）。読み取り（query）の戻りは全部比べる。

export const ACTORS = ["manager", "creator", "approver", "reviewer", "stranger", "admin"] as const;
export type Actor = (typeof ACTORS)[number];

/** 時計の起点（両方の世界を同じ時刻から始める。fakeDb の既定と同じ 2026-11-01） */
export const START = Date.UTC(2026, 10, 1);
export const HOUR = 3_600_000;

export interface CallStep {
  /** サインインしている人。null は未サインイン */
  by: Actor | null;
  kind: "query" | "mutation";
  call: string;
  args: unknown;
  /** Hono だけが呼ぶ internal 関数（Convex は internal.*、Cloudflare はサービスキー） */
  service?: boolean;
  /** 戻りをこの名前で覚える。後の手順が { $ref: "名前.パス" } で使う */
  save?: string;
}
export interface TickStep {
  /** 両方の時計をこれだけ進める */
  tick: number;
}
export type Step = CallStep | TickStep;

export const ref = (path: string) => ({ $ref: path });
const m = (
  by: Actor | null,
  call: string,
  args: unknown,
  opts: { save?: string; service?: boolean } = {},
): CallStep => ({ by, kind: "mutation", call, args, ...opts });
const q = (by: Actor | null, call: string, args: unknown = {}, save?: string): CallStep => ({
  by,
  kind: "query",
  call,
  args,
  ...(save ? { save } : {}),
});
const tick = (ms: number): TickStep => ({ tick: ms });

/** 一通りの読み取り。段の区切りごとに、同じ問い合わせを同じ人で流して戻りを突き合わせる */
function readAll(by: Actor, tag: string, revision = "conf.revisionId"): Step[] {
  const rev = { revisionId: ref(revision) };
  return [
    q(by, "works:get", { workId: ref("workA") }, `${tag}_workGet`),
    q(by, "works:listMine", {}),
    q(by, "works:listMine", { text: "パンフ" }),
    q(by, "works:listMinePage", { paginationOpts: { numItems: 2, cursor: null } }, `${tag}_page1`),
    q(by, "works:listMinePage", {
      paginationOpts: { numItems: 2, cursor: ref(`${tag}_page1.continueCursor`) },
    }),
    q(by, "revisions:get", rev),
    q(by, "reviews:myQueue"),
    q(by, "dashboard:check"),
    q(by, "dashboard:make"),
    q(by, "dashboard:works"),
    q(by, "dashboard:checkBadge"),
    q(by, "notifications:list", {}, `${tag}_notifications`),
    q(by, "notifications:unreadCount"),
    q(by, "me:me"),
    q(by, "approvals:confirmationStatus", { workId: ref("workA") }),
    q(by, "home:submitTargets"),
    q(by, "home:pinned", { workId: ref("workA") }),
    q(by, "acl:list", { workId: ref("workA") }),
    q(by, "documents:get", { workId: ref("workA") }),
    q(by, "users:byIds", {
      ids: [ref("manager"), ref("creator"), ref("approver"), ref("reviewer")],
    }),
  ];
}

const work = (title: string, extra: Record<string, unknown> = {}) => ({
  title,
  purpose: "来場者案内",
  category: "印刷物",
  mediaType: "pdf",
  year: 100,
  creatorIds: [ref("creator")],
  approverId: ref("approver"),
  deadlineAt: START + 14 * 24 * HOUR,
  activate: true,
  ...extra,
});

export const SCENARIO: Step[] = [
  // --- 制作物の登録（ページ送りを確かめるため 3 件）
  m("manager", "works:create", work("MF100 パンフレット"), { save: "workA" }),
  tick(HOUR),
  m(
    "manager",
    "works:create",
    work("ポスター", { mediaType: "image", activate: false, genre: "graphic" }),
    {
      save: "workB",
    },
  ),
  tick(HOUR),
  m("manager", "works:create", work("チラシ", { deadlineAt: START + 3 * 24 * HOUR }), {
    save: "workC",
  }),
  q("stranger", "works:get", { workId: ref("workB") }),
  q("manager", "works:listMine"),
  ...readAll("reviewer", "s0").filter((s) => "call" in s && s.call !== "revisions:get"),

  // --- 版の提出（prepare → beginUpload → completeUpload → confirm）
  tick(HOUR),
  m(
    "creator",
    "submissions:prepare",
    {
      workId: ref("workA"),
      kind: "standard",
      reviewType: "general",
      deadlineAt: START + 2 * 24 * HOUR,
      changeSummary: "初版",
      focusNotes: "表記の統一を見てほしい",
      items: [
        { fileName: "pamphlet.pdf", mimeType: "application/pdf", type: "pdf", role: "source" },
        { fileName: "cover.png", mimeType: "image/png", type: "image", role: "source" },
      ],
    },
    { save: "prep" },
  ),
  q("creator", "submissions:get", { sessionId: ref("prep.sessionId") }),
  m(
    "creator",
    "submissions:beginUpload",
    { itemId: ref("prep.items.0.id") },
    {
      save: "att0",
      service: true,
    },
  ),
  m(
    "creator",
    "submissions:completeUpload",
    {
      attemptId: ref("att0.attemptId"),
      size: 1024,
      sha256: "sha-0",
      pageCount: 4,
    },
    { service: true },
  ),
  m(
    "creator",
    "submissions:beginUpload",
    { itemId: ref("prep.items.1.id") },
    {
      save: "att1",
      service: true,
    },
  ),
  m(
    "creator",
    "submissions:completeUpload",
    {
      attemptId: ref("att1.attemptId"),
      size: 2048,
      sha256: "sha-1",
    },
    { service: true },
  ),
  q("creator", "submissions:get", { sessionId: ref("prep.sessionId") }),
  tick(HOUR),
  m("creator", "submissions:confirm", { sessionId: ref("prep.sessionId") }, { save: "conf" }),
  // 添付の ID は revisions:get から取る（anchor が使う）
  q("creator", "revisions:get", { revisionId: ref("conf.revisionId") }, "rev1"),
  ...readAll("creator", "s1"),

  // --- 校正者の割当（割当だけでは閲覧権限にならないので、統括でなく管理者が review を付ける）
  tick(HOUR),
  m("admin", "acl:grant", {
    workId: ref("workA"),
    userIds: [ref("reviewer")],
    permission: "review",
  }),
  m("manager", "reviews:setReviewers", { workId: ref("workA"), reviewerIds: [ref("reviewer")] }),
  // 付けて外した許可（acl:list が履歴つきで返す）
  tick(HOUR),
  m("admin", "acl:grant", {
    workId: ref("workA"),
    userIds: [ref("stranger")],
    permission: "review",
  }),
  q("admin", "acl:list", { workId: ref("workA") }),
  ...readAll("reviewer", "s2"),
  ...readAll("manager", "s2m"),

  // --- コメント 2 件・返信・リアクション・既読
  tick(HOUR),
  m(
    "reviewer",
    "comments:post",
    {
      revisionId: ref("conf.revisionId"),
      body: "団体名が誤りです",
      kind: "correction",
      severity: "major",
      anchor: {
        type: "pdf_rect",
        artifactId: ref("rev1.artifacts.0.id"),
        page: 1,
        rect: { x: 0.1, y: 0.2, w: 0.3, h: 0.1 },
      },
    },
    { save: "threadA" },
  ),
  tick(HOUR),
  m(
    "reviewer",
    "comments:post",
    {
      revisionId: ref("conf.revisionId"),
      body: "表紙の色を確認してください",
      kind: "question",
      severity: "info",
    },
    { save: "threadB" },
  ),
  m(
    "reviewer",
    "comments:post",
    {
      revisionId: ref("conf.revisionId"),
      body: "ロゴの余白は次の版で見ます",
      kind: "question",
      severity: "info",
    },
    { save: "threadC" },
  ),
  tick(HOUR),
  m("creator", "comments:reply", { threadId: ref("threadA"), body: "直します" }),
  m("reviewer", "comments:toggleReaction", { threadId: ref("threadA"), emoji: "👍" }),
  m("creator", "comments:toggleReaction", { threadId: ref("threadA"), emoji: "👍" }),
  m("creator", "comments:markRead", { threadId: ref("threadA") }),
  q("creator", "comments:events", { threadId: ref("threadA") }, "eventsA"),
  q("reviewer", "comments:events", { threadId: ref("threadA") }),
  q("manager", "comments:events", { threadId: ref("threadB") }),
  m("reviewer", "comments:toggleReaction", {
    threadId: ref("threadA"),
    replyEventId: ref("eventsA.events.1.id"),
    emoji: "🙏",
  }),
  ...readAll("creator", "s3"),
  ...readAll("reviewer", "s3r"),

  // --- 採否の決定
  tick(HOUR),
  m("creator", "comments:decide", { threadId: ref("threadA"), action: "accepted" }),
  m("creator", "comments:decide", {
    threadId: ref("threadB"),
    action: "rejected",
    reason: "現行のままで問題なし",
  }),
  q("reviewer", "comments:events", { threadId: ref("threadA") }),
  q("reviewer", "comments:events", { threadId: ref("threadB") }),
  // 直った印（採用のままだと校了を止める）
  m("creator", "comments:decide", { threadId: ref("threadA"), action: "resolved" }),
  ...readAll("reviewer", "s4"),

  // --- 必須確認の追加と完了
  tick(HOUR),
  m(
    "manager",
    "checks:add",
    { revisionId: ref("conf.revisionId"), type: "photo", label: "写真の掲載確認" },
    { save: "check1" },
  ),
  ...readAll("manager", "s5m"),
  m("manager", "checks:complete", { checkId: ref("check1"), note: "確認済み" }),
  ...readAll("manager", "s5"),

  // --- ピン留め
  m("creator", "home:setPinned", { workId: ref("workA"), pinned: true }),
  q("creator", "home:pinned", { workId: ref("workA") }),
  q("creator", "dashboard:works"),

  // --- 通知の一覧と既読
  q("creator", "notifications:list", {}, "creatorNotes"),
  m("creator", "notifications:markRead", { notificationId: ref("creatorNotes.0.id") }),
  q("creator", "notifications:unreadCount"),
  q("creator", "notifications:list", { unreadOnly: true }),
  m("creator", "notifications:markAllRead", {}),
  q("creator", "notifications:unreadCount"),
  q("reviewer", "notifications:list", { limit: 1 }),

  // --- 校了
  ...readAll("approver", "s5a"),
  tick(HOUR),
  m("reviewer", "reviews:complete", { revisionId: ref("conf.revisionId") }),
  m("approver", "approvals:finalize", {
    workId: ref("workA"),
    revisionId: ref("conf.revisionId"),
  }),
  m("admin", "acl:revoke", { workId: ref("workA"), userId: ref("stranger") }),
  q("admin", "acl:list", { workId: ref("workA") }),
  ...readAll("approver", "s6"),
  ...readAll("creator", "s6c"),
  ...readAll("stranger", "s6x"),
  q(null, "me:me"),
  q("manager", "notation:ruleBook"),
  q("stranger", "notation:ruleBook"),

  // --- 校了のあとの再開と第 2 版（期限切れ・外部リンク・メンション・持越・担当・編集・保留）
  tick(3 * 24 * HOUR),
  q("reviewer", "reviews:myQueue"),
  q("creator", "dashboard:make"),
  m("approver", "approvals:reopen", { workId: ref("workA"), reason: "表記の修正が必要" }),
  m("manager", "works:update", {
    workId: ref("workA"),
    patch: { title: "MF100 パンフレット（改）", deadlineAt: START + 20 * 24 * HOUR },
  }),
  tick(HOUR),
  m(
    "creator",
    "submissions:prepare",
    {
      workId: ref("workA"),
      kind: "standard",
      reviewType: "general",
      deadlineAt: START + 6 * 24 * HOUR,
      changeSummary: "表記を直した",
      focusNotes: "団体名",
      items: [
        { fileName: "pamphlet-v2.pdf", mimeType: "application/pdf", type: "pdf", role: "source" },
        {
          fileName: "参考",
          mimeType: "text/uri-list",
          type: "external_link",
          role: "external",
          externalUrl: "https://example.com/reference",
        },
      ],
      requiredChecks: [{ type: "design", label: "デザイン確認", assigneeId: ref("creator") }],
    },
    { save: "prep2" },
  ),
  m(
    "creator",
    "submissions:beginUpload",
    { itemId: ref("prep2.items.0.id") },
    {
      save: "att2",
      service: true,
    },
  ),
  m(
    "creator",
    "submissions:completeUpload",
    { attemptId: ref("att2.attemptId"), size: 4096, sha256: "sha-2", pageCount: 5 },
    { service: true },
  ),
  m("creator", "submissions:confirm", { sessionId: ref("prep2.sessionId") }, { save: "conf2" }),
  q("creator", "revisions:get", { revisionId: ref("conf2.revisionId") }),
  q("creator", "comments:carryCandidates", { revisionId: ref("conf2.revisionId") }),
  m("creator", "comments:carryForward", {
    threadId: ref("threadC"),
    targetRevisionId: ref("conf2.revisionId"),
  }),
  tick(HOUR),
  m(
    "reviewer",
    "comments:post",
    {
      revisionId: ref("conf2.revisionId"),
      body: "@creator 団体名の表記を確認してください",
      kind: "correction",
      severity: "minor",
      mentions: [ref("creator")],
    },
    { save: "threadD" },
  ),
  m("reviewer", "comments:edit", {
    threadId: ref("threadD"),
    body: "@creator 団体名の表記を再確認してください",
  }),
  m("creator", "comments:assign", { threadId: ref("threadD"), assigneeId: ref("creator") }),
  m("creator", "comments:reply", { threadId: ref("threadD"), body: "確認します" }),
  q("creator", "comments:events", { threadId: ref("threadD") }, "eventsD"),
  m("creator", "comments:editReply", {
    threadId: ref("threadD"),
    replyEventId: ref("eventsD.events.2.id"),
    body: "確認して直します",
  }),
  m("reviewer", "comments:setSubscription", { threadId: ref("threadD"), on: true }),
  q("reviewer", "comments:events", { threadId: ref("threadD") }),
  q("creator", "comments:events", { threadId: ref("threadD") }),
  q("creator", "comments:searchMentionCandidates", { workId: ref("workA"), text: "" }),
  ...readAll("creator", "s7c", "conf2.revisionId"),
  ...readAll("reviewer", "s7r", "conf2.revisionId"),
  ...readAll("manager", "s7m", "conf2.revisionId"),
  ...readAll("approver", "s7a", "conf2.revisionId"),
  m("manager", "works:changeLifecycle", { workId: ref("workB"), to: "active" }),
  m("manager", "works:changeLifecycle", { workId: ref("workC"), to: "cancelled" }),
  q("manager", "works:listMine", { lifecycle: "cancelled" }),
  q("manager", "works:listMine", { lifecycle: "active" }),
  q("manager", "works:listMine", { year: 100 }),
  q("manager", "works:listMine", { year: 99 }),
  q("manager", "works:listMine", { text: "ポスター" }),
  q("manager", "works:listMine", { genre: "graphic" }),
  q("stranger", "works:listMine", {}),
  q("admin", "works:listMine", {}),
  q("admin", "dashboard:works"),
  q("admin", "dashboard:check"),
  q("admin", "dashboard:make"),
  q("manager", "dashboard:works"),

  // --- 画面の周りの読み（名簿・表記・管理）。最後に 1 回ずつ
  q("creator", "documents:writable"),
  q("creator", "users:search", { text: "" }),
  q("creator", "users:search", { text: "rev", limit: 5 }),
  q("creator", "users:avatars", { ids: [ref("creator"), ref("reviewer")] }),
  q("creator", "comments:carryCandidates", { revisionId: ref("conf.revisionId") }),
  q("creator", "comments:searchMentionCandidates", { workId: ref("workA"), text: "r" }),
  q("creator", "notation:categories"),
  q("creator", "notation:proposals", { status: null }),
  q("creator", "notation:rulesForWork", { workId: ref("workA") }),
  q("creator", "groups:list"),
  q("creator", "teams:list"),
  q("creator", "social:list"),
  q("creator", "notificationPrefs:get"),
  q("creator", "workMetrics:counts", { year: 100 }),
  q("manager", "works:importDirectory", { keys: ["creator", "reviewer"] }),
  q("admin", "acl:searchUsers", { text: "" }),
  q("admin", "acl:workSummary", { workId: ref("workA") }),
  q("admin", "acl:adminWorks"),
  q("admin", "admin:workStats", {}),
  q("admin", "admin:auditLog", {}),
  q("admin", "teams:importDirectory", { keys: ["creator"] }),
];
