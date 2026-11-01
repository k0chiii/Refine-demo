#!/usr/bin/env node
import fs from "node:fs";
import { captureShots } from "./capture.ts";

const reqPath = process.argv[2];
if (!reqPath) {
  console.error("usage: capture-cli.ts <request.json>");
  process.exit(1);
}
const { shots, prefix, opts } = JSON.parse(fs.readFileSync(reqPath, "utf8"));
await captureShots(shots, prefix, opts ?? {});
