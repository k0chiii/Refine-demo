/**
 * Android のステータスバーに出す通知のバッジ（public/icons/badge-96.png）を作る。手元で一度だけ実行し、出力をコミットする。
 *   node scripts/badge-icon.mjs
 * 図柄はアプリのアイコン（edit_document）に合わせた書類。Android は透明度だけを見て単色に塗るので、
 * 白（#fff）の透明度つき PNG（色の面は白、抜く部分は透明）にする。外部のライブラリは使わず PNG を自前で書き出す。
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";

const SIZE = 96;
const SUPERSAMPLE = 4;

/** 角丸の長方形の内側か */
function inRoundRect(x, y, x0, y0, x1, y1, r) {
  if (x < x0 || x > x1 || y < y0 || y > y1) return false;
  const cx = x < x0 + r ? x0 + r : x > x1 - r ? x1 - r : x;
  const cy = y < y0 + r ? y0 + r : y > y1 - r ? y1 - r : y;
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
}

/** 塗る点か: 書類の形（右上の角を折った形）から、本文の行を抜く */
function filled(x, y) {
  if (!inRoundRect(x, y, 18, 8, 78, 88, 8)) return false;
  if (x - y > 48) return false; // 右上の折り返し
  for (const [ly, lx1] of [
    [36, 66],
    [50, 66],
    [64, 56],
  ])
    if (inRoundRect(x, y, 30, ly - 3, lx1, ly + 3, 3)) return false;
  return true;
}

const rows = [];
for (let py = 0; py < SIZE; py++) {
  const row = Buffer.alloc(1 + SIZE * 4); // 先頭 1 バイトは行のフィルター（0 = なし）
  for (let px = 0; px < SIZE; px++) {
    let hit = 0;
    for (let sy = 0; sy < SUPERSAMPLE; sy++)
      for (let sx = 0; sx < SUPERSAMPLE; sx++)
        if (filled(px + (sx + 0.5) / SUPERSAMPLE, py + (sy + 0.5) / SUPERSAMPLE)) hit++;
    const o = 1 + px * 4;
    row[o] = row[o + 1] = row[o + 2] = 255;
    row[o + 3] = Math.round((hit / (SUPERSAMPLE * SUPERSAMPLE)) * 255);
  }
  rows.push(row);
}

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(SIZE, 0);
ihdr.writeUInt32BE(SIZE, 4);
ihdr[8] = 8; // ビット深度
ihdr[9] = 6; // RGBA
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk("IHDR", ihdr),
  chunk("IDAT", deflateSync(Buffer.concat(rows), { level: 9 })),
  chunk("IEND", Buffer.alloc(0)),
]);

const out = resolve(dirname(fileURLToPath(import.meta.url)), "../public/icons/badge-96.png");
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, png);
console.log("wrote", out, `${png.length} bytes`);
