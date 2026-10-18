import {
  summarizeFeedbackActivity,
  changeWorkLifecycle,
  createWork,
  importWorks,
  loadAuthorizedWork,
  updateWork,
} from "@mf100/application";
import {
  canViewWork,
  currentDeclarations,
  defaultWorkViewPolicy,
  hasOrgPermission,
  normalizePersonKey,
  permissionIncludes,
  orgPermissions,
  type DirectoryUser,
  approvalProgressOf,
  approvalSetupOf,
  approversOf,
  isAccepting,
  isAllowed,
  isGrantActive,
  revisionLabel,
  workTeamIdsOf,
  type Principal,
  type Work,
  type WorkViewPolicy,
} from "@mf100/domain";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { mutation, query, type DatabaseReader } from "./_generated/server";
import { createAppContext, createReadContext, workFromDoc } from "./lib/adapters.ts";
import { runUseCase } from "./lib/errors.ts";
import { requireUser, teamIdsOf } from "./lib/principal.ts";
import { resolveUsers } from "./lib/users.ts";
import {
  vConfidentiality,
  vLifecycleTarget,
  vMediaType,
  vWorkGenre,
  vWorkMetadataFields,
  vWorkMetadataPatch,
} from "./lib/validators.ts";

const workPatch = {
  /** Notion の制作物 DB に揃えた項目（null で消す。docs/NOTION_ALIGNMENT.md） */
  ...vWorkMetadataPatch,
  title: v.optional(v.string()),
  purpose: v.optional(v.string()),
  category: v.optional(v.string()),
  mediaType: v.optional(vMediaType),
  deadlineAt: v.optional(v.number()),
  creatorIds: v.optional(v.array(v.string())),
  /** 校了者。approverIds があればそちら（複数可）。approverId だけなら「その 1 人に置き換える」 */
  approverId: v.optional(v.string()),
  approverIds: v.optional(v.array(v.string())),
  /** 校了とみなす人数（1..校了者の数。校了者だけを変えて省略すると、いまの人数を校了者の数に収める） */
  approvalQuorum: v.optional(v.number()),
  managerIds: v.optional(v.array(v.string())),
  confidentiality: v.optional(vConfidentiality),
  legacyId: v.optional(v.string()),
  ownerTeamId: v.optional(v.string()),
  productionTeamIds: v.optional(v.array(v.string())),
  relatedTeamIds: v.optional(v.array(v.string())),
  notationCategories: v.optional(v.array(v.string())),
  /** SNS のアカウントの割り当て（null で外す） */
  socialProfileId: v.optional(v.union(v.string(), v.null())),
};

export const create = mutation({
  args: {
    title: v.string(),
    purpose: v.string(),
    category: v.string(),
    mediaType: vMediaType,
    year: v.number(),
    legacyId: v.optional(v.string()),
    ownerTeamId: v.optional(v.string()),
    productionTeamIds: v.optional(v.array(v.string())),
    relatedTeamIds: v.optional(v.array(v.string())),
    managerIds: v.optional(v.array(v.string())),
    creatorIds: v.array(v.string()),
    /** 校了者。approverIds があればそちら。無ければ approverId の 1 人 */
    approverId: v.optional(v.string()),
    approverIds: v.optional(v.array(v.string())),
    approvalQuorum: v.optional(v.number()),
    deadlineAt: v.optional(v.number()),
    confidentiality: v.optional(vConfidentiality),
    notationCategories: v.optional(v.array(v.string())),
    activate: v.optional(v.boolean()),
    /** Notion の制作物 DB に揃えた項目 */
    ...vWorkMetadataFields,
  },
  handler: async (ctx, args) => {
    const { principal } = await requireUser(ctx);
    return runUseCase(async () => {
      const work = await createWork(createAppContext(ctx), principal, args);
      return work.id;
    });
  },
});

/**
 * 制作物の一括登録（CSV）。画面が CSV を解析し、担当者を照合して確認した行だけを送る。
 * 登録は application の importWorks（権限 `works:create`・1 件ずつの登録と同じ検証と監査・まとめて 1 トランザクション）。
 */
