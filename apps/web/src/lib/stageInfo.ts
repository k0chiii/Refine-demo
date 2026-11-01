import type { WorkStage } from "@mf100/domain";
import type { ChipTone } from "@/ui/Chip";

/** 段階（制作物の状態）の名前・アイコン・色の意味。ホームの表と制作物の一覧で共用（色だけに頼らず、文字とアイコンでも出す） */
export const stageInfo: Record<WorkStage, { label: string; icon: string; tone: ChipTone }> = {
  unsubmitted: { label: "未提出", icon: "upload_file", tone: "neutral" },
  reviewing: { label: "校正中", icon: "rate_review", tone: "primary" },
  lapsed: { label: "次版作成中", icon: "error", tone: "error" },
  on_hold: { label: "保留", icon: "pause", tone: "warning" },
  finalized: { label: "校了", icon: "task_alt", tone: "success" },
};
