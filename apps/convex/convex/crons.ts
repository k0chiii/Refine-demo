import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

/**
 * 期限到来による受付終了（F-08）。表示用の整合のためのジョブであり、
 * 新規指摘の拒否自体は各 mutation 内の時刻比較で保証される（ジョブ遅延に依存しない）。
 */
const crons = cronJobs();
crons.interval("close expired review windows", { minutes: 1 }, internal.revisions.closeExpired, {});
/** 期限 24h 前の未確認校正者へのアプリ内リマインド（F-11）。冪等キーで二重通知なし（A-10）。 */
crons.interval("remind upcoming deadlines", { hours: 1 }, internal.revisions.remindDeadlines, {});
/** 放置アップロードセッションの清掃（D14）。R2 の孤立オブジェクト削除は Hono 側の後続。 */
crons.interval("expire upload sessions", { hours: 1 }, internal.submissions.expireSessions, {});
/** 投稿に付けないまま 24 時間たったフィードバックの添付を放置扱いにする（R2 の削除は上と同じ Hono の清掃）。 */
crons.interval("expire feedback files", { hours: 1 }, internal.feedback.expireFiles, {});
/** コメントに付けないまま 24 時間たった添付を放置扱いにする（R2 の削除は上と同じ Hono の清掃）。 */
crons.interval("expire comment files", { hours: 1 }, internal.commentFiles.expireFiles, {});
export default crons;