export const importBatch = mutation({
  args: {
    rows: v.array(
      v.object({
        title: v.string(),
        year: v.number(),
        purpose: v.string(),
        category: v.string(),
        mediaType: vMediaType,
        creatorIds: v.array(v.id("users")),
        managerIds: v.array(v.id("users")),
        approverIds: v.array(v.id("users")),
        approvalQuorum: v.optional(v.number()),
        deadlineAt: v.optional(v.number()),
        legacyId: v.optional(v.string()),
        confidentiality: vConfidentiality,
        notationCategories: v.array(v.string()),
        /** 主管担当・制作担当・関係担当（teams の ID） */
        ownerTeamId: v.optional(v.string()),
        productionTeamIds: v.optional(v.array(v.string())),
        relatedTeamIds: v.optional(v.array(v.string())),
        /** 制作物 DB に揃えた項目（docs/NOTION_ALIGNMENT.md） */
        ...vWorkMetadataFields,
      }),
    ),
    source: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { principal } = await requireUser(ctx);
    return runUseCase(async () => {
      const works = await importWorks(createAppContext(ctx), principal, {
        ...args,
        rows: args.rows.map((r) => ({
          ...r,
          stakeholderIds: r.stakeholderIds ?? [],
          tags: r.tags ?? [],
          productionTeamIds: r.productionTeamIds ?? [],
          relatedTeamIds: r.relatedTeamIds ?? [],
        })),
      });
      return works.map((w) => w.id);
    });
  },
});

/**
 * 一括登録の担当者の照合に使う利用者（CSV に書かれたメールアドレス・名前に当たる人だけ）。
 * 一度でもサインインした委員が対象（UserPicker と同じ）。登録の権限（works:create）がある人だけが引ける。
 */
export const importDirectory = query({
  args: { keys: v.array(v.string()) },
  handler: async (ctx, { keys }): Promise<DirectoryUser[]> => {
    const { principal } = await requireUser(ctx);
    if (!hasOrgPermission(principal, orgPermissions.worksCreate)) return [];
    const wanted = new Set(keys.slice(0, 2000).map(normalizePersonKey));
    if (wanted.size === 0) return [];
    const users = await ctx.db.query("users").take(5000);
    return users
      .filter((u) => u.nogikuSubject !== undefined)
      .filter(
        (u) =>
          wanted.has(normalizePersonKey(u.name ?? "")) ||
          (u.email !== undefined && wanted.has(normalizePersonKey(u.email))),
      )
      .map((u) => ({ id: u._id, name: u.name ?? "", email: u.email ?? null }));
  },
});

export const update = mutation({
  args: {
    workId: v.id("works"),
    expectedVersion: v.optional(v.number()),
    patch: v.object(workPatch),
  },
  handler: async (ctx, args) => {
    const { principal } = await requireUser(ctx);
    return runUseCase(async () => {
      const input: Parameters<typeof updateWork>[2] = { workId: args.workId, patch: args.patch };
      if (args.expectedVersion !== undefined) input.expectedVersion = args.expectedVersion;
      const work = await updateWork(createAppContext(ctx), principal, input);
      return work.version;
    });
  },
});

export const changeLifecycle = mutation({
  args: { workId: v.id("works"), to: vLifecycleTarget, expectedVersion: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const { principal } = await requireUser(ctx);
    return runUseCase(async () => {
      const input: Parameters<typeof changeWorkLifecycle>[2] = { workId: args.workId, to: args.to };
      if (args.expectedVersion !== undefined) input.expectedVersion = args.expectedVersion;
      await changeWorkLifecycle(createAppContext(ctx), principal, input);
      return null;
    });
  },
});

/**
 * 制作物詳細（U-03）。権限のない利用者には作品の存在も返さない（A-01）。
 */
