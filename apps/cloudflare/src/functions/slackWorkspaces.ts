import { addSlackWorkspace, listSlackWorkspaces, removeSlackWorkspace } from "@mf100/application";
import type { SlackWorkspace } from "@mf100/domain";
import { z } from "zod";
import { mutation, query, type FnDef } from "./define.ts";
import { object } from "./validators.ts";

// apps/convex/convex/slackWorkspaces.ts の写し。登録・削除はシステム管理者だけ（use case が確かめ、監査に残す）

export const slackWorkspaces = {
  /** 一覧はサインインしていれば誰でも */
  "slackWorkspaces:list": query({
    auth: "user",
    args: object({}),
    handler: async (ctx): Promise<SlackWorkspace[]> => listSlackWorkspaces(ctx.db, ctx.principal!),
  }),

  /** 名前と team_id（T で始まる。大文字にそろえる）で登録し、登録したものを返す */
  "slackWorkspaces:add": mutation({
    auth: "user",
    args: object({ name: z.string(), teamId: z.string() }),
    handler: async (ctx, args): Promise<SlackWorkspace> =>
      addSlackWorkspace(ctx.db, ctx.principal!, args),
  }),

  /** 削除する（もう無ければ何もしない）。選んでいた人には送らなくなる */
  "slackWorkspaces:remove": mutation({
    auth: "user",
    args: object({ id: z.string() }),
    handler: async (ctx, { id }): Promise<null> => {
      await removeSlackWorkspace(ctx.db, ctx.principal!, id);
      return null;
    },
  }),
} satisfies Record<string, FnDef>;
