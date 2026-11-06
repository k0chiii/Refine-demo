// 差分テスト（src/differential.test.ts）の Convex 側。convex-test で本物の関数を Node で動かす。
// .mjs にして convexWorld.d.mts で型を切るのは、apps/convex の型（process.env の型など）を、
// Workers の型で検査しているこの package の tsc に引き込まないため。
import { api, internal } from "@mf100/convex/api";
import { convexTest } from "convex-test";
import { vi } from "vite-plus/test";
import { registerComponents } from "../../../convex/test/components.ts";
import schema from "../../../convex/convex/schema.ts";

const modules = import.meta.glob([
  "../../../convex/convex/**/*.*s",
  "!../../../convex/convex/**/*.test.ts",
]);

/** 関数名 `works:get` から API の参照を引く（internal は service 用） */
function refOf(name, service) {
  const [mod, fn] = name.split(":");
  return (service ? internal : api)[mod][fn];
}

export function createConvexWorld(startAt) {
  // convex-test は構築のとき Date を差し替えるので、時計は先に固定する
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(startAt);
  process.env.NOGIKU_MOCK_ENABLED = "true";
  process.env.CONVEX_SITE_ORIGIN ??= "http://test.invalid";
  process.env.FRONTEND_URL ??= "http://localhost:5173";
  const t = convexTest(schema, modules);
  registerComponents(t);
  return {
    async createUser(name, email, isSystemAdmin) {
      return t.run((ctx) =>
        ctx.db.insert("users", {
          name,
          email,
          nogikuSubject: `sub-${name}`,
          source: "nogiku_mock",
          isSystemAdmin,
        }),
      );
    },
    async call(userId, kind, name, args, service) {
      const as = userId ? t.withIdentity({ subject: `${userId}|session` }) : t;
      try {
        const value = await as[kind](refOf(name, service), args);
        return { ok: true, value: value ?? null };
      } catch (e) {
        const data = e && typeof e === "object" ? e.data : undefined;
        if (data && typeof data === "object" && typeof data.code === "string")
          return { ok: false, code: data.code };
        throw e;
      }
    },
    setNow(ms) {
      vi.setSystemTime(ms);
    },
    close() {
      vi.useRealTimers();
    },
  };
}
