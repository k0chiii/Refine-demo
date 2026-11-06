import type { HumationManifest, PartOption } from "@humation/core";
import {
  AVATAR_COLOR_SLOTS,
  AVATAR_PART_SLOTS,
  type AvatarColorSlot,
  type AvatarConfig,
  type AvatarPartSlot,
} from "@mf100/domain";
import { useEffect, useState, type ComponentType } from "react";

/**
 * Humation（アバター）の読み込みと、アセット（manifest）に照らした設定の扱い。
 * - アセット（約 700KB）は初回表示時に遅延読み込みし、UserAvatar と選択画面で共有する
 * - 保存された設定に知らない部品・色の役割があれば捨てる（描画が例外で止まらないように。形の検証は domain）
 * - 部位・部品・色の日本語名と、色の候補（パレット）はここに置く
 * - 選べる部位・色の役割は domain の `AVATAR_PART_SLOTS` / `AVATAR_COLOR_SLOTS`（丸いアイコンに映るものだけ。
 *   Humation の manifest にはボトムス（部位 `bottom`・色 `bottom`）もあるが、アイコンの切り抜きに 1 画素も入らないので出さない。
 *   利用者指示 2026-10-17「アイコンとか、ボトムスとか画面に映らないところの設定はいらないので見直して」）
 */

export type AvatarComponent = ComponentType<{
  assets: HumationManifest;
  seed?: string;
  selections?: Record<string, string>;
  colors?: Record<string, string>;
  background?: string;
  size?: number | string;
  title?: string;
  className?: string;
  style?: Record<string, string>;
}>;

export interface Humation {
  Avatar: AvatarComponent;
  manifest: HumationManifest;
  core: typeof import("@humation/core");
}

let loaded: Humation | null = null;
let loading: Promise<Humation> | null = null;

export function loadHumation(): Promise<Humation> {
  loading ??= Promise.all([
    import("@humation/react"),
    import("@humation/assets-humation-1"),
    import("@humation/core"),
  ]).then(([react, assets, core]) => {
    loaded = {
      Avatar: react.Avatar as unknown as AvatarComponent,
      manifest: assets.humation1,
      core,
    };
    return loaded;
  });
  return loading;
}

/** 読み込み済みなら即、まだなら読み込みが済んだときに返す */
export function useHumation(): Humation | null {
  const [mod, setMod] = useState(loaded);
  useEffect(() => {
    if (mod) return;
    let cancelled = false;
    void loadHumation().then((m) => {
      if (!cancelled) setMod(m);
    });
    return () => {
      cancelled = true;
    };
  }, [mod]);
  return mod;
}

export { AVATAR_COLOR_SLOTS, AVATAR_PART_SLOTS, type AvatarColorSlot, type AvatarPartSlot };

export const isAvatarPartSlot = (slot: string): slot is AvatarPartSlot =>
  (AVATAR_PART_SLOTS as readonly string[]).includes(slot);
export const isAvatarColorSlot = (slot: string): slot is AvatarColorSlot =>
  (AVATAR_COLOR_SLOTS as readonly string[]).includes(slot);

/** 設定の中から、選べる部位・役割で、アセットに実在する部品・色だけを残す（Avatar に渡しても例外にならない形） */
export function sanitizeAvatarConfig(
  { manifest, core }: Humation,
  config: AvatarConfig | null | undefined,
): AvatarConfig | null {
  if (!config) return null;
  const out: AvatarConfig = {};
  if (config.seed) out.seed = config.seed;
  const selections: Partial<Record<AvatarPartSlot, string>> = {};
  for (const [slot, value] of Object.entries(config.selections ?? {})) {
    if (!isAvatarPartSlot(slot) || !value) continue;
    if (!manifest.selectionSlots.some((s) => s.id === slot)) continue;
    try {
      const id = core.resolvePartId(value, manifest, slot);
      const part = manifest.parts.find((p) => p.id === id);
      if (part && part.selectionSlot === slot) selections[slot] = id;
    } catch {
      // 知らない部品（別の版のアセットで選んだものなど）は捨てる
    }
  }
  if (Object.keys(selections).length) out.selections = selections;
  const colors: Partial<Record<AvatarColorSlot, string>> = {};
  for (const [slot, value] of Object.entries(config.colors ?? {})) {
    if (isAvatarColorSlot(slot) && value && /^[0-9A-F]{6}$/.test(value)) colors[slot] = value;
  }
  if (Object.keys(colors).length) out.colors = colors;
  if (config.background && /^[0-9A-F]{6}$/.test(config.background))
    out.background = config.background;
  return Object.keys(out).length ? out : null;
}

