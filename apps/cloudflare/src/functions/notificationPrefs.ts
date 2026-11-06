import { getNotificationSettings, updateNotificationPrefs } from "@mf100/application";
import { z } from "zod";
import { availableChannels } from "./channels.ts";
import { mutation, query, type FnDef } from "./define.ts";
import { object } from "./validators.ts";

// apps/convex/convex/notificationPrefs.ts の写し。自分の設定だけを読み書きする

export const notificationPrefs = {
  /** 自分の設定（無ければ既定: 内容を表示・止めている分類なし・メールと Slack はオフ）と、届け先ごとの状態 */
  "notificationPrefs:get": query({
    auth: "user",
    args: object({}),
    handler: async (ctx) =>
      getNotificationSettings(ctx.db, ctx.principal!, availableChannels(ctx.env)),
  }),

  /**
   * 渡した項目だけを変える。変えたあとの設定を返す。slackWorkspaceId は登録にあるワークスペースの id で、null で外す。
   * slackEmail は Slack で引くアドレスで、null で消す
   */
  "notificationPrefs:update": mutation({
    auth: "user",
    args: object({
      showPreview: z.boolean().optional(),
      mutedCategories: z.array(z.string()).optional(),
      channels: z.array(z.string()).optional(),
      slackWorkspaceId: z.string().nullable().optional(),
      slackEmail: z.string().nullable().optional(),
    }),
    handler: async (ctx, args) => updateNotificationPrefs(ctx.db, ctx.principal!, args),
  }),
} satisfies Record<string, FnDef>;
