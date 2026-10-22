/**
 * サウンドトラックを合成して e2e/out/motion/soundtrack.wav に書く（外部の音源に依存しない。48 kHz / 16 bit / stereo）。
 * 曲: ニ長調、100 BPM。パッド（倍音を足した正弦波の和、ゆっくりした開閉）＋ 8 分のアルペジオ ＋ 低い鼓動 ＋ 小さなハット。
 * 効果音: 章の切り替えの風（ノイズの帯域を掃く）、ピン・チップの「ぽ」、校了のチャイム。時刻は composition.html の章に合わせてある。
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const OUT = process.env.OUT_DIR ?? resolve(here, "../out/motion");
mkdirSync(OUT, { recursive: true });

const SR = 48000;
const DUR = 95;
/** 章の開始時刻（composition.html の C と同じ） */
const C = {
  s1: 7.4,
  s2: 16.2,
  s3: 30.7,
  s4: 43.9,
  s5: 54.0,
  s6: 66.6,
  s7: 78.0,
  s8: 87.4,
  end: 95,
};
const N = SR * DUR;
const L = new Float64Array(N),
  R = new Float64Array(N);
const TAU = Math.PI * 2;
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const nt = (midi) => 440 * Math.pow(2, (midi - 69) / 12);

/* ---------- 章と出来事（composition.html と同じ） ---------- */
const CHAPTERS = [C.s1, C.s2, C.s3, C.s4, C.s5, C.s6, C.s7, C.s8];
const STAMP = C.s6 + 5.9; // 校了の判子
const POPS = [
  // S1 行き先のカード・レール
  [C.s1 + 1.35, 72],
  [C.s1 + 1.53, 74],
  [C.s1 + 1.71, 76],
  [C.s1 + 5.4, 79],
  // S2 コールアウト
  [C.s2 + 2.3, 74],
  [C.s2 + 5.1, 74],
  [C.s2 + 8.0, 76],
  [C.s2 + 11.2, 77],
  [C.s2 + 12.4, 79],
  // S3 ピン・コールアウト
  [C.s3 + 1.4, 74],
  [C.s3 + 2.7, 74],
  [C.s3 + 7.3, 81],
  [C.s3 + 11.0, 76],
  // S4 チップ
  [C.s4 + 1.2, 74],
  [C.s4 + 1.55, 71],
  [C.s4 + 1.9, 77],
  // S5 版
  [C.s5 + 0.7, 72],
  [C.s5 + 2.9, 76],
  [C.s5 + 3.3, 79],
  [C.s5 + 5.0, 74],
  [C.s5 + 8.4, 74],
  [C.s5 + 9.2, 76],
  [C.s5 + 11.2, 78],
  // S6 ガード
  [C.s6 + 2.55, 76],
  [C.s6 + 3.65, 78],
  [C.s6 + 4.75, 81],
  // S7 スマホ・ベル
  [C.s7 + 0.3, 72],
  [C.s7 + 0.55, 74],
  [C.s7 + 4.2, 83],
  // S8 流れ
  ...[0, 1, 2, 3, 4, 5].map((i) => [C.s8 + 1.2 + i * 0.16, 74 + i * 2]),
];

/* ---------- 和音 ---------- */
const BPM = 100,
  BEAT = 60 / BPM,
  BAR = BEAT * 4;
// D(add9) / A(add9) / Bm7 / Gmaj7 を 2 小節ずつ。MIDI
const CHORDS = [
  [50, 57, 66, 69, 76], // D3 A3 F#4 A4 E5
  [45, 52, 61, 64, 71], // A2 E3 C#4 E4 B4
  [47, 54, 62, 66, 69], // B2 F#3 D4 F#4 A4
  [43, 50, 59, 62, 66], // G2 D3 B3 D4 F#4
];
const chordAt = (t) => CHORDS[Math.floor(t / (BAR * 2)) % CHORDS.length];
const chordStart = (t) => Math.floor(t / (BAR * 2)) * BAR * 2;

/* ---------- 曲の起伏（0..1） ---------- */
const energy = (t) => {
  if (t < C.s1) return 0.25 + 0.2 * (t / C.s1);
  if (t < C.s2) return 0.55;
  if (t < C.s6) return 0.7 + 0.15 * ((t - C.s2) / (C.s6 - C.s2));
  if (t < C.s7) return 0.95;
  if (t < C.s8) return 0.8;
  return 0.6 - 0.5 * clamp((t - C.s8 - 1.5) / 5, 0, 1);
};

