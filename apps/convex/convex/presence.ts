import { Presence } from "@convex-dev/presence";
import { loadAuthorizedWork } from "@mf100/application";
import { v } from "convex/values";
import { components } from "./_generated/api";
import { mutation, query } from "./_generated/server";
import { createReadContext } from "./lib/adapters.ts";
import { requireUser } from "./lib/principal.ts";
import { resolveUsers } from "./lib/users.ts";

const presence = new Presence(components.presence);
/**
 * 心拍の間隔（ms）。画面側（features/presence/WorkPresence）も同じ間隔で送る。部品はこの 2.5 倍、心拍が無ければ切れたとみなす。
 * 15 秒 → 30 秒（2026-10-25）: 心拍は毎回 認証＋制作物の読み込みを伴う mutation で、閲覧中の人数の表示にそこまでの鮮度は要らない。
 * 閉じたタブはその場で disconnect を送るので、遅れが出るのは切断・クラッシュのときだけ（最長 75 秒）
 */
export const INTERVAL = 30_000;

export const heartbeat = mutation({
  args: { workId: v.string(), sessionId: v.string() },
  handler: async (ctx, { workId, sessionId }) => {
    const { principal } = await requireUser(ctx);
    await loadAuthorizedWork(createReadContext(ctx.db), principal, workId, "work.view");
    if (!/^[0-9a-f-]{36}$/.test(sessionId)) throw new Error("invalid_session");
    const { sessionToken } = await presence.heartbeat(
      ctx,
      workId,
      principal.userId,
      `${principal.userId}:${sessionId}`,
      INTERVAL,
    );
    return { sessionToken };
  },
});

/** Query by authorized work ID, never accept a capability for a different room. */
export const list = query({
  args: { workId: v.string() },
  handler: async (ctx, { workId }) => {
    const { principal } = await requireUser(ctx);
    await loadAuthorizedWork(createReadContext(ctx.db), principal, workId, "work.view");
    const online = await presence.listRoom(ctx, workId, true, 100);
    const users = await resolveUsers(
      ctx.db,
      online.map((user) => user.userId),
    );
    return online.map((user) => ({
      userId: user.userId,
      name: users.get(user.userId)?.name ?? "委員",
      isMe: user.userId === principal.userId,
    }));
  },
});

/** A random, component-issued session capability can only disconnect that single tab. */
export const disconnect = mutation({
  args: { sessionToken: v.string() },
  handler: async (ctx, { sessionToken }) => presence.disconnect(ctx, sessionToken),
});