export const get = query({
  args: { workId: v.string() },
  handler: async (ctx, { workId }) => {
    const { principal } = await requireUser(ctx);
    const app = createReadContext(ctx.db);
    return runUseCase(async () => {
      const { work, grants } = await loadAuthorizedWork(app, principal, workId, "work.view");
      const revisions = (await app.revisions.listByWork(work.id)).sort((a, b) =>
        a.kind === b.kind ? b.sequence - a.sequence : a.kind === "rough" ? 1 : -1,
      );
      const approvals = await app.approvals.listByWork(work.id);
      const authz = { work, grants, principal };
      // 校了者の全員と、宣言の進み具合（n 人中 m 人）。古い行（approverId だけ）も同じに読める
      const approvers = approvalProgressOf(work, approvals, revisions);
      const users = await resolveUsers(ctx.db, [
        ...work.creatorIds,
        ...work.managerIds,
        ...(work.stakeholderIds ?? []),
        ...approvers.approverIds,
        ...revisions.map((r) => r.submittedBy),
        ...approvals.map((a) => a.actorId),
      ]);
      const openCounts = new Map<string, number>();
      const openBotCounts = new Map<string, number>();
      const pendingChecks = new Map<string, string[]>();
      // 版ごとの読み取りは互いに独立なので並べて待つ（版の数だけ順番に往復しない）
      await Promise.all(
        revisions.map(async (r) => {
          const [checks, threads] = await Promise.all([
            app.checks.listByRevision(r.id),
            app.threads.listByRevision(r.id),
          ]);
          pendingChecks.set(
            r.id,
            checks.filter((c) => c.state === "pending").map((c) => c.label),
          );
          // 自動校正の未確認（校了時に確認メモを求める。校了は止めない）
          openBotCounts.set(
            r.id,
            threads.filter(
              (t) =>
                t.origin?.kind === "bot" &&
                (t.resolution === "open" || t.resolution === "acknowledged"),
            ).length,
          );
          openCounts.set(
            r.id,
            threads.filter(
              (t) =>
                t.resolution === "open" ||
                t.resolution === "acknowledged" ||
                t.resolution === "accepted",
            ).length,
          );
        }),
      );
      // 既定で開く版（受付中、無ければ最新の有効な版）の添付の要約。校正画面は版 → 添付の順に 2 回の問い合わせを待ってからファイルを
      // 取りに行くので、この要約で 1 回早くファイルの先取りを始められる（web の EditorPrefetch）。認可は同じ（work.view を通った後）
      const openRevision =
        revisions.find(isAccepting) ??
        revisions
          .filter((r) => r.reviewState !== "void")
          .sort((a, b) => b.submittedAt - a.submittedAt)[0] ??
        null;
      const openArtifacts = openRevision ? await app.artifacts.listByRevision(openRevision.id) : [];
      return {
        work,
        defaultArtifacts: openRevision
          ? {
              revisionId: openRevision.id,
              artifacts: openArtifacts.map((a) => ({
                id: a.id,
                type: a.type,
                role: a.role,
                fileName: a.fileName,
              })),
            }
          : null,
        people: {
          creators: work.creatorIds.map((id) => users.get(id)),
          managers: work.managerIds.map((id) => users.get(id)),
          stakeholders: (work.stakeholderIds ?? []).map((id) => users.get(id)),
          approver: users.get(approvers.approverIds[0]!),
          approvers: approvers.approverIds.map((id) => users.get(id)),
        },
        /** 校了の進み具合: 校了者ごとの宣言（数えている版の分）と、校了とみなす人数 */
        approval: {
          quorum: approvers.quorum,
          revisionId: approvers.revisionId,
          reached: approvers.reached,
          approvers: approvers.approverIds.map((id) => ({
            user: users.get(id),
            declared: approvers.declaredIds.includes(id),
            isMe: id === principal.userId,
          })),
          declaredCount: approvers.declaredIds.length,
          /** 閲覧している人が校了者で、まだ宣言していないか（校了の操作を出す） */
          canDeclare:
            approvers.approverIds.includes(principal.userId) &&
            !approvers.declaredIds.includes(principal.userId),
        },
        /** 「現在の版」の申告（写真・めい・指針外の色。Notion の formula に相当）。申告の無い版なら null */
        currentDeclarations: currentDeclarations(revisions),
        revisions: revisions.map((r) => ({
          ...r,
          label: revisionLabel(r),
          submitter: users.get(r.submittedBy),
          unresolvedCount: openCounts.get(r.id) ?? 0,
          openBotCount: openBotCounts.get(r.id) ?? 0,
          pendingChecks: pendingChecks.get(r.id) ?? [],
        })),
        acceptingRevisionId: revisions.find(isAccepting)?.id ?? null,
        approvals: approvals
          .map((a) => ({ ...a, actor: users.get(a.actorId) }))
          .sort((a, b) => a.createdAt - b.createdAt),
        activeGrantCount: grants.filter(isGrantActive).length,
        can: {
          edit: isAllowed("work.edit", authz),
          submit: isAllowed("revision.submit", authz),
          decide: isAllowed("comment.decide", authz),
          comment: isAllowed("comment.post", authz),
          assign: isAllowed("review.assign", authz),
          finalize: isAllowed("work.finalize", authz),
          reopen: isAllowed("work.reopen", authz),
          manageAcl: isAllowed("acl.manage", authz),
          viewAudit: isAllowed("audit.view", authz),
        },
      };
    });
  },
});

