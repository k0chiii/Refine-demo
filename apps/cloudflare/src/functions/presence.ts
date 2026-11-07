import { loadWorkAllowing } from "@mf100/application";
import { personDisplayName } from "@mf100/domain";
import { z } from "zod";
import { beat, leave, PRESENCE_INTERVAL, sweepPresence, viewersOf } from "../collab/store.ts";
import { randomId } from "../sqlite/docs.ts";
import { mutation, query, type FnCtx, type FnDef } from "./define.ts";
import { object } from "./validators.ts";

// apps/convex/convex/presence.ts の写し（@convex-dev/presence の部品を SQLite の表に置き換えたもの）

/** 心拍の間隔（ms）。Convex の INTERVAL と同じ。画面（WorkPresence）も同じ間隔で送る */
export const INTERVAL = PRESENCE_INTERVAL;

/** 閲覧は職責・ACL に依らず許される（105A）。見られない = 制作物が無い = forbidden */
const mayView = (ctx: FnCtx, workId: string) =>
  loadWorkAllowing(ctx.db, ctx.principal!, workId, "work.view");

export const presence = {
  "presence:heartbeat": mutation({
    auth: "user",
    args: object({
      workId: z.string(),
      // 画面が crypto.randomUUID() で作るタブの ID。形を縛るのは、合言葉の表に変な値を溜めないため
      sessionId: z.string().regex(/^[0-9a-f-]{36}$/),
    }),
    handler: async (ctx, { workId, sessionId }) => {
      await mayView(ctx, workId);
      const now = ctx.now();
      // 切れたタブの掃除は心拍のついで（専用の cron は持たない）
      sweepPresence(ctx.sql, now);
      const sessionToken = beat(
        ctx.sql,
        { roomId: workId, userId: ctx.userId!, sessionId },
        now,
        () => randomId("presenceSessions"),
      );
      return { sessionToken };
    },
  }),

  /** 部屋（= 制作物）の ID で引く。別の部屋の合言葉は受け取らない */
  "presence:list": query({
    auth: "user",
    args: object({ workId: z.string() }),
    handler: async (ctx, { workId }) => {
      await mayView(ctx, workId);
      const ids = viewersOf(ctx.sql, workId, ctx.now(), 100);
      const names = new Map<string, { name: string; email: string | null }>();
      if (ids.length > 0)
        for (const row of ctx.sql.exec(
          "SELECT id, doc FROM users WHERE id IN (SELECT value FROM json_each(?))",
          JSON.stringify(ids),
        )) {
          const doc = JSON.parse(row.doc as string) as {
            name?: string;
            hurigana?: string;
            email?: string;
          };
          names.set(row.id as string, {
            name: personDisplayName({ name: doc.name, hurigana: doc.hurigana }),
            email: doc.email ?? null,
          });
        }
      return ids.map((userId) => ({
        userId,
        // 名簿に居ない・名前が空の人は Convex の summarizeUser と同じ呼び名にする
        name: names.get(userId)?.name || "（不明なユーザー）",
        /** アバターの種（設定が無い人はメールから決まる絵） */
        email: names.get(userId)?.email ?? null,
        isMe: userId === ctx.userId,
      }));
    },
  }),

  /**
   * そのタブ 1 つだけを切る合言葉（heartbeat が返した sessionToken）。Convex も認証を要らない（タブを閉じる・サインアウトの
   * 直後でも切れるように）ので、public。合言葉は推測できない乱数で、切れるのはそのタブだけ
   */
  "presence:disconnect": mutation({
    auth: "public",
    args: object({ sessionToken: z.string() }),
    handler: async (ctx, { sessionToken }) => {
      leave(ctx.sql, sessionToken);
      return null;
    },
  }),
} satisfies Record<string, FnDef>;
