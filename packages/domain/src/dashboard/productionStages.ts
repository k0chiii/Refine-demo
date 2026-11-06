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

/** 段階 ID → 短いラベル（表・凡例用。ロール名ではない） */
export const productionStageLabels: Record<ProductionStage, string> = {
  unsubmitted: "未提出",
  in_review: "校正中",
  applying: "反映中",
  awaiting_finalize: "校了待ち",
  awaiting_translation: "翻訳待ち",
  finalized: "校了",
  submitted: "入稿済み",
};
