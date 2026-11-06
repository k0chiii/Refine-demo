#!/usr/bin/env node
// export-convex.mjs が作った JSONL を、Worker の POST /internal/import へ分けて送る。
//
//   SITE_URL=https://<worker のホスト> MF100_IMPORT_SECRET=... \
//     node scripts/migrate/import-to-worker.mjs snapshot.jsonl [--chunk 1000] [--dry-run]
//
// - 1 回 1000 行（--chunk）か約 4 MB のどちらか先に届いた所で区切る。最初の塊に begin、最後の塊に finish を付ける
//   （finish のときに派生表を作り直し、確認 = verify を返す）
// - 何度流しても同じ結果（Worker 側が upsert。keyless の表は begin で空にしてから入れる）
// - `<jsonl>.manifest.json` があれば、その行数を expected として送り、取り込み先の行数と突き合わせる
// - verify に問題が 1 件でもあれば 1 で終わる。先頭の問題を表示する
// - **本番の Worker に向けるのは、人が承認してから**。まず wrangler dev か Preview で通しで流して確かめる
// - --dry-run は送らずに、塊の数と大きさだけを表示する
//
// ponytail: 失敗した塊の再送は人が全体をやり直す（冪等なので安全）。塊ごとの再試行は持たない。

import fs from "node:fs";

const file = process.argv[2];
function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i < 0 ? fallback : process.argv[i + 1];
}
const chunkRows = Number(arg("chunk", "1000"));
const CHUNK_BYTES = 4 * 1024 * 1024;
const dryRun = process.argv.includes("--dry-run");

const site = process.env.SITE_URL?.replace(/\/$/, "");
const secret = process.env.MF100_IMPORT_SECRET;
if (!file || (!dryRun && (!site || !secret))) {
  console.error(
    "usage: SITE_URL=... MF100_IMPORT_SECRET=... import-to-worker.mjs <snapshot.jsonl> [--chunk 1000] [--dry-run]",
  );
  process.exit(2);
}

const lines = fs
  .readFileSync(file, "utf8")
  .split("\n")
  .filter((l) => l !== "");

// 行の並びを保ったまま塊に区切る（同じ表の追加順 = rowid が崩れないよう、並べ替えない）
const chunks = [];
let current = [];
let bytes = 0;
for (const line of lines) {
  if (current.length >= chunkRows || (bytes + line.length > CHUNK_BYTES && current.length > 0)) {
    chunks.push(current);
    current = [];
    bytes = 0;
  }
  current.push(line);
  bytes += line.length;
}
chunks.push(current); // 行が 0 でも begin + finish の 1 通は送る

const manifestPath = `${file}.manifest.json`;
const expected = fs.existsSync(manifestPath)
  ? JSON.parse(fs.readFileSync(manifestPath, "utf8")).counts
  : undefined;

console.log(`${lines.length} 行 → ${chunks.length} 回`);
if (dryRun) process.exit(0);

let last;
for (const [i, chunk] of chunks.entries()) {
  const finish = i === chunks.length - 1;
  const res = await fetch(`${site}/internal/import`, {
    method: "POST",
    headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" },
    // 行は JSON のまま束ねる（parse し直さない）
    body: `{"rows":[${chunk.join(",")}],"begin":${i === 0},"finish":${finish}${
      finish && expected ? `,"expected":${JSON.stringify(expected)}` : ""
    }}`,
  });
  if (!res.ok) {
    console.error(
      `塊 ${i + 1}/${chunks.length} が ${res.status} で失敗: ${(await res.text()).slice(0, 500)}`,
    );
    process.exit(1);
  }
  last = await res.json();
  console.log(`塊 ${i + 1}/${chunks.length}: ${chunk.length} 行`);
  for (const [why, s] of Object.entries(last.skipped ?? {}))
    console.log(`  取り込まない ${why}: ${s.count} 行（例 ${s.examples.join(", ")}）`);
}

const verify = last?.verify;
console.log("取り込み先の行数:");
for (const [table, n] of Object.entries(verify?.tables ?? {}))
  if (n > 0) console.log(`  ${table}: ${n}`);
if (!verify || verify.problemCount > 0) {
  console.error(
    `問題 ${verify?.problemCount ?? "?"} 件（先頭 ${verify?.problems?.length ?? 0} 件）:`,
  );
  for (const p of verify?.problems ?? [])
    console.error(`  [${p.check}] ${p.table} ${p.id} ${p.detail}`);
  process.exit(1);
}
console.log("問題なし");
