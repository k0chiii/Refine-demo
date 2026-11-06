import {
  canChangeCreators,
  changeWorkLifecycle,
  createWork,
  importWorks,
  loadAuthorizedWork,
  updateWork,
} from "@mf100/application";
import {
  approvalProgressOf,
  canRegisterWorks,
  currentDeclarations,
  isAccepting,
  isAllowed,
  isGrantActive,
  mayAssignReviewers,
  normalizePersonKey,
  revisionLabel,
  revisionThreadStatsFromRevision,
  revisionThreadStatsOf,
  type DirectoryUser,
} from "@mf100/domain";
import { z } from "zod";
import { mutation, query, type FnDef } from "./define.ts";
import { resolveUsers, userDisplayName } from "./users.ts";
import { listMinePageOf, listMyWorks, summarizeWorkList } from "./workList.ts";
import {
  object,
  vId,
  vLifecycleTarget,
  vWorkGenre,
  vMediaType,
  vRegisteredPlanInfoPatch,
  vWorkMetadataFields,
  vWorkMetadataPatch,
} from "./validators.ts";

// apps/convex/convex/works.ts の写し。Convex の関数名と鍵を揃える（parity.mjs が突き合わせる）

const workPatch = {
  /** Notion の制作物 DB に揃えた項目（null で消す。docs/NOTION_ALIGNMENT.md） */
  ...vWorkMetadataPatch,
  registeredPlanInfo: vRegisteredPlanInfoPatch,
  title: z.string().optional(),
  purpose: z.string().optional(),
  category: z.string().optional(),
  mediaType: vMediaType.optional(),
  /** 納期（null で消す） */
  deadlineAt: z.number().nullable().optional(),
  /** ■仕上がり日（null で消す） */
  finishAt: z.number().nullable().optional(),
  creatorIds: z.array(z.string()).optional(),
  /** 校了者。approverIds があればそちら（複数可）。approverId だけなら「その 1 人に置き換える」 */
  approverId: z.string().optional(),
  approverIds: z.array(z.string()).optional(),
  /** 校了とみなす人数（1..校了者の数。校了者だけを変えて省略すると、いまの人数を校了者の数に収める） */
  approvalQuorum: z.number().optional(),
  managerIds: z.array(z.string()).optional(),
  /** 制作物 ID（null か空文字で消す） */
  legacyId: z.string().nullable().optional(),
  ownerTeamId: z.string().optional(),
  productionTeamIds: z.array(z.string()).optional(),
  relatedTeamIds: z.array(z.string()).optional(),
  notationCategories: z.array(z.string()).optional(),
  /** SNS のアカウントの割り当て（null で外す） */
  socialProfileId: z.string().nullable().optional(),
};

/** 一覧の絞り込み（listMine と listMinePage で同じ） */
const listArgs = {
  year: z.number().optional(),
  lifecycle: z.enum(["draft", "active", "on_hold", "finalized", "cancelled"]).optional(),
  text: z.string().optional(),
  /** 大ジャンルで絞る（Notion の select） */
  genre: vWorkGenre.optional(),
};

