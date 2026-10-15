import { describe, expect, it } from "vite-plus/test";
import type { Principal, WorkPermissionGrant } from "../acl/Permission.ts";
import {
  assertFeedbackFileAttachable,
  canModifyFeedbackPost,
  canPostFeedback,
  canRenameFeedbackThread,
  canViewFeedback,
  FEEDBACK_BODY_MAX,
  FEEDBACK_FILE_TTL_MS,
  FEEDBACK_FILES_MAX,
  FEEDBACK_TITLE_MAX,
  feedbackFileType,
  feedbackObjectKey,
  feedbackTemplates,
  isFeedbackFileStale,
  summarizeFeedbackReactions,
  toggleFeedbackReaction,
  validateFeedbackBody,
  validateFeedbackFileIds,
  validateFeedbackMentions,
  validateFeedbackReaction,
  validateFeedbackTemplate,
  validateFeedbackThreadTitle,
  verifyFeedbackFile,
  type FeedbackFile,
  type FeedbackPost,
} from "../feedback/feedback.ts";
import { computeWorkStats, workMatchesTeam, workStatsToCsv } from "../work/workStats.ts";
import type { Team } from "../org/team.ts";
import { HOUR, makeRevision, makeThread, makeWork, T0 } from "./fixtures.ts";

const code = (c: string) => expect.objectContaining({ code: c });
const who = (userId: string, isSystemAdmin = false): Principal => ({
  userId,
  isSystemAdmin,
  groupIds: [],
  orgPermissions: ["*"],
});
const grant = (principalId: string): WorkPermissionGrant => ({
  workId: "work1",
  principalType: "user",
  principalId,
  permission: "view",
  grantedBy: "manager",
  grantedAt: T0,
});

function makePost(over: Partial<FeedbackPost> = {}): FeedbackPost {
  return {
    id: "p1",
    threadId: "t1",
    workId: "work1",
    authorId: "creator",
    body: "配色の意図です",
    mentions: [],
    fileIds: [],
    reactions: [],
    createdAt: T0,
    ...over,
  };
}

function makeFile(over: Partial<FeedbackFile> = {}): FeedbackFile {
  return {
    id: "f1",
    workId: "work1",
    uploaderId: "creator",
    fileName: "案.pdf",
    mimeType: "application/pdf",
    type: "pdf",
    objectKey: "feedback/work1/f1/案.pdf",
    status: "verified",
    createdAt: T0,
    ...over,
  };
}

describe("フィードバックの権限", () => {
  it("通常の制作物はサインインした委員なら誰でも見られ、投稿できる", () => {
    const work = makeWork();
    expect(canViewFeedback({ work, grants: [], principal: who("stranger") })).toBe(true);
    expect(canPostFeedback({ work, grants: [], principal: who("stranger") })).toBe(true);
  });
  it("restricted の制作物は制作物を見られる人だけ（システム管理者でも職責・ACL が無ければ見られない）", () => {
    const work = makeWork({ confidentiality: "restricted" });
    expect(canViewFeedback({ work, grants: [], principal: who("stranger") })).toBe(false);
    expect(canViewFeedback({ work, grants: [], principal: who("admin", true) })).toBe(false);
    expect(canViewFeedback({ work, grants: [], principal: who("creator") })).toBe(true);
    expect(canPostFeedback({ work, grants: [grant("viewer")], principal: who("viewer") })).toBe(
      true,
    );
  });
  it("訂正は本人だけ、削除は本人かシステム管理者。削除済みは何もできない", () => {
    const post = makePost();
    expect(canModifyFeedbackPost(post, who("creator"))).toEqual({ edit: true, delete: true });
    expect(canModifyFeedbackPost(post, who("other"))).toEqual({ edit: false, delete: false });
    expect(canModifyFeedbackPost(post, who("admin", true))).toEqual({ edit: false, delete: true });
    expect(canModifyFeedbackPost({ ...post, deletedAt: T0 }, who("creator"))).toEqual({
      edit: false,
      delete: false,
    });
    expect(canRenameFeedbackThread({ createdBy: "creator" }, who("creator"))).toBe(true);
    expect(canRenameFeedbackThread({ createdBy: "creator" }, who("other"))).toBe(false);
    expect(canRenameFeedbackThread({ createdBy: "creator" }, who("admin", true))).toBe(true);
  });
});

