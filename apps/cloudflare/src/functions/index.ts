import { acl } from "./acl.ts";
import { admin } from "./admin.ts";
import { approvals } from "./approvals.ts";
import { artifacts } from "./artifacts.ts";
import { checks } from "./checks.ts";
import { collaboration } from "./collaboration.ts";
import { commentFiles } from "./commentFiles.ts";
import { comments } from "./comments.ts";
import { comparisons } from "./comparisons.ts";
import { dashboard } from "./dashboard.ts";
import type { FnDef } from "./define.ts";
import { groups } from "./groups.ts";
import { home } from "./home.ts";
import { me } from "./me.ts";
import { notation } from "./notation.ts";
import { notificationPrefs } from "./notificationPrefs.ts";
import { notifications } from "./notifications.ts";
import { planInfo } from "./planInfo.ts";
import { presence } from "./presence.ts";
import { proofreading } from "./proofreading.ts";
import { push } from "./push.ts";
import { reviews } from "./reviews.ts";
import { revisions } from "./revisions.ts";
import { slackWorkspaces } from "./slackWorkspaces.ts";
import { social } from "./social.ts";
import { submissions } from "./submissions.ts";
import { teams } from "./teams.ts";
import { users } from "./users.ts";
import { workMetrics } from "./workMetrics.ts";
import { works } from "./works.ts";

/** モジュール名（= apps/convex/convex/<module>.ts と同じ）→ その関数。鍵は `<module>:<function>` */
export const modules = {
  acl,
  admin,
  approvals,
  artifacts,
  checks,
  collaboration,
  commentFiles,
  comments,
  comparisons,
  dashboard,
  groups,
  home,
  me,
  notation,
  notificationPrefs,
  notifications,
  planInfo,
  presence,
  proofreading,
  push,
  reviews,
  revisions,
  slackWorkspaces,
  social,
  submissions,
  teams,
  users,
  workMetrics,
  works,
};

/** 全関数。`POST /f/:name` の名前引きと、scripts/parity.mjs の突き合わせの正本 */
export const functions: Readonly<Record<string, FnDef>> = Object.assign(
  Object.create(null) as Record<string, FnDef>,
  ...Object.values(modules),
);

export function findFunction(name: string): FnDef | undefined {
  return Object.hasOwn(functions, name) ? functions[name] : undefined;
}
