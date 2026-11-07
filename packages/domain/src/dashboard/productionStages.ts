/**
 * 制作の進み方（7 段階）。旧 `WorkStage`（overview）と並行する ID。
 * 画面のロール名は持たない（段階 ID と表示用ラベルのみ）。
 */

export const productionStages = [
  "unsubmitted",
  "in_review",
  "applying",
  "awaiting_finalize",
  "awaiting_translation",
  "finalized",
  "submitted",
] as const;

export type ProductionStage = (typeof productionStages)[number];
