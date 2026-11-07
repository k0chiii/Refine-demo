#!/usr/bin/env node
// Convex の export（zip）を、Cloudflare に取り込む 1 本の JSONL（1 行 = { table, id?, doc }）に変える。
// 変換の規則は src/migrate/plan.ts にある（このファイルは読み書きだけ）。Convex にも Cloudflare にも通信しない。
//
//   node scripts/migrate/export-convex.mjs --zip snapshot.zip --out snapshot.jsonl
//   node scripts/migrate/export-convex.mjs --dir ./extracted --out snapshot.jsonl     展開済みの export
//
// 出力: snapshot.jsonl と snapshot.jsonl.manifest.json（表ごとの行数・移さなかった行・捨てた場所。import-to-worker が突き合わせに使う）。
// 対応表に無い場所が export にあれば、何も書かずに 1 で終わる（--allow-unknown で、その場所を捨てて進む）。
//
// ---- zip の取り方（**人が、承認を得てから**自分の端末で。このスクリプトは Convex を呼ばない）
//   cd apps/convex
//   # 本番: 管理者のログインか CONVEX_DEPLOY_KEY（本番の deploy key）で、--prod を付ける
//   CONVEX_DEPLOY_KEY=... npx convex export --path ../cloudflare/snapshot.zip
//   npx convex export --prod --path ../cloudflare/snapshot.zip
//   # 開発・Preview は --prod を付けない。ファイル本体（_storage）は要らないので --include-file-storage は付けない
// zip は表ごとに `<table>/documents.jsonl`（`_id` と `_creationTime` を含む）、component の表は `_components/<名前>/<表>/documents.jsonl`。
// snapshot.zip と snapshot.jsonl には実データが入る。リポジトリに置かない（.gitignore の外なら消す）。
//
// ponytail: component の表の場所（`_components/prosemirrorSync/...`）は Convex のドキュメントからの推定で、本物の export で確かめていない。
//   違っていれば「対応表に無い場所」として止まるので、plan.ts の from を直す。

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const here = path.dirname(fileURLToPath(import.meta.url));
const { convertExport } = await import(path.resolve(here, "../../src/migrate/plan.ts"));

const { values } = parseArgs({
  options: {
    zip: { type: "string" },
    dir: { type: "string" },
    out: { type: "string" },
    "allow-unknown": { type: "boolean" },
  },
});
const { zip, dir: dirArg, out } = values;
if ((!zip && !dirArg) || !out) {
  console.error(
    "usage: export-convex.mjs (--zip <file.zip> | --dir <extracted>) --out <file.jsonl>",
  );
  process.exit(2);
}

// 展開先は新しい空のディレクトリ（zip は外から来る入力。カレントには展開しない）
let root = dirArg;
let tmp;
if (zip) {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "convex-export-"));
  execFileSync("unzip", ["-q", "-o", path.resolve(zip), "-d", tmp]);
  root = tmp;
}

/** root の下の documents.jsonl を全部見つけ、場所（root からの相対ディレクトリ）→ 行 の Map にする */
function readExport(dir) {
  const tables = new Map();
  const walk = (d) => {
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name === "documents.jsonl") {
        const place = path.relative(dir, d).split(path.sep).join("/");
        const docs = fs
          .readFileSync(full, "utf8")
          .split("\n")
          .filter((line) => line.trim() !== "")
          .map((line) => JSON.parse(line));
        tables.set(place, docs);
      }
    }
  };
  walk(dir);
  return tables;
}

try {
  const tables = readExport(root);
  const result = convertExport(tables);
  if (result.unknown.length > 0 && !values["allow-unknown"]) {
    console.error("対応表（src/migrate/plan.ts）に無い場所があります。何も書きません:");
    for (const p of result.unknown) console.error(`  ${p}  (${tables.get(p).length} 行)`);
    process.exit(1);
  }
  fs.writeFileSync(
    out,
    result.rows.map((r) => JSON.stringify(r)).join("\n") + (result.rows.length ? "\n" : ""),
  );
  const manifest = {
    counts: result.counts,
    skipped: result.skipped,
    dropped: result.dropped,
    rebuilt: result.rebuilt,
    unknown: result.unknown,
  };
  fs.writeFileSync(`${out}.manifest.json`, JSON.stringify(manifest, null, 2) + "\n");
  console.log(`${result.rows.length} 行を ${out} に書きました`);
  for (const [table, n] of Object.entries(result.counts)) console.log(`  ${table}: ${n}`);
  for (const [why, s] of Object.entries(result.skipped))
    console.log(`  移さない ${why}: ${s.count} 行（例 ${s.examples.join(", ")}）`);
  for (const [place, n] of Object.entries(result.dropped))
    console.log(`  捨てる ${place}: ${n} 行`);
  for (const place of result.rebuilt) console.log(`  作り直す ${place}`);
} finally {
  if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
}