export const works = {
  "works:create": mutation({
    auth: "user",
    args: object({
      title: z.string(),
      purpose: z.string(),
      category: z.string(),
      mediaType: vMediaType,
      year: z.number(),
      legacyId: z.string().optional(),
      ownerTeamId: z.string().optional(),
      productionTeamIds: z.array(z.string()).optional(),
      relatedTeamIds: z.array(z.string()).optional(),
      managerIds: z.array(z.string()).optional(),
      creatorIds: z.array(z.string()),
      /** 校了者。approverIds があればそちら。無ければ approverId の 1 人 */
      approverId: z.string().optional(),
      approverIds: z.array(z.string()).optional(),
      approvalQuorum: z.number().optional(),
      deadlineAt: z.number().optional(),
      finishAt: z.number().optional(),
      notationCategories: z.array(z.string()).optional(),
      reviewerIds: z.array(vId).optional(),
      activate: z.boolean().optional(),
      /** 登録した本人を統括に足すか（既定 true）。画面で統括を選んだときは false（選んだとおりに保存する） */
      addRegistrantAsManager: z.boolean().optional(),
      /** Notion の制作物 DB に揃えた項目 */
      ...vWorkMetadataFields,
    }),
    handler: async (ctx, args) => {
      const work = await createWork(ctx.db, ctx.principal!, args);
      return work.id;
    },
  }),

  /**
   * 制作物の一括登録（CSV）。画面が CSV を解析し、担当者を照合して確認した行だけを送る。
   * 登録は application の importWorks（権限 works:create と approvers:assign・1 件ずつの登録と同じ検証と監査・まとめて 1 トランザクション）
   */
  "works:importBatch": mutation({
    auth: "user",
    args: object({
      rows: z.array(
        object({
          title: z.string(),
          year: z.number(),
          purpose: z.string(),
          category: z.string(),
          mediaType: vMediaType,
          creatorIds: z.array(vId),
          managerIds: z.array(vId),
          approverIds: z.array(vId),
          approvalQuorum: z.number().optional(),
          deadlineAt: z.number().optional(),
          finishAt: z.number().optional(),
          legacyId: z.string().optional(),
          notationCategories: z.array(z.string()),
          /** 主管担当・制作担当・関係担当（teams の ID） */
          ownerTeamId: z.string().optional(),
          productionTeamIds: z.array(z.string()).optional(),
          relatedTeamIds: z.array(z.string()).optional(),
          /** 制作物 DB に揃えた項目（docs/NOTION_ALIGNMENT.md） */
          ...vWorkMetadataFields,
        }),
      ),
      source: z.string().optional(),
    }),
    handler: async (ctx, args) => {
      const works = await importWorks(ctx.db, ctx.principal!, {
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
    },
  }),

  "works:update": mutation({
    auth: "user",
    args: object({
      workId: vId,
      expectedVersion: z.number().optional(),
      patch: object(workPatch),
    }),
    handler: async (ctx, args) => {
      const work = await updateWork(ctx.db, ctx.principal!, args);
      // 登録情報を変えたら、本文との照合をあとで流す（decision 72。本人の権限で）
      if (args.patch.registeredPlanInfo !== undefined)
        ctx.schedule({ kind: "planInfoSync", workId: args.workId, userId: ctx.userId! });
      return work.version;
    },
  }),

  "works:changeLifecycle": mutation({
    auth: "user",
    args: object({ workId: vId, to: vLifecycleTarget, expectedVersion: z.number().optional() }),
    handler: async (ctx, args) => {
      await changeWorkLifecycle(ctx.db, ctx.principal!, args);
      return null;
    },
  }),

  /**
   * 一括登録の担当者の照合に使う利用者（CSV に書かれたメールアドレス・名前に当たる人だけ）。
   * 一度でもサインインした委員（subject を持つ行）が対象。登録の権限（works:create と approvers:assign）がある人だけが引ける
   */
  "works:importDirectory": query({
    auth: "user",
    args: object({ keys: z.array(z.string()) }),
    handler: async (ctx, { keys }): Promise<DirectoryUser[]> => {
      if (!canRegisterWorks(ctx.principal!)) return [];
      const wanted = new Set(keys.slice(0, 2000).map(normalizePersonKey));
      if (wanted.size === 0) return [];
      return ctx.sql
        .exec(
          `SELECT id, json_extract(doc, '$.name') AS name, json_extract(doc, '$.hurigana') AS hurigana, email
           FROM users WHERE subject IS NOT NULL ORDER BY rowid LIMIT 5000`,
        )
        .flatMap((r) => {
          const kanji = typeof r.name === "string" ? r.name : undefined;
          const display = userDisplayName({
            ...(kanji !== undefined ? { name: kanji } : {}),
            ...(typeof r.hurigana === "string" ? { hurigana: r.hurigana } : {}),
          });
          const email = typeof r.email === "string" ? r.email : undefined;
          const hit =
            wanted.has(normalizePersonKey(kanji ?? "")) ||
            wanted.has(normalizePersonKey(display)) ||
            (email !== undefined && wanted.has(normalizePersonKey(email)));
          return hit
            ? [
                {
                  id: r.id as string,
                  name: display,
                  email: email ?? null,
                  ...(kanji ? { otherNames: [kanji] } : {}),
                },
              ]
            : [];
        });
    },
  }),

  /**
   * リンクのプレビュー（OGP）に出す題名。サインインしていない取得（Slack など）に返すので、題名だけ。
   * Convex では internalQuery を http.ts の `/og/work` が引く。ここでは public の関数として直に引ける
   */
  "works:ogSummary": query({
    auth: "public",
    args: object({ workId: z.string() }),
    handler: async (ctx, { workId }): Promise<{ title: string } | null> => {
      const work = await ctx.db.works.findById(workId);
      return work ? { title: work.title } : null;
    },
  }),
  /** 制作物詳細（U-03）。権限のない利用者には作品の存在も返さない（A-01） */
  "works:get": query({
    auth: "user",
    args: object({ workId: z.string() }),
    handler: async (ctx, { workId }) => {
      const principal = ctx.principal!;
      const { work, grants } = await loadAuthorizedWork(ctx.db, principal, workId, "work.view");
      const revisions = (await ctx.db.revisions.listByWork(work.id)).sort((a, b) =>
        a.kind === b.kind ? b.sequence - a.sequence : a.kind === "rough" ? 1 : -1,
      );
      const approvals = await ctx.db.approvals.listByWork(work.id);
      const authz = { work, grants, principal };
      // 校了者の全員と、宣言の進み具合（n 人中 m 人）。古い行（approverId だけ）も同じに読める
      const approvers = approvalProgressOf(work, approvals, revisions);
      const users = resolveUsers(ctx.sql, [
        ...work.creatorIds,
        ...work.managerIds,
        ...(work.stakeholderIds ?? []),
        ...(work.reviewerIds ?? []),
        ...approvers.approverIds,
        ...revisions.map((r) => r.submittedBy),
        ...approvals.map((a) => a.actorId),
      ]);
      const openCounts = new Map<string, number>();
      const openBotCounts = new Map<string, number>();
      const pendingChecks = new Map<string, string[]>();
      // 指摘件数は版の派生フィールドを優先し、無い古い行だけスレッドを読む（Convex と同じ）
      for (const r of revisions) {
        const checks = await ctx.db.checks.listByRevision(r.id);
        pendingChecks.set(
          r.id,
          checks.filter((c) => c.state === "pending").map((c) => c.label),
        );
        const stats =
          revisionThreadStatsFromRevision(r) ??
          revisionThreadStatsOf(await ctx.db.threads.listByRevision(r.id));
        openCounts.set(r.id, stats.unresolved);
        openBotCounts.set(r.id, stats.openBot);
      }
      // 既定で開く版（受付中、無ければ最新の有効な版）の添付の要約。画面がファイルの先取りを 1 回早く始められる（web の EditorPrefetch）
      const openRevision =
        revisions.find(isAccepting) ??
        revisions
          .filter((r) => r.reviewState !== "void")
          .sort((a, b) => b.submittedAt - a.submittedAt)[0] ??
        null;
      const openArtifacts = openRevision
        ? await ctx.db.artifacts.listByRevision(openRevision.id)
        : [];
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
          transferCreators: canChangeCreators(work, principal),
          submit: isAllowed("revision.submit", authz),
          decide: isAllowed("comment.decide", authz),
          comment: isAllowed("comment.post", authz),
          assign: isAllowed("review.assign", authz),
          editReviewers:
            mayAssignReviewers(authz) &&
            work.lifecycle !== "finalized" &&
            work.lifecycle !== "cancelled",
          finalize: isAllowed("work.finalize", authz),
          reopen: isAllowed("work.reopen", authz),
          manageAcl: isAllowed("acl.manage", authz),
          viewAudit: isAllowed("audit.view", authz),
        },
      };
    },
  }),

  /** 制作物一覧（U-02）。自分が見られる制作物を返す（通常の制作物は委員なら誰でも。非公開は関わる人だけ） */
  "works:listMine": query({
    auth: "user",
    args: object(listArgs),
    handler: async (ctx, args) =>
      summarizeWorkList(ctx, ctx.principal!, await listMyWorks(ctx), args),
  }),

  /**
   * 制作物一覧のページ。year / lifecycle は索引で絞り、genre / text はページの後で絞るので、ページは短い・空のことがある
   * （続きは isDone まで continueCursor で読む）。text ありの続きの印は `{ phase, cursor }` の JSON
   */
  "works:listMinePage": query({
    auth: "user",
    args: object({
      paginationOpts: object({
        numItems: z.number(),
        cursor: z.string().nullable(),
        endCursor: z.string().nullable().optional(),
        id: z.number().optional(),
        maximumRowsRead: z.number().optional(),
        maximumBytesRead: z.number().optional(),
      }),
      ...listArgs,
    }),
    handler: async (ctx, args) => listMinePageOf(ctx, ctx.principal!, args),
  }),
} satisfies Record<string, FnDef>;
