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
  open: "校正中",
  closed: "締切済み",
  void: "無効",
};
export const closedReasonLabel: Record<string, string> = {
  deadline: "校正期日を過ぎた",
  superseded: "新しい版が出た",
  void: "無効にした",
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
  info: "参考",
};
export const resolutionLabel: Record<string, string> = {
  open: "未対応",
  acknowledged: "確認済み",
  accepted: "反映する",
  rejected: "反映しない",
  deferred: "次の版で対応",
  resolved: "反映済み",
};
export const assignmentLabel: Record<string, string> = {
  pending: "未確認",
  viewed: "閲覧済み",
  responded: "校正完了",
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
  sns: "SNS 投稿",
  video: "動画",
  web: "Web",
  figma: "Figma",
  other: "その他",
};
export const approvalActionLabel: Record<string, string> = {
  declared: "校了する",
  finalized: "校了",
  exception_finalized: "未対応のまま校了",
  reopened: "再開",
};
export const blockedReasonLabel: Record<string, string> = {
  finalized: "校了済みのため、コメントできません",
  superseded: "新しい版が出たため、この版の校正は終わりました",
  deadline: "校正期日を過ぎたため、この版の校正は終わりました",
  closed: "この版の校正は終わりました",
  void: "この版は無効です",
  not_latest: "最新の版ではありません",
  forbidden: "この制作物にコメントする権限がありません",
};
export const checkStateLabel: Record<string, string> = {
  pending: "未完了",
  done: "確認済み",
  waived: "免除",
};
export const notificationKindLabel: Record<string, string> = {
  revision_submitted: "版の提出",
  review_assigned: "校正の割り当て",
  comment_posted: "コメント",
  comment_decided: "採否",
  comment_assigned: "対応担当",
  check_requested: "専門確認の依頼",
  check_completed: "専門確認の完了",
  deadline_approaching: "期限接近",
  work_finalized: "校了",
  work_reopened: "再開",
  revision_voided: "版の無効化",
  auto_proofread_done: "自動校正",
  rule_proposed: "表記ルールの提案",
  rule_proposal_decided: "提案の結果",
};
export const lifecycleActionLabel: Record<string, string> = {
  active: "進行中に戻す",
  on_hold: "保留にする",
  cancelled: "中止する",
};