/**
 * 制作物一覧（U-02）。自分が見られる制作物を返す（通常の制作物は委員なら誰でも。非公開は関わる人だけ。listMyWorks）。
 */
export const listMine = query({
  args: {
    year: v.optional(v.number()),
    lifecycle: v.optional(
      v.union(
        v.literal("draft"),
        v.literal("active"),
        v.literal("on_hold"),
        v.literal("finalized"),
        v.literal("cancelled"),
      ),
    ),
    text: v.optional(v.string()),
    /** 大ジャンルで絞る（Notion の select） */
    genre: v.optional(vWorkGenre),
  },
  handler: async (ctx, args) => {
    const { principal } = await requireUser(ctx);
    const app = createReadContext(ctx.db);
    const mine = await listMyWorks(ctx.db, principal);
    const text = args.text?.trim().toLowerCase() ?? "";
    const picked = [];
    for (const work of mine) {
      if (args.year !== undefined && work.year !== args.year) continue;
      if (args.lifecycle !== undefined && work.lifecycle !== args.lifecycle) continue;
      if (args.genre !== undefined && work.genre !== args.genre) continue;
      if (
        text &&
        !`${work.title} ${work.legacyId ?? ""} ${work.category} ${work.purpose} ${(work.tags ?? []).join(" ")}`
          .toLowerCase()
          .includes(text)
      )
        continue;
      const revisions = await app.revisions.listByWork(work.id);
      const accepting = revisions.find(isAccepting) ?? null;
      const latest =
        revisions
          .filter((r) => r.reviewState !== "void")
          .sort((a, b) => b.submittedAt - a.submittedAt)[0] ?? null;
      // 校了者が 2 人以上いる進行中の制作物だけ、宣言の数を数える（履歴を読むのはそのときだけ）
      const declared =
        work.lifecycle === "active" && approvalSetupOf(work).quorum > 1
          ? approvalProgressOf(work, await app.approvals.listByWork(work.id), revisions).declaredIds
              .length
          : 0;
      picked.push({ work, latest, accepting, declared });
    }
    // 制作者・校了者の表示名（一覧で「担当別」に並べたとき、誰の制作物か分かるように）
    const users = await resolveUsers(
      ctx.db,
      picked.flatMap((p) => [...p.work.creatorIds, ...approversOf(p.work)]),
    );
    // 一覧から校了者を直せるか（主管、または管理者が付けた「管理」の閲覧権限。判定の本体は更新の work.edit）。
    // 管理の権限は自分に付いたものだけを 1 回の索引で引く（制作物ごとに ACL を読まない）
    const managed = await manageGrantedWorkIds(ctx.db, principal.userId);
    // 制作物ごとの FB（相談）の数と未読（一覧から制作物の FB へ直接入れるように）
    const fb = await summarizeFeedbackActivity(
      app,
      principal,
      picked.map((p) => p.work.id),
    );
    const out = picked.map(({ work, latest, accepting, declared }) => ({
      ...summarize(
        work,
        latest,
        accepting,
        work.creatorIds.map((id) => users.get(id)?.name ?? "（不明なユーザー）"),
      ),
      /** 校了者の全員（先頭が approverId）と校了とみなす人数、宣言の済んだ人数（2 人以上の進行中のみ） */
      approvers: approversOf(work).map((id) => ({
        id,
        name: users.get(id)?.name ?? "（不明なユーザー）",
      })),
      approvalQuorum: approvalSetupOf(work).quorum,
      approvalDeclared: declared,
      canEditApprovers:
        work.lifecycle !== "finalized" &&
        (work.managerIds.includes(principal.userId) || managed.has(work.id)),
      fb: fb.get(work.id) ?? { threads: 0, unread: 0 },
    }));
    return out.sort(
      (a, b) =>
        (a.acceptingDeadlineAt ?? Infinity) - (b.acceptingDeadlineAt ?? Infinity) ||
        a.title.localeCompare(b.title, "ja"),
    );
  },
});

