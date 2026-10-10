import { DomainError, requireAllowed, type Principal, type Work, type WorkAction, type WorkPermissionGrant } from "@mf100/domain";
import type { AppContext } from "./ports.ts";

export interface LoadedWork {
  work: Work;
  grants: WorkPermissionGrant[];
}

/**
 * 作品の読み出しと認可を 1 箇所に集約する。
 * 権限が無い場合、作品の存在自体を漏らさないよう「見つからない」と同じ扱い（forbidden）で返す（§5.2-10 / A-01）。
 */
export async function loadAuthorizedWork(
  ctx: AppContext,
  principal: Principal,
  workId: string,
  action: WorkAction,
): Promise<LoadedWork> {
  const work = await ctx.works.findById(workId);
  if (!work) throw new DomainError("forbidden", { workId, action });
  const grants = await ctx.acl.listByWork(workId);
  requireAllowed(action, { work, grants, principal });
  return { work, grants };
}

/** 冪等実行。同じ scope+key の再送には保存済み結果を返す（二重版・二重校了・二重通知を防ぐ）。 */
export async function idempotent<T>(ctx: AppContext, scope: string, key: string | undefined, fn: () => Promise<T>): Promise<T> {
  if (key === undefined || key === "") return fn();
  const hit = await ctx.idempotency.get(scope, key);
  if (hit) return hit.result as T;
  const result = await fn();
  await ctx.idempotency.put(scope, key, result);
  return result;
}
