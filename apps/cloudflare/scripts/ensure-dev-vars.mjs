#!/usr/bin/env node
// 手元の `.dev.vars`（gitignore 済み）に JWT の秘密鍵が無ければ作って足す。pnpm dev の前に走る
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const file = path.resolve(here, "../.dev.vars");
const current = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
if (!/^AUTH_PRIVATE_KEY_JWK=/m.test(current)) {
  const jwk = execFileSync(process.execPath, [path.join(here, "auth-keygen.mjs")], {
    encoding: "utf8",
  }).trim();
  fs.writeFileSync(
    file,
    `${current}${current && !current.endsWith("\n") ? "\n" : ""}AUTH_PRIVATE_KEY_JWK=${jwk}\n`,
  );
  console.log(".dev.vars に AUTH_PRIVATE_KEY_JWK を足した");
}
