import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

/**
 * 期限到来による受付終了（F-08）。表示用の整合のためのジョブであり、
 * 新規指摘の拒否自体は各 mutation 内の時刻比較で保証される（ジョブ遅延に依存しない）。
 */
const crons = cronJobs();
crons.interval("close expired review windows", { minutes: 1 }, internal.revisions.closeExpired, {});
export default crons;
