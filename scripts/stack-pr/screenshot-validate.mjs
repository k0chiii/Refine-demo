#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const root = process.argv[2] ?? "docs/stack-pr-screenshots";
const minBytes = 30 * 1024;
const SIGNIN_MD5 = "ac741f735c6593b5cbdc397deb4a8004";
/** 空 detail シェル（md5 先頭一致。監査で検出したプレースホルダ） */
const EMPTY_DETAIL_MD5_PREFIX = "0df562f4";
const digests = new Map();
const errors = [];

function beforeAfterPairs(dir) {
  const b = join(dir, "before-desktop.png");
  const a = join(dir, "after-desktop.png");
  try {
    if (!statSync(b).isFile() || !statSync(a).isFile()) return;
  } catch {
    return;
  }
  const hb = createHash("md5").update(readFileSync(b)).digest("hex");
  const ha = createHash("md5").update(readFileSync(a)).digest("hex");
  if (hb === ha) errors.push(`${a}: before/after identical md5 (${hb}) vs ${b}`);
}

function walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      beforeAfterPairs(p);
      walk(p);
    } else if (name.endsWith(".png")) check(p);
  }
}

function samePrPair(a, b) {
  const da = a.slice(0, a.lastIndexOf("/"));
  const db = b.slice(0, b.lastIndexOf("/"));
  if (da !== db) return false;
  const ba = a.split("/").pop() ?? "";
  const bb = b.split("/").pop() ?? "";
  return (
    (ba.includes("before") && bb.includes("after")) ||
    (ba.includes("after") && bb.includes("before"))
  );
}

function check(path) {
  const buf = readFileSync(path);
  if (buf.length < minBytes) errors.push(`${path}: size ${buf.length} < ${minBytes}`);
  const md5 = createHash("md5").update(buf).digest("hex");
  if (md5 === SIGNIN_MD5) errors.push(`${path}: sign-in screen md5`);
  if (md5.startsWith(EMPTY_DETAIL_MD5_PREFIX)) errors.push(`${path}: empty detail shell md5`);
  const prev = digests.get(md5);
  if (prev && !samePrPair(prev, path)) errors.push(`${path}: duplicate md5 of ${prev}`);
  else if (!prev) digests.set(md5, path);
}

walk(root);
if (errors.length) {
  console.error(errors.join("\n"));
  process.exit(1);
}
console.log(`OK: ${digests.size} PNG(s), all >= ${minBytes} bytes, unique md5`);