/* ---------- パッド ---------- */
{
  // 和音ごとに、開始 1.4 s 前から立ち上がり、終わり 1.6 s かけて消える（重なる）
  const slots = Math.ceil(DUR / (BAR * 2)) + 1;
  for (let k = 0; k < slots; k++) {
    const t0 = k * BAR * 2,
      t1 = t0 + BAR * 2;
    const chord = CHORDS[k % CHORDS.length];
    const a0 = Math.max(0, t0 - 1.4),
      a1 = Math.min(DUR, t1 + 1.6);
    const i0 = Math.floor(a0 * SR),
      i1 = Math.floor(a1 * SR);
    const phases = chord.map((m, j) => [nt(m), 0.37 + j * 0.9, 1 + (j % 2 ? 0.0028 : -0.0024)]);
    for (let i = i0; i < i1; i++) {
      const t = i / SR;
      const env =
        Math.min(1, Math.max(0, (t - a0) / 1.6)) * Math.min(1, Math.max(0, (a1 - t) / 1.6));
      if (env <= 0) continue;
      let sL = 0,
        sR = 0;
      for (const [f, ph, det] of phases) {
        const w = TAU * t;
        const a =
          Math.sin(w * f + ph) + 0.32 * Math.sin(w * f * 2 + ph * 1.3) + 0.09 * Math.sin(w * f * 3);
        const b =
          Math.sin(w * f * det + ph * 0.7) +
          0.32 * Math.sin(w * f * det * 2) +
          0.09 * Math.sin(w * f * det * 3);
        sL += a * 0.6 + b * 0.4;
        sR += a * 0.4 + b * 0.6;
      }
      const tremolo = 1 - 0.08 * (0.5 + 0.5 * Math.sin(TAU * 0.33 * t));
      const g = 0.052 * env * tremolo * (0.55 + 0.45 * energy(t));
      L[i] += sL * g;
      R[i] += sR * g;
    }
  }
}

/* ---------- アルペジオ（8 分） ---------- */
{
  const start = C.s1,
    end = C.s8 + 2.2;
  const pattern = [0, 2, 4, 3, 1, 4, 2, 3]; // 和音の何番目か
  for (let t = start; t < end; t += BEAT / 2) {
    const k = Math.round((t - start) / (BEAT / 2));
    const chord = chordAt(t);
    const m = chord[pattern[k % pattern.length]] + 12;
    const f = nt(m);
    const vel = (k % 4 === 0 ? 1 : 0.72) * (0.35 + 0.65 * energy(t));
    const i0 = Math.floor(t * SR),
      len = Math.floor(0.55 * SR);
    const pan = 0.5 + 0.35 * Math.sin(k * 0.9);
    for (let i = 0; i < len && i0 + i < N; i++) {
      const x = i / SR;
      const env = Math.min(1, x / 0.006) * Math.exp(-x / 0.19);
      const s =
        (Math.sin(TAU * f * x) +
          0.45 * Math.sin(TAU * f * 2 * x) * Math.exp(-x / 0.07) +
          0.12 * Math.sin(TAU * f * 3 * x) * Math.exp(-x / 0.04)) *
        env *
        0.11 *
        vel;
      L[i0 + i] += s * (1 - pan);
      R[i0 + i] += s * pan;
    }
  }
}

/* ---------- 低い鼓動（1 拍目と 3 拍目） ---------- */
{
  for (let t = C.s2; t < C.s8 + 1.5; t += BEAT * 2) {
    const i0 = Math.floor(t * SR),
      len = Math.floor(0.42 * SR);
    const g = 0.22 * (0.4 + 0.6 * energy(t));
    for (let i = 0; i < len && i0 + i < N; i++) {
      const x = i / SR;
      const f = 50 + 40 * Math.exp(-x / 0.035);
      const env = Math.min(1, x / 0.004) * Math.exp(-x / 0.14);
      const s = Math.sin(TAU * f * x) * env * g;
      L[i0 + i] += s;
      R[i0 + i] += s;
    }
  }
}

/* ---------- ハット（裏拍の小さなノイズ） ---------- */
{
  let seed = 7;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff) * 2 - 1;
  for (let t = C.s3 + BEAT / 2; t < C.s8 - 0.5; t += BEAT) {
    const i0 = Math.floor(t * SR),
      len = Math.floor(0.09 * SR);
    const g = 0.035 * energy(t);
    let prev = 0;
    for (let i = 0; i < len && i0 + i < N; i++) {
      const x = i / SR;
      const n = rnd();
      const hp = n - prev;
      prev = n; // 1 次のハイパス
      const s = hp * Math.exp(-x / 0.025) * g;
      L[i0 + i] += s * 0.8;
      R[i0 + i] += s * 1.0;
    }
  }
}