/** 部位（selection slot）の表示順と日本語名（domain の AVATAR_PART_SLOTS の順。トップスはえりと肩がアイコンに映る） */
const PART_SLOT_LABELS: Record<AvatarPartSlot, string> = {
  head: "髪型",
  body: "トップス",
  item: "小物",
  glasses: "めがね",
};
export const AVATAR_SLOTS: ReadonlyArray<{ id: AvatarPartSlot; label: string }> =
  AVATAR_PART_SLOTS.map((id) => ({ id, label: PART_SLOT_LABELS[id] }));
export type AvatarSlotId = AvatarPartSlot;

export const AVATAR_COLOR_LABELS: Record<AvatarColorSlot | "background", string> = {
  hair: "髪の色",
  skin: "肌の色",
  clothes: "トップスの色",
  stroke: "線の色",
  background: "背景の色",
};

const PART_LABELS: Record<string, string> = {
  // 髪型
  "fluffy-bob": "ふわふわボブ",
  "round-bob": "丸いボブ",
  short: "ショート",
  "curly-short": "カーリーショート",
  "short-bangs": "前髪ありのショート",
  "side-swept-short": "流し前髪のショート",
  "messy-short": "無造作ショート",
  "wavy-medium": "ウェーブのミディアム",
  "flipped-long": "外ハネのロング",
  lob: "ロブ",
  "long-straight": "ストレートのロング",
  "side-swept-lob": "流し前髪のロブ",
  "blunt-bob": "ぱっつんボブ",
  bun: "お団子",
  "low-side-bun": "低いサイドお団子",
  "low-twin-buns": "低いツインお団子",
  ponytail: "ポニーテール",
  "low-ponytail": "低いポニーテール",
  "low-twin-tails": "低いツインテール",
  braids: "三つ編み",
  "blunt-long": "ぱっつんロング",
  "side-swept-long": "流し前髪のロング",
  "wavy-long": "ウェーブのロング",
  "curly-long": "カーリーロング",
  // トップス
  "cropped-shirt": "クロップドシャツ",
  "tank-top": "タンクトップ",
  "drape-tee": "ドレープT",
  polo: "ポロシャツ",
  tee: "Tシャツ",
  shirt: "シャツ",
  jacket: "ジャケット",
  hoodie: "パーカー",
  // 小物
  none: "なし",
  "crab-headband": "カニのカチューシャ",
  "tuna-sushi": "まぐろのお寿司",
  "shrimp-sushi": "えびのお寿司",
  sprout: "芽",
  beer: "ビール",
  antennae: "触角",
  "bunny-ears": "うさ耳",
  halo: "天使の輪",
  crown: "王冠",
  flower: "花",
  "ice-cream": "アイスクリーム",
  duck: "あひる",
  "santa-hat": "サンタ帽",
  camera: "カメラ",
  "wind-chime": "風鈴",
  "frog-alt": "かえる",
  ramune: "ラムネ",
  takoyaki: "たこ焼き",
  "chocolate-banana": "チョコバナナ",
  yoyo: "ヨーヨー",
  "beach-ball": "ビーチボール",
  sunflower: "ひまわり",
  eggplant: "なす",
  shark: "サメ",
  "fox-mask": "きつねのお面",
  banana: "バナナ",
  watermelon: "スイカ",
  pineapple: "パイナップル",
  "candied-apple": "りんご飴",
  sunglasses: "サングラス",
  goggles: "ゴーグル",
  "tabby-cat": "トラ猫",
  "cream-cat": "クリーム色の猫",
  "ginger-cat": "茶トラ猫",
  "white-cat": "白猫",
  "black-cat": "黒猫",
  "tuxedo-cat": "ハチワレ猫",
  "siamese-cat": "シャム猫",
  "gray-cat": "灰色の猫",
  "tabby-tuxedo-cat": "トラ柄のハチワレ猫",
  "calico-cat": "三毛猫",
  "brown-tabby-cat": "キジトラ猫",
  // めがね
  round: "丸めがね",
  tiny: "小さいめがね",
};

/** 部品の日本語名（辞書に無ければ Humation の名前をそのまま） */
export function partLabel(part: PartOption): string {
  const name = part.name ?? part.id;
  return PART_LABELS[name] ?? name;
}