/** 自分に「管理」以上の閲覧権限が有効に付いている制作物（user 宛の付与のみ。work.edit の ACL 側） */
async function manageGrantedWorkIds(db: DatabaseReader, userId: string): Promise<Set<string>> {
  const rows = await db
    .query("workPermissions")
    .withIndex("by_principal", (q) => q.eq("principalType", "user").eq("principalId", userId))
    .take(500);
  return new Set(
    rows
      .filter((g) => g.revokedAt === undefined && permissionIncludes(g.permission, "manage"))
      .map((g) => g.workId as string),
  );
}

/** 一覧で読む制作物の上限（委員会の制作物は年度あたり高々数百件） */
const WORKS_SCAN_LIMIT = 2000;

/**
 * 自分が見られる制作物。通常の制作物は委員なら誰でも（WorkViewPolicy。利用者決定 2026-10-17「閲覧は基本全員できて良い」）、
 * 非公開・取扱注意は職責・有効な ACL・関係者・担当の所属がある人。一覧・ダッシュボード・版提出の候補で共用。
 *
 * 読み方（docs/UI_M3E.md §60）: ポリシーが all_members のとき、通常の制作物は `by_confidentiality` の索引で集めるだけで
 * ACL を読まない（判定は機密区分だけで決まる）。非公開は同じ索引で集め、1 件ずつ ACL を読んでドメインの canViewWork で判定する
 * （職責・ACL・関係者で通らなければ、そのときだけ担当の所属を 1 回読んで判定し直す）。
 * 並びは works を全走査していたときと同じ（_creationTime の昇順）。ポリシーが involved_only なら従来どおり全件を判定する。
 */
export async function listMyWorks(
  db: DatabaseReader,
  principal: Principal,
  policy: WorkViewPolicy = defaultWorkViewPolicy,
): Promise<Work[]> {
  const app = createReadContext(db);
  // 担当の所属を添えた主体。非公開の制作物で要るときだけ、1 回読む
  let member: Principal | null = null;
  const canView = async (work: Work): Promise<boolean> => {
    const grants = await app.acl.listByWork(work.id);
    if (canViewWork({ work, grants, principal, viewPolicy: policy })) return true;
    if (principal.teamIds !== undefined || workTeamIdsOf(work).length === 0) return false;
    member ??= { ...principal, teamIds: await teamIdsOf(db, principal.userId as Id<"users">) };
    return canViewWork({ work, grants, principal: member, viewPolicy: policy });
  };
  const out: Work[] = [];
  if (policy.normalWorks !== "all_members") {
    for (const work of await app.works.list(WORKS_SCAN_LIMIT))
      if (await canView(work)) out.push(work);
    return out;
  }
  const byConfidentiality = (c: Doc<"works">["confidentiality"]) =>
    db
      .query("works")
      .withIndex("by_confidentiality", (q) => q.eq("confidentiality", c))
      .take(WORKS_SCAN_LIMIT);
  const [normal, restricted] = await Promise.all([
    byConfidentiality("normal"),
    byConfidentiality("restricted"),
  ]);
  // 索引の中は _creationTime 順。2 本を作成時刻で合流し、全走査と同じ並びにする
  const docs = [...normal, ...restricted].sort((a, b) => a._creationTime - b._creationTime);
  for (const doc of docs) {
    const work = workFromDoc(doc);
    if (doc.confidentiality === "normal" || (await canView(work))) out.push(work);
  }
  return out;
}

function summarize(
  work: Work,
  latest: { kind: "rough" | "standard"; sequence: number } | null,
  accepting: { id: string; deadlineAt: number } | null,
  creators: string[],
) {
  return {
    id: work.id as Id<"works">,
    title: work.title,
    legacyId: work.legacyId ?? null,
    category: work.category,
    mediaType: work.mediaType,
    genre: work.genre ?? null,
    subGenre: work.subGenre ?? null,
    tags: [...(work.tags ?? [])],
    year: work.year,
    lifecycle: work.lifecycle,
    confidentiality: work.confidentiality,
    deadlineAt: work.deadlineAt ?? null,
    latestRevisionLabel: latest ? revisionLabel(latest) : null,
    acceptingRevisionId: accepting?.id ?? null,
    acceptingDeadlineAt: accepting?.deadlineAt ?? null,
    /** 主管担当・制作担当（teams の ID。担当別の表示に使う） */
    ownerTeamId: work.ownerTeamId ?? null,
    productionTeamIds: [...work.productionTeamIds],
    /** 制作者の表示名 */
    creators,
  };
}
