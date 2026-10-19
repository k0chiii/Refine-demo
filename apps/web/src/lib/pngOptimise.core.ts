import {
  PNG_OPTIMISE_MIN_GAIN,
  acceptPngOptimisation,
  checkPngForOptimisation,
  savedEnough,
} from "@mf100/domain";

/** PNG の再最適化器（実体は WASM の oxipng。テストでは同じものを Node で動かす）。画素・色の持ち方を変える変換は入れない */
export interface PngCodec {
  optimise(data: Uint8Array): Uint8Array;
}

export type PngOptimiseOutcome =
  | { kind: "optimised"; bytes: Uint8Array }
  | { kind: "kept"; reason: string };

/**
 * PNG を可逆に作り直す。次のときは元のまま（kept）:
 * - 触らない PNG（アニメーション・16 ビット色・画素数が多すぎる・壊れている）
 * - 結果が構造の確認を通らない（縦横・色や実寸を決めるチャンクが変わった）
 * - 小さくなった割合が閾値（PNG_OPTIMISE_MIN_GAIN）未満
 * 画素そのものの突き合わせは、復号できる環境（ブラウザの Worker）で別に行う。
 */
export function optimisePngBytes(original: Uint8Array, codec: PngCodec): PngOptimiseOutcome {
  const check = checkPngForOptimisation(original);
  if (!check.ok) return { kind: "kept", reason: check.reason };
  const out = codec.optimise(original);
  const accepted = acceptPngOptimisation(original, out);
  if (!accepted.ok) return { kind: "kept", reason: accepted.reason };
  if (!savedEnough(original.byteLength, out.byteLength, PNG_OPTIMISE_MIN_GAIN))
    return { kind: "kept", reason: "small_gain" };
  return { kind: "optimised", bytes: out };
}

/** 画面と Worker の間のメッセージ */
export interface PngWorkerRequest {
  id: number;
  bytes: ArrayBuffer;
}
export type PngWorkerResponse =
  | { id: number; kind: "optimised"; bytes: ArrayBuffer }
  | { id: number; kind: "kept"; reason: string };
