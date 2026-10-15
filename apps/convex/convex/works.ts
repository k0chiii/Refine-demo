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
  hasOrgPermission,
  normalizePersonKey,
  orgPermissions,
  type DirectoryUser,
  isAccepting,
  isAllowed,
  isGrantActive,
  revisionLabel,
  type Principal,
  type Work,
} from "@mf100/domain";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { mutation, query, type DatabaseReader } from "./_generated/server";
import { createAppContext, createReadContext } from "./lib/adapters.ts";
import { runUseCase } from "./lib/errors.ts";
import { requireUser } from "./lib/principal.ts";
import { resolveUsers } from "./lib/users.ts";
import { vConfidentiality, vLifecycleTarget, vMediaType } from "./lib/validators.ts";

const workPatch = {
  title: v.optional(v.string()),
  purpose: v.optional(v.string()),
  category: v.optional(v.string()),
  mediaType: v.optional(vMediaType),
  deadlineAt: v.optional(v.number()),
  creatorIds: v.optional(v.array(v.string())),
  approverId: v.optional(v.string()),
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
    approverId: v.string(),
    deadlineAt: v.optional(v.number()),
    confidentiality: v.optional(vConfidentiality),
    notationCategories: v.optional(v.array(v.string())),
    activate: v.optional(v.boolean()),
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
        approverId: v.id("users"),
        deadlineAt: v.optional(v.number()),
        legacyId: v.optional(v.string()),
        confidentiality: vConfidentiality,
        notationCategories: v.array(v.string()),
        /** 主管担当・制作担当（teams の ID） */
        ownerTeamId: v.optional(v.string()),
        productionTeamIds: v.optional(v.array(v.string())),
      }),
    ),
    source: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { principal } = await requireUser(ctx);
    return runUseCase(async () => {
      const works = await importWorks(createAppContext(ctx), principal, {
        ...args,
        rows: args.rows.map((r) => ({ ...r, productionTeamIds: r.productionTeamIds ?? [] })),
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
      const users = await resolveUsers(ctx.db, [
        ...work.creatorIds,
        ...work.managerIds,
        work.approverId,
        ...revisions.map((r) => r.submittedBy),
        ...approvals.map((a) => a.actorId),
      ]);
      const openCounts = new Map<string, number>();
      const openBotCounts = new Map<string, number>();
      const pendingChecks = new Map<string, string[]>();
      for (const r of revisions) {
        pendingChecks.set(
          r.id,
          (await app.checks.listByRevision(r.id))
            .filter((c) => c.state === "pending")
            .map((c) => c.label),
        );
        const threads = await app.threads.listByRevision(r.id);
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
      }
      return {
        work,
        people: {
          creators: work.creatorIds.map((id) => users.get(id)),
          managers: work.managerIds.map((id) => users.get(id)),
          approver: users.get(work.approverId),
        },
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
 * 制作物一覧（U-02）。自分が職責または ACL で関与する作品だけを返す。全件購読はしない。
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
      if (
        text &&
        !`${work.title} ${work.legacyId ?? ""} ${work.category} ${work.purpose}`
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
      picked.push({ work, latest, accepting });
    }
    // 制作者の表示名（一覧で「担当別」に並べたとき、誰の制作物か分かるように）
    const users = await resolveUsers(
      ctx.db,
      picked.flatMap((p) => p.work.creatorIds),
    );
    // 制作物ごとの FB（相談）の数と未読（一覧から制作物の FB へ直接入れるように）
    const fb = await summarizeFeedbackActivity(
      app,
      principal,
      picked.map((p) => p.work.id),
    );
    const out = picked.map(({ work, latest, accepting }) => ({
      ...summarize(
        work,
        latest,
        accepting,
        work.creatorIds.map((id) => users.get(id)?.name ?? "（不明なユーザー）"),
      ),
      fb: fb.get(work.id) ?? { threads: 0, unread: 0 },
    }));
    return out.sort(
      (a, b) =>
        (a.acceptingDeadlineAt ?? Infinity) - (b.acceptingDeadlineAt ?? Infinity) ||
        a.title.localeCompare(b.title, "ja"),
    );
  },
});

/**
 * 自分が関わる制作物（職責または有効な ACL）。閲覧可否はドメインで最終判定する（取消直後の整合）。
 * 一覧とダッシュボードで共用。
 */
export async function listMyWorks(db: DatabaseReader, principal: Principal): Promise<Work[]> {
  const app = createReadContext(db);
  const ids = new Set<string>();
  for (const r of await db
    .query("workRoles")
    .withIndex("by_user", (q) => q.eq("userId", principal.userId))
    .collect())
    ids.add(r.workId);
  for (const g of await db
    .query("workPermissions")
    .withIndex("by_principal", (q) =>
      q.eq("principalType", "user").eq("principalId", principal.userId),
    )
    .collect()) {
    if (g.revokedAt === undefined) ids.add(g.workId);
  }
  const out: Work[] = [];
  for (const id of ids) {
    const work = await app.works.findById(id);
    if (!work) continue;
    const grants = await app.acl.listByWork(work.id);
    if (canViewWork({ work, grants, principal })) out.push(work);
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
