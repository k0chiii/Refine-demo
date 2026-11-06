import { createWork, updateWork } from "@mf100/application";
import { z } from "zod";
import { mutation, query, type FnDef } from "./define.ts";
import {
  object,
  vId,
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

  "works:update": mutation({
    auth: "user",
    args: object({
      workId: vId,
      expectedVersion: z.number().optional(),
      patch: object(workPatch),
    }),
    handler: async (ctx, args) => {
      const work = await updateWork(ctx.db, ctx.principal!, args);
      // ponytail: registeredPlanInfo を変えたときの planInfo.sync（scheduler.runAfter）は、alarm の単位でまとめて移す
      return work.version;
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
} satisfies Record<string, FnDef>;
