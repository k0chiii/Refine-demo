import { describe, expect, it } from "vite-plus/test";
import { tracked } from "./run.ts";
import { migrate } from "./sqlite/schema.ts";
import { upsertUser } from "./sqlite/users.ts";
import { nodeSql } from "./testing/context.ts";
import { modules } from "./functions/index.ts";

describe("tracked: 書いた表と読んだ表を SQL から拾う", () => {
  const run = (...queries: string[]) => {
    const touched = new Set<string>();
    const reads = new Set<string>();
    const sql = tracked({ exec: () => [] }, touched, reads);
    for (const q of queries) sql.exec(q);
    return { touched: [...touched].sort(), reads: [...reads].sort() };
  };

  it("FROM / JOIN の表を読みとして、INSERT / UPDATE / DELETE の対象を書きとして数える", () => {
    expect(run("SELECT doc FROM works WHERE id = ?")).toEqual({ touched: [], reads: ["works"] });
    expect(run("SELECT a.doc FROM revisions a JOIN artifacts b ON b.revisionId = a.id")).toEqual({
      touched: [],
      reads: ["artifacts", "revisions"],
    });
    expect(run("INSERT OR IGNORE INTO pins (id, doc) VALUES (?, ?)")).toEqual({
      touched: ["pins"],
      reads: [],
    });
    expect(run("UPDATE works SET doc = ? WHERE id = ? RETURNING id")).toEqual({
      touched: ["works"],
      reads: [],
    });
  });

  it("購読者に配らない表（SILENT_TABLES）は、書いても読んでも数えない。在席（presence）は数える", () => {
    expect(
      run(
        "INSERT INTO jobs (id, doc) VALUES (?, ?)",
        "INSERT INTO rateLimits (name, key, value, ts) VALUES (?, ?, ?, ?)",
        "INSERT INTO meta (id, doc) VALUES (?, ?)",
        "SELECT doc FROM jobs WHERE runAt <= ?",
        "INSERT INTO presence (roomId, userId, sessionId, lastSeenAt) VALUES (?, ?, ?, ?)",
      ),
    ).toEqual({ touched: ["presence"], reads: [] });
  });

  it("DELETE FROM の対象は読みではない。json_each は表ではない", () => {
    expect(run("DELETE FROM pins WHERE id = ?")).toEqual({ touched: ["pins"], reads: [] });
    expect(
      run("SELECT id FROM users WHERE id IN (SELECT value FROM json_each(?)) ORDER BY rowid"),
    ).toEqual({ touched: [], reads: ["users"] });
  });
});

describe("upsertUser: subject → users.id", () => {
  it("同じ subject は同じ ID のまま名前だけ重なり、別の subject は別の行になる", () => {
    const sql = nodeSql();
    migrate(sql);
    const a = upsertUser(sql, { subject: "s1", name: "旧" });
    expect(upsertUser(sql, { subject: "s1", email: "a@example.com" })).toBe(a);
    expect(upsertUser(sql, { subject: "s2" })).not.toBe(a);
    expect(sql.exec("SELECT name, email, subject FROM users WHERE id = ?", a)).toEqual([
      { name: "旧", email: "a@example.com", subject: "s1" },
    ]);
  });
});

describe("登録表", () => {
  it("鍵は `<module>:<function>` で、モジュール名はファイル名（Convex のモジュール名）と同じ", () => {
    for (const [module, defs] of Object.entries(modules))
      for (const key of Object.keys(defs)) expect(key.startsWith(`${module}:`)).toBe(true);
  });
});
