import { DomainError } from "../shared/DomainError.ts";

/**
 * アバター（Humation）の設定。利用者指示 2026-10-17「Humation のアバター選択画面もつけて欲しい」。
 * 設定が無い人は、いままでどおりメール（または ID）から決まる絵。設定は本人だけが変え、アカウントごとに 1 つ持つ。
 *
 * ここは**形**だけを確かめる（部位の名前が実在するかはアセット（manifest）を持つ Web 側で確かめ、知らない名前は捨てる）。
 * - selections: 部位（head・body など）→ 部品の名前（`braids` など。Humation の slot-scoped name）
 * - colors: 色の役割（hair・skin・clothes・bottom・stroke）→ 6 桁の 16 進（`#` 無し・大文字に正規化）
 * - background: 背景の色（同じ形）
 * - seed: 「おまかせ」で決めた種（部位を保存しない使い方のため。保存時は普通 selections を全部持つ）
 */
export interface AvatarConfig {
  seed?: string;
  selections?: Record<string, string>;
  colors?: Record<string, string>;
  background?: string;
}

/** 部位・色の役割・部品の名前（Humation の ID と alias の形: 英小文字・数字・ハイフン） */
const NAME = /^[a-z0-9][a-z0-9-]{0,63}$/;
const HEX = /^#?([0-9a-fA-F]{6})$/;
export const AVATAR_MAX_SEED_LENGTH = 120;
export const AVATAR_MAX_ENTRIES = 16;

const invalid = (field: string, reason: string): DomainError =>
  new DomainError("avatar_invalid", { field, reason });

/** 6 桁の 16 進の色を `#` 無し・大文字に揃える。形が違えば null */
export function normalizeAvatarHex(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const m = HEX.exec(value.trim());
  return m ? m[1]!.toUpperCase() : null;
}

function normalizeMap(
  field: "selections" | "colors",
  input: unknown,
  value: (v: unknown) => string | null,
): Record<string, string> | undefined {
  if (input === undefined) return undefined;
  if (input === null || typeof input !== "object" || Array.isArray(input))
    throw invalid(field, "shape");
  const entries = Object.entries(input as Record<string, unknown>);
  if (entries.length > AVATAR_MAX_ENTRIES) throw invalid(field, "too_many");
  const out: Record<string, string> = {};
  for (const [k, raw] of entries) {
    if (!NAME.test(k)) throw invalid(field, "key");
    const v = value(raw);
    if (v === null) throw invalid(field, "value");
    out[k] = v;
  }
  return out;
}

/**
 * 保存する前の検証と正規化。形が違えば `avatar_invalid`。
 * 空の設定（何も指定していない）は null（＝設定なし。メールから決まる絵に戻る）。
 */
export function validateAvatarConfig(input: unknown): AvatarConfig | null {
  if (input === null || input === undefined) return null;
  if (typeof input !== "object" || Array.isArray(input)) throw invalid("avatar", "shape");
  const o = input as Record<string, unknown>;
  const out: AvatarConfig = {};
  if (o.seed !== undefined) {
    if (typeof o.seed !== "string" || o.seed.length === 0 || o.seed.length > AVATAR_MAX_SEED_LENGTH)
      throw invalid("seed", "length");
    out.seed = o.seed;
  }
  const selections = normalizeMap("selections", o.selections, (v) =>
    typeof v === "string" && NAME.test(v) ? v : null,
  );
  if (selections && Object.keys(selections).length > 0) out.selections = selections;
  const colors = normalizeMap("colors", o.colors, normalizeAvatarHex);
  if (colors && Object.keys(colors).length > 0) out.colors = colors;
  if (o.background !== undefined) {
    const bg = normalizeAvatarHex(o.background);
    if (bg === null) throw invalid("background", "value");
    out.background = bg;
  }
  return Object.keys(out).length === 0 ? null : out;
}

/**
 * 保存済みの値を読むときの寛容な版（形が壊れていても画面を壊さない）。
 * 不正な項目は捨て、残りを返す。何も残らなければ null
 */
export function parseAvatarConfig(input: unknown): AvatarConfig | null {
  if (input === null || input === undefined || typeof input !== "object" || Array.isArray(input))
    return null;
  const o = input as Record<string, unknown>;
  const out: AvatarConfig = {};
  if (typeof o.seed === "string" && o.seed.length > 0 && o.seed.length <= AVATAR_MAX_SEED_LENGTH)
    out.seed = o.seed;
  const pick = (map: unknown, value: (v: unknown) => string | null) => {
    if (map === null || typeof map !== "object" || Array.isArray(map)) return undefined;
    const res: Record<string, string> = {};
    for (const [k, raw] of Object.entries(map as Record<string, unknown>).slice(
      0,
      AVATAR_MAX_ENTRIES,
    )) {
      const v = NAME.test(k) ? value(raw) : null;
      if (v !== null) res[k] = v;
    }
    return Object.keys(res).length ? res : undefined;
  };
  const selections = pick(o.selections, (v) => (typeof v === "string" && NAME.test(v) ? v : null));
  if (selections) out.selections = selections;
  const colors = pick(o.colors, normalizeAvatarHex);
  if (colors) out.colors = colors;
  const bg = normalizeAvatarHex(o.background);
  if (bg !== null) out.background = bg;
  return Object.keys(out).length === 0 ? null : out;
}

/** 2 つの設定が同じか（保存ボタンを出すかの判定） */
export function sameAvatarConfig(a: AvatarConfig | null, b: AvatarConfig | null): boolean {
  if (a === null || b === null) return a === b;
  const key = (c: AvatarConfig) =>
    JSON.stringify({
      seed: c.seed ?? null,
      selections: Object.entries(c.selections ?? {}).sort(([x], [y]) => x.localeCompare(y)),
      colors: Object.entries(c.colors ?? {}).sort(([x], [y]) => x.localeCompare(y)),
      background: c.background ?? null,
    });
  return key(a) === key(b);
}