describe("フィードバックの検査", () => {
  it(`題名は 1〜${FEEDBACK_TITLE_MAX} 文字（前後の空白を除く）`, () => {
    expect(validateFeedbackThreadTitle("  配色の方向性 ")).toBe("配色の方向性");
    expect(() => validateFeedbackThreadTitle("  ")).toThrow(code("feedback_invalid"));
    expect(() => validateFeedbackThreadTitle("あ".repeat(FEEDBACK_TITLE_MAX + 1))).toThrow(
      code("feedback_invalid"),
    );
  });
  it("本文は空ならファイル付きの投稿だけ許す。上限を超えると拒否", () => {
    expect(validateFeedbackBody(" 本文 ", { hasFiles: false })).toBe("本文");
    expect(validateFeedbackBody("", { hasFiles: true })).toBe("");
    expect(() => validateFeedbackBody(" ", { hasFiles: false })).toThrow(code("feedback_invalid"));
    expect(() =>
      validateFeedbackBody("a".repeat(FEEDBACK_BODY_MAX + 1), { hasFiles: false }),
    ).toThrow(code("feedback_invalid"));
  });
  it("リアクション・テンプレートは決まったものだけ。添付は 10 件まで", () => {
    expect(validateFeedbackReaction("👍")).toBe("👍");
    expect(() => validateFeedbackReaction("😀")).toThrow(code("feedback_invalid"));
    expect(validateFeedbackTemplate(undefined)).toBeUndefined();
    expect(validateFeedbackTemplate("reviewer")).toBe("reviewer");
    expect(() => validateFeedbackTemplate("nope")).toThrow(code("feedback_invalid"));
    expect(validateFeedbackFileIds(["a", "a", "b"])).toEqual(["a", "b"]);
    expect(() =>
      validateFeedbackFileIds(Array.from({ length: FEEDBACK_FILES_MAX + 1 }, (_, i) => `f${i}`)),
    ).toThrow(code("feedback_invalid"));
  });
  it("メンションは重複を除き 10 人まで、メンションできない人は拒否", () => {
    const ok = (id: string) => id !== "stranger";
    expect(validateFeedbackMentions(["a", "a", "b"], ok)).toEqual(["a", "b"]);
    expect(() => validateFeedbackMentions(["stranger"], ok)).toThrow(code("mention_not_allowed"));
    expect(() =>
      validateFeedbackMentions(
        Array.from({ length: 11 }, (_, i) => `u${i}`),
        ok,
      ),
    ).toThrow(code("mention_too_many"));
  });
});

describe("リアクション", () => {
  it("押すと付き、もう一度押すと外れる。0 人の絵文字は消え、並びは決まった順", () => {
    let post = makePost();
    post = toggleFeedbackReaction(post, "🎉", "a");
    post = toggleFeedbackReaction(post, "👍", "a");
    post = toggleFeedbackReaction(post, "👍", "b");
    expect(post.reactions).toEqual([
      { emoji: "👍", userIds: ["a", "b"] },
      { emoji: "🎉", userIds: ["a"] },
    ]);
    expect(summarizeFeedbackReactions(post.reactions, "b")).toEqual([
      { emoji: "👍", count: 2, mine: true },
      { emoji: "🎉", count: 1, mine: false },
    ]);
    post = toggleFeedbackReaction(post, "🎉", "a");
    expect(post.reactions.map((r) => r.emoji)).toEqual(["👍"]);
  });
});

describe("添付", () => {
  it("PDF と画像は表示、.ai や SVG はダウンロードだけ", () => {
    expect(feedbackFileType("application/pdf", "a.pdf")).toBe("pdf");
    expect(feedbackFileType("image/png", "a.png")).toBe("image");
    expect(feedbackFileType("", "a.JPG")).toBe("image");
    expect(feedbackFileType("image/svg+xml", "a.svg")).toBe("other");
    expect(feedbackFileType("application/postscript", "ポスター.ai")).toBe("other");
    expect(feedbackFileType("text/plain", "memo.txt")).toBe("document");
  });
  it("オブジェクトキーは feedback/ の下で制作物・添付ごとに分ける", () => {
    expect(feedbackObjectKey("w1", "f1", "案 1.pdf")).toBe("feedback/w1/f1/案_1.pdf");
  });
  it("申告サイズと違えば failed、合えば verified", () => {
    const pending = makeFile({ status: "pending", declaredSize: 10 });
    expect(verifyFeedbackFile(pending, { size: 9, sha256: "x" }).status).toBe("failed");
    expect(verifyFeedbackFile(pending, { size: 10, sha256: "x" })).toMatchObject({
      status: "verified",
      size: 10,
      sha256: "x",
    });
  });
  it("付けられるのは本人が同じ制作物に上げた検証済みの、まだ付けていない添付だけ", () => {
    const by = { uploaderId: "creator", workId: "work1" };
    expect(assertFeedbackFileAttachable(makeFile(), "f1", by).id).toBe("f1");
    for (const bad of [
      null,
      makeFile({ uploaderId: "other" }),
      makeFile({ workId: "work2" }),
      makeFile({ status: "pending" }),
      makeFile({ postId: "p0" }),
      makeFile({ abandonedAt: T0 }),
    ])
      expect(() => assertFeedbackFileAttachable(bad, "f1", by)).toThrow(
        code("feedback_file_not_ready"),
      );
  });
  it("投稿に付けないまま 24 時間たった添付は放置扱い", () => {
    const f = makeFile();
    expect(isFeedbackFileStale(f, T0 + FEEDBACK_FILE_TTL_MS - 1)).toBe(false);
    expect(isFeedbackFileStale(f, T0 + FEEDBACK_FILE_TTL_MS)).toBe(true);
    expect(isFeedbackFileStale({ ...f, postId: "p1" }, T0 + FEEDBACK_FILE_TTL_MS)).toBe(false);
  });
});

