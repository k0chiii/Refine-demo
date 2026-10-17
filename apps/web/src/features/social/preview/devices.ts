/**
 * プレビューで選べる端末（Figma の端末プリセットのように実機の大きさで出す）。
 * 寸法は CSS ピクセル（iOS は pt、Android は dp）。iPhone は Apple の公式ベゼル（Apple Design Resources の
 * Product Bezels、PNG）を縮めて public/devices/ に置き、画面の位置はその PNG の透明な部分を実測した値。
 * ベゼルが配られていない機種（iPhone 16e・SE、Android）は CSS で枠を描く。
 * 画面の大きさの出典: Apple のベゼル PNG（画面の穴 ÷ 3）、Playwright の端末定義（Chrome DevTools と同じ値）。
 */
export type DeviceKind = "iphone" | "android" | "pc";
export type Cutout = "island" | "notch" | "punch" | "home-button" | "none";

export interface DeviceBezel {
  /** 色の英名（ファイル名）と表示名 */
  colors: readonly { id: string; label: string }[];
  /** ベゼル画像の大きさ（pt） */
  w: number;
  h: number;
  /** 画像の中の画面の左上（pt） */
  x: number;
  y: number;
}

export interface DeviceSpec {
  id: string;
  label: string;
  kind: DeviceKind;
  /** 画面の大きさ（CSS ピクセル） */
  w: number;
  h: number;
  /** 上の安全領域（ステータスバー）と下の安全領域（ホームインジケーター・ジェスチャーバー） */
  top: number;
  bottom: number;
  /** 画面の角丸 */
  radius: number;
  cutout: Cutout;
  bezel?: DeviceBezel;
}

const C = (id: string, label: string) => ({ id, label });
const PRO_17 = [
  C("silver", "シルバー"),
  C("cosmic-orange", "コズミックオレンジ"),
  C("deep-blue", "ディープブルー"),
];
const PRO_18 = [
  C("silver", "シルバー"),
  C("black", "ブラック"),
  C("burgundy", "バーガンディ"),
  C("glacier", "グレイシャー"),
];
const PRO_16 = [
  C("black-titanium", "ブラックチタニウム"),
  C("white-titanium", "ホワイトチタニウム"),
  C("natural-titanium", "ナチュラルチタニウム"),
  C("desert-titanium", "デザートチタニウム"),
];
const BASE_16 = [
  C("black", "ブラック"),
  C("white", "ホワイト"),
  C("pink", "ピンク"),
  C("teal", "ティール"),
  C("ultramarine", "ウルトラマリン"),
];
const BEZEL_PRO = { w: 450, h: 920, x: 24, y: 23 };
const BEZEL_PRO_MAX = { w: 490, h: 1000, x: 25, y: 22 };

