import { Workpool } from "@convex-dev/workpool";
import { components } from "../_generated/api";

export const pushPool = new Workpool(components.pushPool, {
  maxParallelism: 8,
  retryActionsByDefault: true,
  defaultRetryBehavior: { maxAttempts: 4, initialBackoffMs: 1000, base: 2 },
});
