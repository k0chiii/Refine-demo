#!/usr/bin/env node
// Convex の関数（公開 api.* と内部 internal.*）のうち、Cloudflare の登録表（src/functions）に移したものを数える。
// 標準出力に Markdown の表。手で見る道具で、verify-types には入れない。
//   node scripts/parity.mjs           表を出す
//   node scripts/parity.mjs --check   web / api が使う公開関数に、登録表に無いものがあれば 1 で終わる
//
// 関数の名前の取り方:
// - Convex: api.d.ts の ApiFromModules にあるモジュールを、convex/<module>.ts の `export const x = query|mutation|action|internal*(`
//   から拾う（api.d.ts 自体には関数名が無く、モジュール名だけが載る）。公開か内部かは constructor の名前（internal*）で決まる
// - Cloudflare: src/functions/*.ts の `"<module>:<fn>": query|mutation|action(` を拾う。
//   index.ts を import しない理由: 直接 node で動かすと workspace の .ts（enum や parameter property）を読めず、壊れやすい
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../../..");
const convexDir = path.join(root, "apps/convex/convex");
const functionsDir = path.resolve(here, "../src/functions");

// --- Convex
const apiDts = fs.readFileSync(path.join(convexDir, "_generated/api.d.ts"), "utf8");
const block = /ApiFromModules<\{([\s\S]*?)\}>/.exec(apiDts)?.[1] ?? "";
const modules = [...block.matchAll(/^\s*"?([\w/]+)"?:\s*typeof\s+\w+;/gm)].map((m) => m[1]);
if (modules.length === 0) throw new Error("api.d.ts から ApiFromModules を読めなかった");

const KIND = { query: "query", mutation: "mutation", action: "action" };
const convex = new Map(); // "module:fn" -> { kind, visibility }
for (const module of modules) {
  const file = path.join(convexDir, `${module}.ts`);
  if (!fs.existsSync(file)) continue;
  const src = fs.readFileSync(file, "utf8");
  for (const m of src.matchAll(
    /^export const (\w+) = (internal)?(Query|Mutation|Action|query|mutation|action)\s*[(<]/gm,
  )) {
    const kind = KIND[m[3].toLowerCase()];
    convex.set(`${module}:${m[1]}`, { kind, visibility: m[2] ? "internal" : "public" });
  }
}

// --- Cloudflare
const cloudflare = new Map(); // "module:fn" -> kind
for (const file of fs.readdirSync(functionsDir)) {
  if (!file.endsWith(".ts") || file.endsWith(".test.ts")) continue;
  const src = fs.readFileSync(path.join(functionsDir, file), "utf8");
  for (const m of src.matchAll(/^\s*"([\w/]+:\w+)":\s*(query|mutation|action)\(/gm))
    cloudflare.set(m[1], m[2]);
}

// --- web / api が使う公開関数（api.<module>.<fn>。Convex に在る名前だけを数える: 別物の `api.` を拾わないため）
function* walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === "_generated") continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else if (/\.(ts|tsx|mjs|js)$/.test(entry.name)) yield full;
  }
}
const used = new Map(); // "module:fn" -> 使っているファイル数
for (const dir of ["apps/web/src", "apps/api/src"]) {
  const abs = path.join(root, dir);
  if (!fs.existsSync(abs)) continue;
  for (const file of walk(abs)) {
    const src = fs.readFileSync(file, "utf8");
    const names = new Set();
    for (const m of src.matchAll(/\bapi\.([A-Za-z0-9_]+(?:\.[A-Za-z0-9_]+)*)/g)) {
      const parts = m[1].split(".");
      for (let i = parts.length - 1; i >= 1; i--) {
        const key = `${parts.slice(0, i).join("/")}:${parts[i]}`;
        const hit = convex.get(key);
        if (hit?.visibility === "public") {
          names.add(key);
          break;
        }
      }
    }
    for (const key of names) used.set(key, (used.get(key) ?? 0) + 1);
  }
}

// --- 出力
const rows = [...convex].sort(([a], [b]) => a.localeCompare(b));
const publicRows = rows.filter(([, v]) => v.visibility === "public");
const internalRows = rows.filter(([, v]) => v.visibility === "internal");
const have = (rs) => rs.filter(([k]) => cloudflare.has(k)).length;
const usedRows = publicRows.filter(([k]) => used.has(k));
const missingUsed = usedRows.filter(([k]) => !cloudflare.has(k));
const count = (rs, kind) => rs.filter(([, v]) => v.kind === kind).length;
const orphans = [...cloudflare.keys()]
  .filter((k) => !convex.has(k))
  .sort((a, b) => a.localeCompare(b));

const out = [];
out.push("# Convex ↔ Cloudflare の関数の対応", "");
out.push(
  `- 公開（api.*）: ${publicRows.length}（query ${count(publicRows, "query")} / mutation ${count(publicRows, "mutation")} / action ${count(publicRows, "action")}）のうち Cloudflare にある ${have(publicRows)}`,
);
out.push(
  `- 内部（internal.*）: ${internalRows.length} のうち Cloudflare にある ${have(internalRows)}`,
);
out.push(
  `- web / api が使う公開関数: ${usedRows.length} のうち Cloudflare にある ${usedRows.length - missingUsed.length}（無い ${missingUsed.length}）`,
);
out.push(
  `- 登録表: ${cloudflare.size}（Convex に無い名前 ${orphans.length}${orphans.length ? `: ${orphans.join(", ")}` : ""}）`,
  "",
);
out.push("| 名前 | Convex の種類 | 公開/内部 | web・api が使う | Cloudflare にある |");
out.push("| --- | --- | --- | --- | --- |");
for (const [key, v] of rows)
  out.push(
    `| \`${key}\` | ${v.kind} | ${v.visibility} | ${used.get(key) ? `${used.get(key)} ファイル` : "-"} | ${cloudflare.has(key) ? "あり" : "-"} |`,
  );
console.log(out.join("\n"));

if (process.argv.includes("--check") && missingUsed.length > 0) {
  console.error(`\nweb / api が使う公開関数のうち ${missingUsed.length} 本が Cloudflare に無い`);
  process.exit(1);
}
