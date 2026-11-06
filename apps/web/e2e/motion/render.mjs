/**
 * composition.html を 1 フレームずつ撮って ffmpeg で H.264 の mp4 にする（音は audio.mjs の wav を混ぜる）。
 *   node e2e/motion/render.mjs                  … 全体を e2e/out/motion/mf100-howto.mp4 に
 *   node e2e/motion/render.mjs --stills 3,12.5  … その時刻の静止画を e2e/out/motion/stills/ に（確認用）
 *   node e2e/motion/render.mjs --sheet          … 2 秒ごとの静止画を 1 枚のコンタクトシートに
 *   --fps 30 --from 10 --to 20 --out path.mp4 --crf 18
 * Chromium は CHROMIUM_PATH か PLAYWRIGHT_BROWSERS_PATH で解決する。
 */
import { mkdirSync, existsSync } from "node:fs";
import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromium } from "playwright-core";

const here = dirname(fileURLToPath(import.meta.url));
const OUT = process.env.OUT_DIR ?? resolve(here, "../out/motion");
mkdirSync(OUT, { recursive: true });

const args = process.argv.slice(2);
const opt = (name, dflt) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : dflt;
};
const has = (name) => args.includes(`--${name}`);
const FPS = Number(opt("fps", 60));
const CRF = Number(opt("crf", 17));
const W = 1920,
  H = 1080;

const browser = await chromium.launch(
  process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {},
);
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
page.on("pageerror", (e) => console.error("[pageerror]", e.message));
page.on("console", (m) => {
  if (m.type() === "error") console.error("[console]", m.text());
});
await page.goto(pathToFileURL(resolve(here, "composition.html")).href + "?t=0");
await page.evaluate(() => window.__ready);
const DURATION = await page.evaluate(() => window.__duration);
const from = Number(opt("from", 0)),
  to = Number(opt("to", DURATION));

const seek = (t) => page.evaluate((t) => window.__seek(t), t);
// CDP で直接撮ると playwright の screenshot より速い
const cdp = await page.context().newCDPSession(page);
const grab = async (format = "png", quality) => {
  const { data } = await cdp.send("Page.captureScreenshot", {
    format,
    quality,
    fromSurface: true,
    captureBeyondViewport: false,
  });
  return Buffer.from(data, "base64");
};

if (has("stills")) {
  const dir = resolve(OUT, "stills");
  mkdirSync(dir, { recursive: true });
  for (const s of String(opt("stills", "0")).split(",")) {
    const t = Number(s);
    await seek(t);
    await page.waitForTimeout(30);
    const buf = await grab("png");
    const { writeFileSync } = await import("node:fs");
    const path = resolve(dir, `t${t.toFixed(2).padStart(6, "0")}.png`);
    writeFileSync(path, buf);
    console.log("saved", path);
  }
  await browser.close();
  process.exit(0);
}

if (has("sheet")) {
  // 2 秒ごと（--step）に撮って、ffmpeg の tile で 1 枚に
  const step = Number(opt("step", 2));
  const cols = 6;
  const times = [];
  for (let t = from; t < to; t += step) times.push(t);
  const rows = Math.ceil(times.length / cols);
  const path = resolve(OUT, `sheet-${from}-${to}.png`);
  const ff = spawn(
    "ffmpeg",
    [
      "-y",
      "-loglevel",
      "error",
      "-f",
      "image2pipe",
      "-vcodec",
      "png",
      "-i",
      "-",
      "-vf",
      `scale=480:-1,tile=${cols}x${rows}:padding=4:color=black`,
      "-frames:v",
      "1",
      path,
    ],
    { stdio: ["pipe", "inherit", "inherit"] },
  );
  for (const t of times) {
    await seek(t);
    await page.waitForTimeout(20);
    const buf = await grab("png");
    if (!ff.stdin.write(buf)) await new Promise((r) => ff.stdin.once("drain", r));
  }
  ff.stdin.end();
  await new Promise((r) => ff.on("close", r));
  console.log("saved", path);
  await browser.close();
  process.exit(0);
}

// 本番: 連番を ffmpeg にパイプ
const out = resolve(OUT, opt("out", "mf100-howto.mp4"));
const audio = resolve(OUT, "soundtrack.wav");
const withAudio = existsSync(audio) && !has("mute");
const ffArgs = [
  "-y",
  "-loglevel",
  "error",
  "-f",
  "image2pipe",
  "-vcodec",
  "png",
  "-framerate",
  String(FPS),
  "-i",
  "-",
  ...(withAudio ? ["-ss", String(from), "-i", audio] : []),
  "-c:v",
  "libx264",
  "-preset",
  opt("preset", "slow"),
  "-crf",
  String(CRF),
  "-pix_fmt",
  "yuv420p",
  "-profile:v",
  "high",
  "-level",
  "4.2",
  "-x264-params",
  "keyint=120:min-keyint=60",
  "-color_primaries",
  "bt709",
  "-color_trc",
  "bt709",
  "-colorspace",
  "bt709",
  ...(withAudio ? ["-c:a", "aac", "-b:a", "192k", "-shortest"] : []),
  "-movflags",
  "+faststart",
  out,
];
const ff = spawn("ffmpeg", ffArgs, { stdio: ["pipe", "inherit", "inherit"] });
const total = Math.round((to - from) * FPS);
const t0 = Date.now();
for (let i = 0; i < total; i++) {
  const t = from + i / FPS;
  await seek(t);
  const buf = await grab("png");
  if (!ff.stdin.write(buf)) await new Promise((r) => ff.stdin.once("drain", r));
  if (i % (FPS * 5) === 0) {
    const el = (Date.now() - t0) / 1000;
    const eta = (el / Math.max(1, i)) * (total - i);
    process.stderr.write(
      `\rframe ${i}/${total}  t=${t.toFixed(1)}s  elapsed ${el.toFixed(0)}s  eta ${eta.toFixed(0)}s      \n`,
    );
  }
}
ff.stdin.end();
const code = await new Promise((r) => ff.on("close", r));
await browser.close();
console.log(code === 0 ? `saved ${out}` : `ffmpeg exit ${code}`);
process.exit(code ?? 1);
