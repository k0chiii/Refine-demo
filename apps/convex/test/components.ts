import prosemirrorSync from "@convex-dev/prosemirror-sync/test";
import workflow from "@convex-dev/workflow/test";
import aggregate from "@convex-dev/aggregate/test";
import presence from "@convex-dev/presence/test";
import migrations from "@convex-dev/migrations/test";
import rateLimiter from "@convex-dev/rate-limiter/test";
import workpool from "@convex-dev/workpool/test";
import type { TestConvex } from "convex-test";
import type schema from "../convex/schema";

/** Same components in integration tests and the browser demo. */
export function registerComponents(t: TestConvex<typeof schema>) {
  prosemirrorSync.register(t);
  workflow.register(t);
  aggregate.register(t);
  presence.register(t);
  migrations.register(t);
  rateLimiter.register(t);
  workpool.register(t, "pushPool");
}
