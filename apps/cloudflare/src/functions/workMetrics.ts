import { object } from "./validators.ts";
import { z } from "zod";
import { query, type FnDef } from "./define.ts";

// apps/convex/convex/workMetrics.ts の写し

/** 並びは Convex と同じ（画面はこの順で出す） */
const LIFECYCLES = ["draft", "active", "on_hold", "finalized", "cancelled"] as const;

export const workMetrics = {
  /**
   * 年ごとの制作物の数（状態別）。Convex は集計の部品（aggregate）を引くが、ここは手元の SQLite を数えるだけ。
   * 集計の移行中を知らせる ready は常に true（移行が無い）。サインインしていれば誰でも、全件の数が見える（Convex と同じ）
   */
  "workMetrics:counts": query({
    auth: "user",
    args: object({ year: z.number() }),
    handler: async (ctx, { year }) => {
      const rows = ctx.sql.exec(
        "SELECT json_extract(doc, '$.lifecycle') AS lifecycle, count(*) AS n FROM works WHERE json_extract(doc, '$.year') = ? GROUP BY lifecycle",
        year,
      );
      const n = new Map(rows.map((r) => [r.lifecycle as string, Number(r.n)]));
      return {
        ready: true,
        counts: LIFECYCLES.map((lifecycle) => ({ lifecycle, count: n.get(lifecycle) ?? 0 })),
      };
    },
  }),
} satisfies Record<string, FnDef>;
