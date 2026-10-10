import { convexTest, type TestConvex } from "convex-test";
import type { Id } from "../convex/_generated/dataModel";
import schema from "../convex/schema";

/**
 * convex-test ハーネス。convex/ の外に置き、Convex のバンドル対象に vitest 依存を混ぜない。
 * Convex Auth の identity.subject は `${userId}|${sessionId}` なので、users 行を作ってその形で偽装する。
 */
export const modules = import.meta.glob("../convex/**/*.*s");

// http.ts（t.fetch）は auth.ts を読み込むため、モック provider で組み立てられるよう環境を固定する
process.env.NOGIKU_MOCK_ENABLED ??= "true";
process.env.CONVEX_SITE_ORIGIN ??= "http://test.invalid";
process.env.FRONTEND_URL ??= "http://localhost:5173";

export type Harness = TestConvex<typeof schema>;

export function createHarness(): Harness {
  return convexTest(schema, modules);
}

export interface TestUser {
  id: Id<"users">;
  as: ReturnType<Harness["withIdentity"]>;
}

export async function createUser(
  t: Harness,
  name: string,
  opts: { isSystemAdmin?: boolean } = {},
): Promise<TestUser> {
  const id = await t.run(async (ctx) =>
    ctx.db.insert("users", {
      name,
      email: `${name}@example.invalid`,
      nogikuSubject: `sub-${name}`,
      source: "nogiku_mock",
      isSystemAdmin: opts.isSystemAdmin ?? false,
    }),
  );
  return { id, as: t.withIdentity({ subject: `${id}|session-${name}` }) };
}

export const HOUR = 3_600_000;

export async function createCast(t: Harness) {
  const [admin, manager, creator, reviewer, approver, stranger] = await Promise.all([
    createUser(t, "admin", { isSystemAdmin: true }),
    createUser(t, "manager"),
    createUser(t, "creator"),
    createUser(t, "reviewer"),
    createUser(t, "approver"),
    createUser(t, "stranger"),
  ]);
  return { admin, manager, creator, reviewer, approver, stranger };
}
