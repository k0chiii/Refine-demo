import { Workpool } from "@convex-dev/workpool";
import { components } from "../_generated/api";

/** 外への通知（端末・メール・Slack）の workpool。コンポーネントの名前は "pushPool" のまま（変えると積んだ仕事を失う） */
export const deliveryPool = new Workpool(components.pushPool, {
  maxParallelism: 8,
  retryActionsByDefault: true,
  defaultRetryBehavior: { maxAttempts: 4, initialBackoffMs: 1000, base: 2 },
});
