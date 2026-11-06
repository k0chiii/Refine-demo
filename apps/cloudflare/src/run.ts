import { DomainError, memberTeamIds, type Principal } from "@mf100/domain";
import type { AppContext } from "@mf100/application";
import type { Identity } from "./identity.ts";
import { usecases, type UsecaseName } from "./registry.ts";

/** ユースケースの結果。DomainError は値で返す（Durable Object の RPC は Error の code・details を運ばない） */
export type RunResult =
  | { ok: true; value: unknown }
  | { ok: false; code: string; details: Record<string, unknown> };

export interface RunDeps {
  /** 初期ブートストラップの管理者（subject）。Convex の MF100_SYSTEM_ADMIN_SUBJECTS と同じ */
  adminSubjects: ReadonlySet<string>;
  /** 本人の行を名簿（users）に置く。ふりがな・組織権限は Nogiku 連携後 */
  upsertUser(identity: Identity): Promise<void>;
}

/**
 * 本人 → ドメインの主体。Convex の lib/principal.ts と同じ組み立て。
 * - orgPermissions は Nogiku Access 連携まで ["*"]（制限なし）
 * - teamIds は所属する局・担当（teams.memberIds）。Convex は購読の再実行を避けて要るときだけ読むが、ここは購読の単位が
 *   テーブルなので毎回読んでよい
 */
export async function principalOf(
  ctx: AppContext,
  identity: Identity,
  deps: RunDeps,
): Promise<Principal> {
  await deps.upsertUser(identity);
  const [groups, teams] = await Promise.all([ctx.groups.list(), ctx.teams.list()]);
  return {
    userId: identity.subject,
    isSystemAdmin: deps.adminSubjects.has(identity.subject),
    groupIds: groups.filter((g) => g.memberIds.includes(identity.subject)).map((g) => g.id),
    orgPermissions: ["*"],
    teamIds: memberTeamIds(teams, identity.subject),
  };
}

/** `POST /u/:name` の本体。ctx は呼び出し側が 1 トランザクションに包む */
export async function runUsecase(
  ctx: AppContext,
  identity: Identity,
  name: UsecaseName,
  args: readonly unknown[],
  deps: RunDeps,
): Promise<RunResult> {
  const fn = usecases[name] as (
    ctx: AppContext,
    principal: Principal,
    ...rest: unknown[]
  ) => Promise<unknown>;
  try {
    const principal = await principalOf(ctx, identity, deps);
    return { ok: true, value: await fn(ctx, principal, ...args) };
  } catch (error) {
    if (error instanceof DomainError)
      return { ok: false, code: error.code, details: error.details };
    throw error;
  }
}

/** DomainError の code → HTTP の状態。Convex は ConvexError で運ぶが、HTTP では状態で分ける */
export function statusOf(code: string): 400 | 401 | 403 | 404 | 409 {
  if (code === "unauthenticated") return 401;
  if (code === "forbidden") return 403;
  if (code.endsWith("_not_found")) return 404;
  if (code.endsWith("_conflict")) return 409;
  return 400;
}
