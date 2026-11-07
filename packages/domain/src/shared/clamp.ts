/** 0〜1 の範囲に収める（相対位置・正規化座標） */
export const clamp01 = (v: number): number => Math.min(Math.max(v, 0), 1);
