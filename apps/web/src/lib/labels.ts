/** 列挙値の日本語表示。状態名自体は設計提案（§5.1）なので、表示だけここで差し替えられるようにする。 */
export const lifecycleLabel: Record<string, string> = {
  draft: "下書き",
  active: "進行中",
  on_hold: "保留",
  finalized: "校了",
  cancelled: "中止",
};
export const reviewStateLabel: Record<string, string> = {
  scheduled: "準備中",
  open: "受付中",
  closed: "受付終了",
  void: "無効",
};
export const closedReasonLabel: Record<string, string> = {
  deadline: "期限到来",
  superseded: "新版提出",
  void: "無効化",
};
export const kindLabel: Record<string, string> = {
  correction: "修正提案",
  question: "質問",
  discussion: "議論",
  decision: "合意事項",
};
export const severityLabel: Record<string, string> = {
  critical: "重大",
  major: "重要",
  minor: "軽微",
  info: "情報",
};
export const resolutionLabel: Record<string, string> = {
  open: "未対応",
  acknowledged: "確認済",
  accepted: "採用",
  rejected: "不採用",
  deferred: "次版へ持越",
  resolved: "反映済",
};
export const assignmentLabel: Record<string, string> = {
  pending: "未確認",
  viewed: "閲覧済",
  responded: "確認完了",
  excused: "免除",
};
export const permissionLabel: Record<string, string> = {
  view: "閲覧",
  review: "校正",
  edit: "編集（制作委任）",
  manage: "管理",
};
export const mediaLabel: Record<string, string> = {
  pdf: "PDF",
  image: "画像",
  document: "文章",
  video: "動画",
  web: "Web",
  figma: "Figma",
  other: "その他",
};
export const approvalActionLabel: Record<string, string> = {
  finalized: "校了",
  exception_finalized: "例外校了",
  reopened: "再開",
};
export const blockedReasonLabel: Record<string, string> = {
  finalized: "この制作物は校了済みのため新規指摘はできません",
  superseded: "新版が提出されたため、この版の受付は終了しました",
  deadline: "校正期限を過ぎたため、この版の受付は終了しました",
  closed: "この版の受付は終了しています",
  void: "この版は無効化されています",
  not_latest: "最新の受付対象版ではありません",
  forbidden: "この制作物に指摘を投稿する権限がありません",
};
