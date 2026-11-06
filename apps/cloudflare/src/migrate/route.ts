import { Hono } from "hono";
import { verifyServiceSecret } from "../serviceAuth.ts";
import type { ImportChunkOptions, ImportChunkResult, ImportRow } from "./import.ts";

/**
 * Durable Object 越しの取り込み口。実装は src/db.ts の MF100Database.importRows（importChunk を 1 トランザクションで包む）。
 * src/app.ts が `.route("/", importApp({ store: () => deps.db(), secret }))` で組み込む。
 */
export interface ImportStore {
  importRows(rows: ImportRow[], options: ImportChunkOptions): Promise<ImportChunkResult>;
}

export interface ImportDeps {
  store(): ImportStore;
  /** wrangler secret の MF100_CLEANUP_SECRET。未設定・短いなら常に 404（口があることも教えない） */
  secret(name: "MF100_CLEANUP_SECRET"): string | undefined;
}

/**
 * POST /internal/import — scripts/migrate/import-to-worker.mjs が Convex の export を分けて送る。
 * body: `{ rows: [{ table, id?, doc }], begin?: boolean, finish?: boolean, expected?: { [table]: 行数 } }`
 * 認証は Authorization: Bearer MF100_CLEANUP_SECRET（Convex の http.ts の清掃と同じ約束。serviceAuth.ts）。
 * 返すのは取り込んだ表ごとの件数と、finish のときの確認（verify）。
 *
 * ponytail: 取り込みが済んだら、この口は app.ts から外す（本番に残さない）。秘密を発行し直すだけでも塞がる。
 */
export function importApp(deps: ImportDeps) {
  return new Hono().post("/internal/import", async (c) => {
    if (
      !verifyServiceSecret(c.req.raw, "MF100_CLEANUP_SECRET", deps.secret("MF100_CLEANUP_SECRET"))
    )
      return c.body(null, 404);
    let body: {
      rows?: unknown;
      begin?: unknown;
      finish?: unknown;
      expected?: unknown;
    } | null;
    try {
      body = await c.req.json();
    } catch {
      return c.body(null, 400);
    }
    if (!body || !Array.isArray(body.rows)) return c.json({ code: "invalid_body" }, 400);
    const expected =
      typeof body.expected === "object" && body.expected !== null && !Array.isArray(body.expected)
        ? (body.expected as Record<string, number>)
        : undefined;
    const result = await deps.store().importRows(body.rows as ImportRow[], {
      begin: body.begin === true,
      finish: body.finish === true,
      ...(expected ? { expected } : {}),
    });
    return c.json(result, 200, { "Cache-Control": "no-store" });
  });
}