export const DEVICES: readonly DeviceSpec[] = [
  {
    id: "iphone-18-pro",
    label: "iPhone 18 Pro",
    kind: "iphone",
    w: 402,
    h: 874,
    top: 62,
    bottom: 34,
    radius: 60,
    cutout: "island",
    bezel: { colors: PRO_18, ...BEZEL_PRO },
  },
  {
    id: "iphone-18-pro-max",
    label: "iPhone 18 Pro Max",
    kind: "iphone",
    w: 440,
    h: 956,
    top: 62,
    bottom: 34,
    radius: 60,
    cutout: "island",
    bezel: { colors: PRO_18, ...BEZEL_PRO_MAX },
  },
  {
    id: "iphone-17",
    label: "iPhone 17",
    kind: "iphone",
    w: 402,
    h: 874,
    top: 62,
    bottom: 34,
    radius: 60,
    cutout: "island",
    bezel: {
      colors: [
        C("black", "ブラック"),
        C("white", "ホワイト"),
        C("lavender", "ラベンダー"),
        C("mist-blue", "ミストブルー"),
        C("sage", "セージ"),
      ],
      ...BEZEL_PRO,
    },
  },
  {
    id: "iphone-17-pro",
    label: "iPhone 17 Pro",
    kind: "iphone",
    w: 402,
    h: 874,
    top: 62,
    bottom: 34,
    radius: 60,
    cutout: "island",
    bezel: { colors: PRO_17, ...BEZEL_PRO },
  },
  {
    id: "iphone-17-pro-max",
    label: "iPhone 17 Pro Max",
    kind: "iphone",
    w: 440,
    h: 956,
    top: 62,
    bottom: 34,
    radius: 60,
    cutout: "island",
    bezel: { colors: PRO_17, ...BEZEL_PRO_MAX },
  },
  {
    id: "iphone-air",
    label: "iPhone Air",
    kind: "iphone",
    w: 420,
    h: 912,
    top: 62,
    bottom: 34,
    radius: 60,
    cutout: "island",
    bezel: {
      colors: [
        C("space-black", "スペースブラック"),
        C("cloud-white", "クラウドホワイト"),
        C("light-gold", "ライトゴールド"),
        C("sky-blue", "スカイブルー"),
      ],
      w: 460,
      h: 960,
      x: 20,
      y: 24,
    },
  },
  {
    id: "iphone-16",
    label: "iPhone 16",
    kind: "iphone",
    w: 393,
    h: 852,
    top: 59,
    bottom: 34,
    radius: 55,
    cutout: "island",
    bezel: { colors: BASE_16, w: 453, h: 912, x: 30, y: 30 },
  },
  {
    id: "iphone-16-plus",
    label: "iPhone 16 Plus",
    kind: "iphone",
    w: 430,
    h: 932,
    top: 59,
    bottom: 34,
    radius: 55,
    cutout: "island",
    bezel: { colors: BASE_16, w: 490, h: 990, x: 30, y: 29 },
  },
  {
    id: "iphone-16-pro",
    label: "iPhone 16 Pro",
    kind: "iphone",
    w: 402,
    h: 874,
    top: 62,
    bottom: 34,
    radius: 60,
    cutout: "island",
    bezel: { colors: PRO_16, ...BEZEL_PRO },
  },
  {
    id: "iphone-16-pro-max",
    label: "iPhone 16 Pro Max",
    kind: "iphone",
    w: 440,
    h: 956,
    top: 62,
    bottom: 34,
    radius: 60,
    cutout: "island",
    bezel: { colors: PRO_16, ...BEZEL_PRO_MAX },
  },
  {
    id: "iphone-16e",
    label: "iPhone 16e",
    kind: "iphone",
    w: 390,
    h: 844,
    top: 47,
    bottom: 34,
    radius: 47,
    cutout: "notch",
  },
  {
    id: "iphone-se-3",
    label: "iPhone SE（第 3 世代）",
    kind: "iphone",
    w: 375,
    h: 667,
    top: 20,
    bottom: 0,
    radius: 0,
    cutout: "home-button",
  },
  {
    id: "pixel-10",
    label: "Pixel 10",
    kind: "android",
    w: 360,
    h: 808,
    top: 40,
    bottom: 24,
    radius: 36,
    cutout: "punch",
  },
  {
    id: "pixel-10-pro",
    label: "Pixel 10 Pro",
    kind: "android",
    w: 427,
    h: 952,
    top: 44,
    bottom: 24,
    radius: 40,
    cutout: "punch",
  },
  {
    id: "pixel-10-pro-xl",
    label: "Pixel 10 Pro XL",
    kind: "android",
    w: 448,
    h: 997,
    top: 44,
    bottom: 24,
    radius: 40,
    cutout: "punch",
  },
  {
    id: "galaxy-s24",
    label: "Galaxy S24",
    kind: "android",
    w: 360,
    h: 780,
    top: 36,
    bottom: 24,
    radius: 30,
    cutout: "punch",
  },
  {
    id: "galaxy-z-flip-7",
    label: "Galaxy Z Flip7",
    kind: "android",
    w: 360,
    h: 840,
    top: 36,
    bottom: 24,
    radius: 28,
    cutout: "punch",
  },
  {
    id: "pc",
    label: "PC（ブラウザ）",
    kind: "pc",
    w: 600,
    h: 0,
    top: 0,
    bottom: 0,
    radius: 12,
    cutout: "none",
  },
];

export const DEFAULT_DEVICE = "iphone-17";

export function deviceById(id: string): DeviceSpec {
  return (
    DEVICES.find((d) => d.id === id) ?? (DEVICES.find((d) => d.id === DEFAULT_DEVICE) as DeviceSpec)
  );
}

/** ベゼル画像の URL（色が無効なら最初の色） */
export function bezelUrl(spec: DeviceSpec, color?: string): string | undefined {
  if (!spec.bezel) return undefined;
  const c = spec.bezel.colors.find((x) => x.id === color) ?? spec.bezel.colors[0];
  return c ? `/devices/${spec.id}--${c.id}.webp` : undefined;
}

/** 枠を含めた外形（pt）。ベゼルがない機種は CSS の枠の太さを足す */
export function outerSize(spec: DeviceSpec): { w: number; h: number } {
  if (spec.bezel) return { w: spec.bezel.w, h: spec.bezel.h };
  if (spec.kind === "pc") return { w: spec.w, h: 0 };
  if (spec.cutout === "home-button") return { w: spec.w + 24, h: spec.h + 24 + 120 };
  return { w: spec.w + 24, h: spec.h + 24 };
}
