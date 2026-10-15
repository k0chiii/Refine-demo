import { ConvexError } from "convex/values";
import { lifecycleLabel, resolutionLabel } from "./labels";

/** ドメインのエラーコード → 利用者向けメッセージ（§13 可観測性: 利用者が操作失敗を判別できる）。 */
const messages: Record<string, string> = {
  unauthenticated: "サインインしてください",
  forbidden: "この操作をする権限がありません。対象が無いか、閲覧の権限がありません。",
  acl_requires_system_admin: "閲覧権限を変更できるのはシステム管理者だけです",
  acl_group_principal_not_enabled: "グループには権限を付けられません。個人を選んでください。",
  work_not_active: "この制作物は進行中ではありません",
  work_already_finalized:
    "この制作物は校了済みです。変更するには校了権限者が理由を書いて再開してください。",
  work_not_finalized: "この制作物は校了されていません",
  revision_rough_after_standard: "通常版を提出した後は 0版（ラフ）を提出できません",
  revision_not_accepting: "この版は校正を受け付けていません",
  revision_deadline_passed: "校正の締切を過ぎています",
  revision_not_latest: "最新の受付中の版ではありません",
  revision_deadline_in_past: "校正の締切は今より後にしてください",
  revision_artifacts_not_verified:
    "確認できていないファイルがあります。確認できなかったファイルをアップロードし直してから提出してください。",
  revision_no_artifacts: "ファイルか外部リンクを 1 件以上追加してください",
  upload_session_not_open: "この提出の準備はもう確定したか、取りやめています",
  upload_session_expired: "この提出の準備は期限が切れました。もう一度提出し直してください。",
  upload_item_not_found: "アップロードするファイルが見つかりません",
  upload_item_invalid_state: "このファイルは今はアップロードできません",
  comment_reason_required: "不採用・持ち越しには理由を書いてください",
  comment_invalid_resolution_transition: "このコメントの状態からは変更できません",
  comment_reply_not_allowed: "受付が終わった版には返信できません。制作者は採否だけ記録できます。",
  social_profile_invalid:
    "SNS アカウントの内容を確かめてください。ユーザー名は各サービスの規則に合わせ、アイコンは画像を選びます。",
  social_profile_limit: "SNS アカウントはこれ以上登録できません",
  social_profile_in_use:
    "この SNS アカウントは制作物に割り当てられているため削除できません。先に割り当てを外してください。",
  mention_too_many: "一度にメンションできるのは 10 人までです",
  mention_not_allowed: "この制作物を見られない人はメンションできません",
  anchor_invalid:
    "コメントの位置を選び直してください。文章は 1 文字以上、引用は 200 文字までです。",
  anchor_artifact_mismatch: "コメントの位置がこの版のファイルにありません",
  approval_not_approver: "校了できるのは、この制作物の校了権限者だけです",
  approval_revision_not_candidate: "校了できるのは最新の通常版だけです",
  approval_rough_revision: "0版（ラフ）からは校了できません",
  approval_blocking_threads_remain:
    "未対応のコメントが残っています。採否を決めるか、理由を書いて例外校了してください。",
  approval_self_approval_not_allowed: "制作者本人が校了するには、独立確認者を選んでください",
  approval_reopen_reason_required: "再開の理由を書いてください",
  work_invalid_lifecycle_transition: "この制作物の状態からは変更できません",
  comment_edit_not_author: "コメントを訂正できるのは投稿した本人だけです",
  comment_carry_target_not_accepting: "持ち越し先の版は校正を受け付けていません",
  comment_already_carried: "このコメントはもう次の版へ持ち越されています",
  comment_carry_same_revision: "同じ版へは持ち越せません",
  revision_void_not_allowed: "無効化できるのは受付中の版だけです",
  revision_void_reason_required: "無効化の理由を書いてください",
  check_not_found: "専門確認が見つかりません",
  check_already_done: "この専門確認はもう完了しているか、免除されています",
  check_not_assignee: "この専門確認を完了できるのは担当者（または主管・校了権限者）だけです",
  check_waive_reason_required: "免除の理由を書いてください",
  approval_required_checks_incomplete:
    "未完了の専門確認があります。確認を完了するか免除するか、理由を書いて例外校了してください。",
  version_conflict: "ほかの人が先に変更しました。画面を更新してから、もう一度お試しください。",
  document_invalid: "文章を保存できません。大きすぎるか、形式が壊れています。",
  notation_rule_invalid: "ルールの内容を確かめてください",
  notation_not_manager: "このカテゴリのルールを編集・承認する権限がありません",
  notation_category_invalid:
    "カテゴリの設定を確かめてください。存在しない継承元や、継承の循環があります。",
  notation_proposal_closed: "この提案はもう処理されています",
  idempotency_conflict: "同じ操作はもう処理されています",
};

/** 失敗の理由が分からないときの文言（内部のコードは問い合わせ用に添える） */
export function genericErrorMessage(code?: string): string {
  return `操作を完了できませんでした。もう一度お試しください${code ? `（コード: ${code}）` : ""}。`;
}

/** 日本語の文か（ライブラリやブラウザの英語のメッセージをそのまま見せないための判定） */
const japanese = /[\u3040-\u30ff\u3400-\u9fff]/;

/** 詳細（details）が分かるときは、いまの状態やどの欄かを文言に入れる */
function withDetails(code: string, details: unknown): string | null {
  const d = (details ?? {}) as { from?: unknown; to?: unknown; errors?: unknown };
  if (code === "comment_invalid_resolution_transition" && typeof d.from === "string") {
    const from = resolutionLabel[d.from] ?? d.from;
    if (d.to === "edited") return `このコメントは今「${from}」なので、訂正できません`;
    const to = typeof d.to === "string" ? (resolutionLabel[d.to] ?? d.to) : null;
    return to
      ? `このコメントは今「${from}」なので、「${to}」にはできません`
      : `このコメントは今「${from}」なので、変更できません`;
  }
  if (code === "work_invalid_lifecycle_transition" && typeof d.from === "string") {
    const from = lifecycleLabel[d.from] ?? d.from;
    const to = typeof d.to === "string" ? (lifecycleLabel[d.to] ?? d.to) : null;
    return to
      ? `この制作物は今「${from}」なので、「${to}」にはできません`
      : `この制作物は今「${from}」なので、変更できません`;
  }
  if (code === "notation_rule_invalid" && Array.isArray(d.errors) && d.errors.length > 0) {
    const list = d.errors.filter((e): e is string => typeof e === "string").slice(0, 3);
    if (list.length) return `ルールの内容を確かめてください: ${list.join("、")}`;
  }
  return null;
}

export interface AppError {
  code: string;
  message: string;
  details: unknown;
}

export function describeError(error: unknown): AppError {
  if (error instanceof ConvexError) {
    const data = error.data as { code?: string; details?: unknown };
    const code = data.code ?? "unknown";
    const message = withDetails(code, data.details) ?? messages[code] ?? genericErrorMessage(code);
    return { code, message, details: data.details ?? null };
  }
  // 画面側で投げた日本語の文言はそのまま、英語のメッセージ（ライブラリ・ネットワーク）は決まった文言にする
  if (error instanceof Error)
    return {
      code: "client_error",
      message: japanese.test(error.message) ? error.message : genericErrorMessage(),
      details: null,
    };
  return { code: "unknown", message: genericErrorMessage(), details: null };
}