/* ---------- 効果音 ---------- */
let seed = 99;
const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff) * 2 - 1;
const whoosh = (t, dir = 1) => {
  const i0 = Math.floor((t - 0.32) * SR),
    len = Math.floor(0.75 * SR);
  // 2 次の帯域通過（状態変数フィルタ）で中心を 300 → 2400 Hz へ掃く
  let low = 0,
    band = 0;
  for (let i = 0; i < len && i0 + i < N; i++) {
    if (i0 + i < 0) continue;
    const x = i / len;
    const fc = 300 * Math.pow(8, x);
    const F = 2 * Math.sin((Math.PI * fc) / SR),
      Q = 0.9;
    const inp = rnd();
    low += F * band;
    const high = inp - low - Q * band;
    band += F * high;
    const env = Math.pow(Math.sin(Math.PI * x), 2.2);
    const s = band * env * 0.16;
    const pan = dir > 0 ? x : 1 - x;
    L[i0 + i] += s * (1 - pan * 0.7);
    R[i0 + i] += s * (0.3 + pan * 0.7);
  }
};
const pop = (t, midi, g = 0.16) => {
  const i0 = Math.floor(t * SR),
    len = Math.floor(0.14 * SR);
  const f0 = nt(midi);
  for (let i = 0; i < len && i0 + i < N; i++) {
    const x = i / SR;
    const f = f0 * (1 + 0.6 * Math.exp(-x / 0.012));
    const env = Math.min(1, x / 0.002) * Math.exp(-x / 0.035);
    const s = Math.sin(TAU * f * x) * env * g;
    L[i0 + i] += s;
    R[i0 + i] += s;
  }
};
const chime = (t) => {
  // D5 F#5 A5 D6 を少しずつずらして
  [
    [74, 0],
    [78, 0.06],
    [81, 0.12],
    [86, 0.2],
  ].forEach(([m, d]) => {
    const i0 = Math.floor((t + d) * SR),
      len = Math.floor(2.4 * SR),
      f = nt(m);
    for (let i = 0; i < len && i0 + i < N; i++) {
      const x = i / SR;
      const env = Math.min(1, x / 0.01) * Math.exp(-x / 0.7);
      const s =
        (Math.sin(TAU * f * x) + 0.2 * Math.sin(TAU * f * 2.01 * x) * Math.exp(-x / 0.3)) *
        env *
        0.12;
      L[i0 + i] += s * 0.9;
      R[i0 + i] += s * 1.0;
    }
  });
};
CHAPTERS.forEach((c, i) => whoosh(c, i % 2 ? -1 : 1));
whoosh(C.s1 - 0.7, 1);
POPS.forEach(([t, m]) => pop(t, m));
chime(STAMP);
// 最後の一音（D の長三和音をそっと）
chime(C.s8 + 2.2);

/* ---------- マスター ---------- */
{
  // 全体のフェード
  for (let i = 0; i < N; i++) {
    const t = i / SR;
    const fade = Math.min(1, t / 0.8) * Math.min(1, Math.max(0, (DUR - 0.2 - t) / 2.6));
    L[i] *= fade;
    R[i] *= fade;
  }
  // ソフトクリップとピーク正規化（-1 dBFS）
  let peak = 0;
  for (let i = 0; i < N; i++) {
    L[i] = Math.tanh(L[i] * 1.2);
    R[i] = Math.tanh(R[i] * 1.2);
    peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]));
  }
  const g = Math.pow(10, -1 / 20) / (peak || 1);
  const buf = Buffer.alloc(44 + N * 4);
  buf.write("RIFF", 0);
  buf.writeUInt32LE(36 + N * 4, 4);
  buf.write("WAVE", 8);
  buf.write("fmt ", 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(2, 22);
  buf.writeUInt32LE(SR, 24);
  buf.writeUInt32LE(SR * 4, 28);
  buf.writeUInt16LE(4, 32);
  buf.writeUInt16LE(16, 34);
  buf.write("data", 36);
  buf.writeUInt32LE(N * 4, 40);
  for (let i = 0; i < N; i++) {
    buf.writeInt16LE(Math.round(clamp(L[i] * g, -1, 1) * 32767), 44 + i * 4);
    buf.writeInt16LE(Math.round(clamp(R[i] * g, -1, 1) * 32767), 46 + i * 4);
  }
  const path = resolve(OUT, "soundtrack.wav");
  writeFileSync(path, buf);
  console.log(
    "saved",
    path,
    `(${DUR}s, peak ${(20 * Math.log10(peak)).toFixed(1)} dB before normalise)`,
  );
}
