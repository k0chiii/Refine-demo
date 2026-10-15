import type { DashboardWidgetId } from "@mf100/domain";

/** ダッシュボードの節の見出しと説明（ホームを編集のダイアログにも出す） */
export const widgetInfo: Record<DashboardWidgetId, { title: string; description: string }> = {
  submit: { title: "提出する", description: "あなたが制作者で、版を提出できる制作物" },
  review: { title: "校正する", description: "あなたに割り当てられ、まだ確認を完了していない版" },
  respond: { title: "返事をする", description: "未対応のコメントがある、あなたが判断する版" },
  checks: { title: "専門確認をする", description: "あなたが担当の、未完了の専門確認" },
  finalize: { title: "校了する", description: "コメントも専門確認も片付いた、あなたが校了する版" },
  assign: { title: "割り当てる", description: "校正者がまだいない受付中の版" },
  deadlines: { title: "次の締切", description: "7 日以内の校正の締切と納期" },
  mentions: {
    title: "自分宛てのコメント",
    description: "メンション・対応の担当・新しいコメントなど",
  },
  pinned: { title: "ピン留め", description: "ホームにピン留めした制作物" },
  recent: { title: "最近開いた制作物", description: "エディタで開いた順" },
  backlog: {
    title: "滞っている制作物",
    description: "期限超過・校正者が未割当・動きがない・納期が近い",
  },
};
