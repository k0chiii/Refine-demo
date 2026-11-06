import { describe, expect, it } from "vite-plus/test";
import { createAuthStore } from "./auth/store.ts";
import { createConvexWorld } from "./testing/convexWorld.mjs";
import {
  type Allowed,
  type Diff,
  diffValues,
  IdNames,
  normalize,
  splitAllowed,
  table,
} from "./testing/differential/compare.ts";
import {
  ACTORS,
  type Actor,
  type CallStep,
  SCENARIO,
  START,
  type Step,
} from "./testing/differential/scenario.ts";
import { app, fakeDb, post, UPLOAD_SECRET } from "./testing/http.ts";

// 差分テスト: 同じ手順の表（testing/differential/scenario.ts）を、Convex（convex-test）と Cloudflare（Node の偽 DO）の
// 両方に流し、戻りを突き合わせる。Convex の関数が本物の仕様。違いは Cloudflare 側を直し、直さない差だけ ALLOWED に理由つきで置く。

/** 直さない・直せない差。pattern は `呼び出し名.パス`（`*` は何でも）。当たらなくなった許可はテストが赤くなる */
const ALLOWED: readonly Allowed[] = [
  {
    pattern: "works:get.work.*Version",
    reason:
      "aggregateVersion・rolesVersion・searchVersion は Convex が派生表（集計・職責・検索）の同期を数える内部の印。Cloudflare は同じトランザクションで作り直すので持たず、画面も読まない",
  },
  {
    pattern: "admin:auditLog.*.*.*Version",
    reason: "監査の before / after に入る制作物の行の、上と同じ内部の印",
  },
  {
    pattern: "admin:auditLog.*.id",
    reason:
      "監査の行の _id。Convex は ID、Cloudflare は行の連番（audit 表は ID を持たない。画面は key にしか使わない）",
  },
  {
    pattern: "works:listMinePage.continueCursor",
    reason: "ページ送りのカーソルは、どちらの実装でも不透明な文字列（中身を比べても意味がない）",
  },
  {
    pattern: "works:listMinePage.pageStatus",
    reason:
      "Convex の paginate が付ける null の印（SplitRecommended の通知用）。Cloudflare は分割を勧めないので持たない。usePaginatedQuery は無くても動く",
  },
  {
    pattern: "works:listMinePage.splitCursor",
    reason: "同上（pageStatus と対）",
  },
];

type Outcome = { ok: true; value: unknown } | { ok: false; code: string };

/** 片側の世界。実行器はこれだけを知っていればよい（手順の解釈は両側で共通） */
interface World {
  createUser(actor: Actor): Promise<string>;
  call(by: Actor | null, step: CallStep, args: unknown): Promise<Outcome>;
  tick(ms: number): void;
  close(): void;
}

const email = (actor: Actor) => `${actor}@example.invalid`;

function convexWorld(): World {
  const world = createConvexWorld(START);
  const ids = new Map<Actor, string>();
  return {
    createUser: async (actor) => {
      const id = await world.createUser(actor, email(actor), actor === "admin");
      ids.set(actor, id);
      return id;
    },
    call: (by, step, args) =>
      world.call(by ? ids.get(by)! : null, step.kind, step.call, args, step.service),
    tick: (ms) => world.setNow(Date.now() + ms),
    close: () => world.close(),
  };
}

function cloudflareWorld(): World {
  const db = fakeDb(undefined, { NOGIKU_MOCK_ENABLED: "true" });
  db.clock.current = START;
  const a = app(db);
  const subject = (actor: Actor) => actor;
  return {
    // users 行は本番のサインイン（auth の store）と同じ道で作る: Convex の createUser と同じ source・管理者の印が入る
    createUser: (actor) =>
      createAuthStore(db.sql).upsertUserFromProfile(
        { sub: subject(actor), name: actor, email: email(actor) },
        { source: "nogiku_mock", admin: actor === "admin" },
      ),
    call: async (by, step, args) => {
      const res = await post(
        a,
        step.call,
        args,
        by ? subject(by) : null,
        step.service ? { "X-MF100-Service-Key": UPLOAD_SECRET } : {},
      );
      const body = (await res.json()) as { value?: unknown; code?: string };
      return res.ok
        ? { ok: true, value: body.value ?? null }
        : { ok: false, code: body.code ?? `http_${res.status}` };
    },
    tick: (ms) => {
      db.clock.current += ms;
    },
    close: () => {},
  };
}

