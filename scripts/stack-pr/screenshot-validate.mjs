#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const root = process.argv[2] ?? "docs/stack-pr-screenshots";
const minBytes = 30 * 1024;
const digests = new Map();
const errors = [];

function walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else if (name.endsWith(".png")) check(p);
  }
}

function check(path) {
  const buf = readFileSync(path);
  if (buf.length < minBytes) errors.push(`${path}: size ${buf.length} < ${minBytes}`);
  const md5 = createHash("md5").update(buf).digest("hex");
  const prev = digests.get(md5);
  if (prev) errors.push(`${path}: duplicate md5 of ${prev}`);
  else digests.set(md5, path);
}

walk(root);
if (errors.length) {
  console.error(errors.join("\n"));
  process.exit(1);
}
console.log(`OK: ${digests.size} PNG(s), all >= ${minBytes} bytes, unique md5`);
