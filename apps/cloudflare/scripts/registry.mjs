#!/usr/bin/env node
// application の usecases/*.ts から `(ctx: AppContext, principal: Principal, ...)` の形の export を集めて
// src/registry.ts を書く。手で足し忘れないための道具。`node scripts/registry.mjs --check` は差分があれば 1 で終わる
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const usecasesDir = path.resolve(here, "../../../packages/application/src/usecases");
const indexFile = path.resolve(here, "../../../packages/application/src/index.ts");
const out = path.resolve(here, "../src/registry.ts");

const exported = new Set(
  [
    ...fs
      .readFileSync(indexFile, "utf8")
      .matchAll(/export \{ ([^}]+) \} from "\.\/usecases\/(\w+)\.ts"/g),
  ].flatMap((m) => m[1].split(",").map((s) => s.trim())),
);
const starExported = new Set(
  [...fs.readFileSync(indexFile, "utf8").matchAll(/export \* from "\.\/usecases\/(\w+)\.ts"/g)].map(
    (m) => m[1],
  ),
);

// Convex では internalMutation（apps/api が実体を検証してから、サービス認証で呼ぶ）。利用者の認証だけで呼べる口には出さない
const SERVICE_ONLY = new Set([
  "beginItemUpload",
  "resumeItemUpload",
  "completeItemUpload",
  "failItemUpload",
  "beginCommentFileUpload",
  "completeCommentFileUpload",
  "failCommentFileUpload",
  "beginCommentThumbUpload",
  "completeCommentThumbUpload",
]);

const names = [];
for (const file of fs.readdirSync(usecasesDir).sort()) {
  if (!file.endsWith(".ts") || file.endsWith(".test.ts")) continue;
  const module = file.replace(/\.ts$/, "");
  const src = fs.readFileSync(path.join(usecasesDir, file), "utf8");
  for (const m of src.matchAll(
    /^export (?:async )?function (\w+)\(\s*ctx: AppContext,\s*_?principal: Principal/gm,
  )) {
    if (starExported.has(module) || exported.has(m[1])) names.push(m[1]);
  }
}
names.sort();
const pub = names.filter((n) => !SERVICE_ONLY.has(n));
const service = names.filter((n) => SERVICE_ONLY.has(n));

const text = `// このファイルは scripts/registry.mjs が書く。手で編集しない
import {
${names.map((n) => `  ${n},`).join("\n")}
} from "@mf100/application";

/** 利用者の認証で呼べるユースケース（引数が (ctx, principal, ...) のもの）。cron の仕事（ctx だけ）は含めない */
export const usecases = {
${pub.map((n) => `  ${n},`).join("\n")}
} as const;

/** apps/api（実体の検証）からサービス認証で呼ぶもの。Convex の internalMutation に当たる。公開の口（/u/:name）には出さない */
export const serviceUsecases = {
${service.map((n) => `  ${n},`).join("\n")}
} as const;

export type UsecaseName = keyof typeof usecases;

export function isUsecaseName(name: string): name is UsecaseName {
  return Object.hasOwn(usecases, name);
}
`;

if (process.argv.includes("--check")) {
  const current = fs.existsSync(out) ? fs.readFileSync(out, "utf8") : "";
  if (current !== text) {
    console.error("src/registry.ts is stale. Run: node scripts/registry.mjs");
    process.exit(1);
  }
} else {
  fs.writeFileSync(out, text);
  console.log(`${names.length} usecases -> ${path.relative(process.cwd(), out)}`);
}
