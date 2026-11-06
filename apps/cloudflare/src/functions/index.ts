import type { FnDef } from "./define.ts";
import { home } from "./home.ts";
import { me } from "./me.ts";
import { notifications } from "./notifications.ts";
import { submissions } from "./submissions.ts";
import { works } from "./works.ts";

/** モジュール名（= apps/convex/convex/<module>.ts と同じ）→ その関数。鍵は `<module>:<function>` */
export const modules = { home, me, notifications, submissions, works };

/** 全関数。`POST /f/:name` の名前引きと、scripts/parity.mjs の突き合わせの正本 */
export const functions: Readonly<Record<string, FnDef>> = Object.assign(
  Object.create(null) as Record<string, FnDef>,
  ...Object.values(modules),
);

export function findFunction(name: string): FnDef | undefined {
  return Object.hasOwn(functions, name) ? functions[name] : undefined;
}
