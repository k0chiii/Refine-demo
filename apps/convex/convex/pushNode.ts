"use node";

import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import { deliverNotification } from "./deliveryNode.ts";

/** 旧（deliveryNode.deliver に替えた）。替える前に workpool に積んだ仕事がこの名前を指すので、1 回のデプロイの間残す */
export const deliver = internalAction({
  args: { notificationId: v.string() },
  handler: (ctx, { notificationId }): Promise<number> => deliverNotification(ctx, notificationId),
});
