#!/usr/bin/env node
import sharp from "sharp";

const [left, right, out] = process.argv.slice(2);
if (!left || !right || !out) {
  console.error("usage: stitch-horizontal.ts <left.png> <right.png> <out.png>");
  process.exit(2);
}
const lm = await sharp(left).metadata();
const rm = await sharp(right).metadata();
const w = (lm.width ?? 0) + (rm.width ?? 0);
const h = Math.max(lm.height ?? 0, rm.height ?? 0);
await sharp({
  create: {
    width: w,
    height: h,
    channels: 4,
    background: { r: 245, g: 245, b: 245, alpha: 1 },
  },
})
  .composite([
    { input: left, left: 0, top: 0 },
    { input: right, left: lm.width ?? 0, top: 0 },
  ])
  .png()
  .toFile(out);
console.log(`stitched ${out} (${w}x${h})`);
