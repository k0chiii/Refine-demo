#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import {
  SIGNIN_SCREEN_MD5,
  MIN_SCREENSHOT_BYTES,
  PLACEHOLDER_MAX_BYTES,
  validateDomSidecar,
} from "./screenshot-validate.mjs";

const SCENE_BY_FILE = {
  "071": { desktop: "02-works-list" },
  "072": { desktop: "02-works-list" },
  "073": { desktop: "02-works-list" },
  "074": { desktop: "dashboard-manager", mobile: "dashboard-manager-mobile" },
  "075": { desktop: "dashboard-manager", mobile: "dashboard-manager-mobile" },
  "076": { desktop: "08-workspace-comment" },
  "083": { desktop: "dashboard-manager", mobile: "dashboard-manager-mobile" },
  "084": { desktop: "dashboard-approver", mobile: "dashboard-approver-mobile" },
  "085": { desktop: "dashboard-member", mobile: "dashboard-member-mobile" },
  "086": { desktop: "dashboard-detail", mobile: "dashboard-detail-mobile" },
  "087": { desktop: "dashboard-member-tablet" },
  "088": { desktop: "dashboard-manager-dark", mobile: "dashboard-manager-dark-mobile" },
  e089: { desktop: "33-work-form", mobile: "33-work-form" },
  e088: { desktop: "33-work-form" },
  e078: { desktop: "33-work-form", mobile: "33-work-form" },
  e081: { desktop: "33-work-form" },
  e082: { desktop: "02-works-list" },
};

const root = process.env.SCREENSHOT_OUT ?? "/workspace/docs/stack-pr-screenshots";
const ids = process.argv.slice(2);
const allIds =
  ids.length > 0
    ? ids
    : Object.keys(SCENE_BY_FILE);

function md5(f) {
  return createHash("md5").update(fs.readFileSync(f)).digest("hex");
}

function sceneFor(id, name) {
  if (id === "076") {
    return name.startsWith("after-") ? "dashboard-detail" : "076-before-editor";
  }
  const m = SCENE_BY_FILE[id];
  if (!m) return "unknown";
  if (name.includes("mobile")) return m.mobile ?? `${m.desktop}-mobile`;
  return m.desktop;
}

const globalMd5 = new Map();
const rows = [];

for (const id of allIds) {
  const dir = path.join(root, id);
  if (!fs.existsSync(dir)) {
    rows.push({ id, file: "—", size: 0, md5: "—", dom: "—", ok: false, note: "dir missing" });
    continue;
  }
  for (const name of fs.readdirSync(dir).filter((n) => n.endsWith(".png")).sort()) {
    const full = path.join(dir, name);
    const size = fs.statSync(full).size;
    const h = md5(full);
    const sceneKey = sceneFor(id, name);
    let ok = true;
    const notes = [];
    if (size <= PLACEHOLDER_MAX_BYTES) {
      ok = false;
      notes.push("placeholder");
    }
    if (size < MIN_SCREENSHOT_BYTES) {
      ok = false;
      notes.push("<30KB");
    }
    if (h === SIGNIN_SCREEN_MD5) {
      ok = false;
      notes.push("signin-md5");
    }
    const rel = `${id}/${name}`;
    /* 同一 id フォルダ内の before/after 以外の md5 重複のみ禁止 */
    const sameIdDup = rows.filter(
      (r) => r.id === id && r.file.endsWith(".png") && r.md5 === h.slice(0, 12) && r.file !== name,
    );
    if (sameIdDup.length > 0 && !name.startsWith("after-") && !name.startsWith("before-")) {
      ok = false;
      notes.push(`dup-same-id:${sameIdDup[0].file}`);
    }
    const beforePath = path.join(dir, name.replace(/^after-/, "before-").replace(/^before-/, "before-"));
    if (name.startsWith("after-") && fs.existsSync(beforePath) && md5(beforePath) === h) {
      ok = false;
      notes.push("before=after-md5");
    }
    let dom = "no";
    try {
      validateDomSidecar(full, sceneKey);
      dom = "ok";
    } catch (e) {
      ok = false;
      dom = "bad";
      notes.push(String(e.message).slice(0, 60));
    }
    rows.push({ id, file: name, size, md5: h.slice(0, 12), dom, ok, note: notes.join(",") || "pass" });
  }
}

console.log("| id | file | bytes | md5 | dom | ok | note |");
console.log("|---|---|---:|---|---|---|---|");
for (const r of rows) {
  console.log(`| ${r.id} | ${r.file} | ${r.size} | ${r.md5} | ${r.dom} | ${r.ok ? "✅" : "❌"} | ${r.note} |`);
}
if (rows.some((r) => !r.ok)) process.exitCode = 1;
