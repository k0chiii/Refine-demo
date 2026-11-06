/** 通知の種類ごとのアイコン（Material Symbols）と、絞り込みに出す呼び方。パネル・シート・全画面で共用 */
export const notificationIcon: Record<string, string> = {
  revision_submitted: "upload_file",
  review_assigned: "assignment_ind",
  comment_posted: "chat",
  comment_decided: "rule",
  comment_assigned: "person_pin",
  check_requested: "fact_check",
  check_completed: "task_alt",
  deadline_approaching: "alarm",
  work_finalized: "verified",
  work_reopened: "lock_open",
  revision_voided: "block",
  auto_proofread_done: "smart_toy",
  rule_proposed: "spellcheck",
  rule_proposal_decided: "rule",
  mentioned: "alternate_email",
  feedback_posted: "forum",
  feedback_mentioned: "alternate_email",
  test: "send",
};

export const notificationKindLabel: Record<string, string> = {
  revision_submitted: "新しい版",
  review_assigned: "校正の割り当て",
  comment_posted: "コメント",
  comment_decided: "コメントの採否",
  comment_assigned: "コメントの担当",
  check_requested: "専門確認の依頼",
  check_completed: "専門確認の完了",
  deadline_approaching: "期限",
  work_finalized: "校了",
  work_reopened: "再開",
  revision_voided: "版の無効化",
  auto_proofread_done: "自動校正",
  rule_proposed: "表記ルールの提案",
  rule_proposal_decided: "表記ルールの採否",
  mentioned: "メンション",
  feedback_posted: "FB",
  feedback_mentioned: "FB のメンション",
  test: "テスト通知",
};

/** 通知を開いたときの行き先（Editor の版・制作物・表記ルール）。無ければ null */
export function notificationDestination(n: {
  kind: string;
  workId?: string | undefined;
  revisionId?: string | undefined;
  threadId?: string | undefined;
}):
  | { to: "/revisions/$revisionId"; params: { revisionId: string }; search: { thread?: string } }
  | { to: "/works/$workId"; params: { workId: string } }
  | { to: "/notation"; search: { view: "proposals" } }
  | null {
  // 旧 FB の通知は、サーバーが移し先のコメント（版とスレッド）に付け替えて返す。移していないものは行き先を持たない
  if (n.revisionId)
    return {
      to: "/revisions/$revisionId",
      params: { revisionId: n.revisionId },
      search: n.threadId ? { thread: n.threadId } : {},
    };
  if (n.workId) return { to: "/works/$workId", params: { workId: n.workId } };
  if (n.kind === "rule_proposed" || n.kind === "rule_proposal_decided")
    return { to: "/notation", search: { view: "proposals" } };
  return null;
}
