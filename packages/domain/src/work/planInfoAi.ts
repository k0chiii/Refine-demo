import type { PlanInfoCheckItem, RegisteredPlanInfo } from "./planInfo.ts";
import { checkRegisteredPlanInfoInText } from "./planInfo.ts";

/** 企画情報照合の AI 差し替え点（decision 70A）。本番は Convex から実装を注入する */
export interface PlanInfoCompareProvider {
  compare(text: string, info: RegisteredPlanInfo): Promise<readonly PlanInfoCheckItem[]>;
}

/** 既定: domain ヒューリスティック（スタブ） */
export const heuristicPlanInfoCompare: PlanInfoCompareProvider = {
  async compare(text, info) {
    return checkRegisteredPlanInfoInText(text, info);
  },
};