describe("テンプレート", () => {
  it("制作者・初回 / 制作者・版更新 / 校正er の 3 つ。見出しの下に「・」の観点、節の間は空行", () => {
    expect(feedbackTemplates.map((t) => [t.id, t.label, t.role])).toEqual([
      ["creator_first", "制作者・初回", "creator"],
      ["creator_update", "制作者・版更新", "creator"],
      ["reviewer", "校正er", "reviewer"],
    ]);
    const first = feedbackTemplates[0]!.body;
    expect(
      first.startsWith(
        "【この案の意図】\n・意識したこと\n・この表現にした理由\n\n【今回見てほしい点】",
      ),
    ).toBe(true);
    expect(feedbackTemplates[2]!.body).toContain(
      "・整列などは具体的に言い過ぎず、どの観点で気になるかを述べる",
    );
  });
});

describe("制作物ごとの集計（A-4）", () => {
  const teams: Team[] = [
    { id: "pr", name: "広報局", kind: "bureau", order: 1, updatedAt: T0, updatedBy: "a" },
    {
      id: "design",
      name: "デザイン担当",
      kind: "team",
      parentId: "pr",
      order: 1,
      updatedAt: T0,
      updatedBy: "a",
    },
    { id: "ga", name: "総務局", kind: "bureau", order: 2, updatedAt: T0, updatedBy: "a" },
  ];
  it("局で絞るとその局と配下の担当、担当で絞るとその担当", () => {
    const work = makeWork({ productionTeamIds: ["design"] });
    expect(workMatchesTeam(work, "pr", teams)).toBe(true);
    expect(workMatchesTeam(work, "design", teams)).toBe(true);
    expect(workMatchesTeam(work, "ga", teams)).toBe(false);
    expect(
      workMatchesTeam(makeWork({ ownerTeamId: "ga", productionTeamIds: [] }), "ga", teams),
    ).toBe(true);
  });
  it("版・コメント・採否・校了日を数える（自動校正・持ち越しの写し・void の版は数えない）", () => {
    const r0 = makeRevision({ id: "r0", kind: "rough", sequence: 0, submittedAt: T0 });
    const r1 = makeRevision({ id: "r1", sequence: 1, submittedAt: T0 + HOUR });
    const r2 = makeRevision({ id: "r2", sequence: 2, submittedAt: T0 + 2 * HOUR });
    const rv = makeRevision({ id: "rv", sequence: 3, reviewState: "void" });
    const t = (id: string, revisionId: string, over = {}) => ({
      thread: makeThread({ id, revisionId, ...over }),
      events: [] as never[],
    });
    const row = computeWorkStats({
      work: makeWork({
        lifecycle: "finalized",
        ownerTeamId: "design",
        productionTeamIds: ["design", "ga"],
      }),
      teams,
      revisions: [r0, r1, r2, rv],
      threads: [
        t("a", "r1"),
        {
          thread: makeThread({ id: "b", revisionId: "r1", resolution: "rejected" }),
          events: [
            {
              threadId: "b",
              eventType: "decided",
              actorId: "creator",
              reason: "意図どおり",
              payload: { from: "open", to: "rejected" },
              createdAt: T0 + 3 * HOUR,
            },
          ],
        },
        t("c", "r1", { resolution: "deferred" }),
        t("d", "r2", { carriedFromThreadId: "c", resolution: "open" }),
        t("e", "r2", { authorId: "bot:proofreader", origin: { kind: "bot" } }),
        t("f", "rv"),
      ],
      approvals: [
        {
          workId: "work1",
          revisionId: "r2",
          actorId: "approver",
          action: "finalized",
          requiredChecksSnapshot: {},
          createdAt: T0 + 36 * HOUR,
        },
      ],
      feedback: { threadCount: 2, postCount: 5 },
    });
    expect(row).toMatchObject({
      ownerTeam: "広報局 › デザイン担当",
      productionTeams: "広報局 › デザイン担当、総務局",
      revisionCount: 2,
      firstSubmittedAt: T0,
      finalizedAt: T0 + 36 * HOUR,
      daysToFinalize: 1.5,
      commentCount: 3,
      commentsPerRevision: "0版（ラフ） 0・第1版 3・第2版 0",
      rejectedCount: 1,
      deferredCount: 1,
      decisionReasons: "意図どおり",
      feedbackThreadCount: 2,
      feedbackPostCount: 5,
    });
    const csv = workStatsToCsv([row]);
    expect(csv.split("\r\n")[0]).toContain("制作物名");
    expect(csv).toContain("2026-11-01");
  });
});
