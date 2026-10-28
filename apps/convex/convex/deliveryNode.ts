"use node";

import { v } from "convex/values";
import type { ActionCtx } from "./_generated/server";
import { internalAction } from "./_generated/server";

/*
 * 外への通知を送る（端末・登録メールアドレス・Slack の DM）。Node ランタイムで動かす（Web Push の WebCrypto の ECDH・HKDF を確実に使うため）。
 * 送るたびに計画を読み直す（既読・閲覧権限・設定・宛先の変化を反映。delivery.plan）。内容は計画が描き終えている。
 */

/** 経路ごとの結果の数（ログに出す。deliver が返すのは送れた数） */
export interface DeliveryReport {
  sent: number;
  rejected: number;
  retry: number;
  unavailable: number;
}

/**
 * 通知 1 件の届け先に 1 つずつ送り、決着を記録する。送れた数を返す。
 * 一時的な失敗があれば最後に投げて workpool にやり直させる（決着した届け先は次の計画に入らない）
 */
export async function deliverNotification(ctx: ActionCtx, notificationId: string): Promise<number> {
  void [ctx, notificationId];
  throw new Error("not implemented");
}

export const deliver = internalAction({
  args: { notificationId: v.string() },
  handler: (ctx, { notificationId }): Promise<number> => deliverNotification(ctx, notificationId),
});

/** Slack をオンにしたとき、登録メールアドレスで引き直す（今の状態によらない。やり直さない） */
export const resolveSlack = internalAction({
  args: { userId: v.string() },
  handler: async (): Promise<null> => {
    throw new Error("not implemented");
  },
});