export interface Swatch {
  hex: string;
  name: string;
}

const NEUTRALS: Swatch[] = [
  { hex: "FFFFFF", name: "白" },
  { hex: "F2F2F2", name: "明るい灰色" },
  { hex: "9E9E9E", name: "灰色" },
  { hex: "424242", name: "濃い灰色" },
  { hex: "000000", name: "黒" },
];
const HUES: Swatch[] = [
  { hex: "C62828", name: "赤" },
  { hex: "EF6C00", name: "オレンジ" },
  { hex: "F9A825", name: "黄" },
  { hex: "2E7D32", name: "緑" },
  { hex: "00897B", name: "青緑" },
  { hex: "1E88E5", name: "青" },
  { hex: "1F3A5F", name: "ネイビー" },
  { hex: "6A1B9A", name: "紫" },
  { hex: "D81B60", name: "ピンク" },
  { hex: "795548", name: "茶" },
  { hex: "D7CCC8", name: "ベージュ" },
];

/** 色の役割ごとの候補（先頭が Humation の既定） */
export const AVATAR_PALETTES: Record<AvatarColorSlot | "background", Swatch[]> = {
  hair: [
    { hex: "000000", name: "黒" },
    { hex: "2B1B12", name: "黒に近い茶" },
    { hex: "4A3728", name: "ダークブラウン" },
    { hex: "6B4A2B", name: "茶" },
    { hex: "8B5A2B", name: "明るい茶" },
    { hex: "A0522D", name: "赤茶" },
    { hex: "C68642", name: "キャラメル" },
    { hex: "D9A066", name: "ハニーブラウン" },
    { hex: "E6C27A", name: "金" },
    { hex: "F2E2B0", name: "プラチナ" },
    { hex: "C0C0C0", name: "銀" },
    { hex: "FFFFFF", name: "白" },
    { hex: "B22222", name: "赤" },
    { hex: "E75480", name: "ピンク" },
    { hex: "3B5BA9", name: "青" },
    { hex: "6A4C93", name: "紫" },
    { hex: "2E8B57", name: "緑" },
    { hex: "20B2AA", name: "青緑" },
  ],
  skin: [
    { hex: "FFFFFF", name: "白" },
    { hex: "FFF3E0", name: "とても明るい" },
    { hex: "FFE0BD", name: "明るい" },
    { hex: "F5CBA7", name: "やや明るい" },
    { hex: "E0AC69", name: "中間" },
    { hex: "C68642", name: "やや濃い" },
    { hex: "A86B3C", name: "濃い" },
    { hex: "8D5524", name: "とても濃い" },
    { hex: "6B4423", name: "深い" },
    { hex: "4A2E1A", name: "最も深い" },
  ],
  clothes: [...NEUTRALS, ...HUES],
  stroke: [
    { hex: "000000", name: "黒" },
    { hex: "3A3A3A", name: "濃い灰色" },
    { hex: "4A3728", name: "ダークブラウン" },
    { hex: "1F3A5F", name: "ネイビー" },
    { hex: "5C2A2A", name: "ワイン" },
  ],
  background: [
    { hex: "F6F5F4", name: "生成り（既定）" },
    { hex: "FFFFFF", name: "白" },
    { hex: "FFF4E5", name: "クリーム" },
    { hex: "FFE4EC", name: "桜" },
    { hex: "E8F5E9", name: "若葉" },
    { hex: "E3F2FD", name: "空" },
    { hex: "EDE7F6", name: "藤" },
    { hex: "FFF9C4", name: "レモン" },
    { hex: "E0F7FA", name: "水" },
    { hex: "FBE9E7", name: "桃" },
    { hex: "CFD8DC", name: "灰青" },
    { hex: "263238", name: "墨" },
  ],
};

/** 「おまかせ」: 新しい種と、候補から選んだ色（アイコンに映る役割だけ。線の色はそのまま） */
export function randomAvatarConfig(): Required<
  Pick<AvatarConfig, "seed" | "colors" | "background">
> {
  const pick = (list: Swatch[]) => list[Math.floor(Math.random() * list.length)]!.hex;
  return {
    seed: crypto.randomUUID(),
    colors: {
      hair: pick(AVATAR_PALETTES.hair),
      skin: pick(AVATAR_PALETTES.skin),
      clothes: pick(AVATAR_PALETTES.clothes),
    },
    background: pick(AVATAR_PALETTES.background.filter((s) => s.hex !== "263238")),
  };
}