/** args の { $ref: "名前.パス" } を、前の手順の save した戻りから埋める */
function resolveRefs(value: unknown, saved: Map<string, unknown>): unknown {
  if (Array.isArray(value)) return value.map((v) => resolveRefs(v, saved));
  if (value && typeof value === "object") {
    const keys = Object.keys(value);
    if (keys.length === 1 && keys[0] === "$ref") {
      const [head, ...rest] = String((value as { $ref: string }).$ref).split(".");
      let cur: unknown = saved.get(head!);
      for (const key of rest) cur = (cur as Record<string, unknown> | undefined)?.[key];
      if (cur === undefined) throw new Error(`参照 ${(value as { $ref: string }).$ref} が空`);
      return cur;
    }
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, resolveRefs(v, saved)]));
  }
  return value;
}

interface Played {
  step: number;
  by: string;
  call: string;
  /** 正規化済みの戻り（失敗は { error: code }） */
  result: unknown;
}

/** 手順の表を 1 つの世界に流し、各手順の戻りを正規化して並べる */
async function play(world: World, side: "convex" | "cloudflare", steps: readonly Step[]) {
  const names = new IdNames();
  const saved = new Map<string, unknown>();
  for (const actor of ACTORS) {
    const id = await world.createUser(actor);
    saved.set(actor, id);
    names.know(id, `$${actor}`);
  }
  const played: Played[] = [];
  for (const [i, step] of steps.entries()) {
    if ("tick" in step) {
      world.tick(step.tick);
      continue;
    }
    const outcome = await world.call(step.by, step, resolveRefs(step.args, saved));
    if (step.save) {
      if (!outcome.ok) throw new Error(`#${i} ${step.call}: ${side} が失敗 ${outcome.code}`);
      saved.set(step.save, outcome.value);
      names.learn(outcome.value, step.save);
    }
    played.push({
      step: i,
      by: step.by ?? "(未サインイン)",
      call: step.call,
      result: normalize(outcome.ok ? outcome.value : { error: outcome.code }, names),
    });
  }
  return played;
}

describe("差分テスト: 同じ操作の列を Convex と Cloudflare に流す", () => {
  it("読み取りモデルの戻りが同じ形・同じ値", async () => {
    const convex = convexWorld();
    const cloudflare = cloudflareWorld();
    let a: Played[], b: Played[];
    try {
      a = await play(convex, "convex", SCENARIO);
      b = await play(cloudflare, "cloudflare", SCENARIO);
    } finally {
      convex.close();
    }

    const diffs: Diff[] = [];
    expect(b.length).toBe(a.length);
    for (const [i, x] of a.entries()) {
      const y = b[i]!;
      diffValues(x.result, y.result, "", (path, c, f) =>
        diffs.push({ step: x.step, by: x.by, call: x.call, path, convex: c, cloudflare: f }),
      );
    }

    const { unexpected, stale } = splitAllowed(diffs, ALLOWED);
    expect(
      unexpected.length === 0 ? "" : `\n${unexpected.length} 件の差\n${table(unexpected)}`,
    ).toBe("");
    expect(stale, "当たらなくなった許可は消す").toEqual([]);
  });

  it("手順の表が、画面の主な読み取りを全部流している（表を縮めて証拠が薄まるのを防ぐ）", () => {
    const queried = new Set(
      SCENARIO.flatMap((s) => ("call" in s && s.kind === "query" ? [s.call] : [])),
    );
    const required = [
      "works:get",
      "works:listMine",
      "works:listMinePage",
      "revisions:get",
      "reviews:myQueue",
      "dashboard:check",
      "dashboard:make",
      "dashboard:works",
      "dashboard:checkBadge",
      "comments:events",
      "notifications:list",
      "notifications:unreadCount",
      "me:me",
      "approvals:confirmationStatus",
      "home:submitTargets",
      "acl:list",
      "notation:ruleBook",
      "documents:get",
      "users:byIds",
    ];
    expect(required.filter((name) => !queried.has(name))).toEqual([]);
  });
});
