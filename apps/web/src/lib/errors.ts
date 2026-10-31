import { ConvexError } from "convex/values";
import { lifecycleLabel, resolutionLabel } from "./labels";

/** ドメインのエラーコード → 利用者向けメッセージ（§13 可観測性: 利用者が操作失敗を判別できる）。 */
const messages: Record<string, string> = {
  unauthenticated: "サインインしてください",
  forbidden: "権限がないか、対象が見つかりません",
  acl_requires_system_admin: "閲覧権限を変更できるのはシステム管理者だけです",
  acl_invalid: "追加する人を確かめてください。空の選択や、いない人は追加できません。",
  work_not_editable: "校了・中止した制作物の校正者は変更できません。",
  acl_group_principal_not_enabled: "グループには権限を付けられません。個人を選んでください。",
  work_not_active: "この制作物は進行中ではありません",
  work_already_finalized: "校了済みです。変更するには校了者が再開してください",
  work_not_finalized: "この制作物は校了されていません",
  revision_rough_after_standard: "0版（ラフ）は最初の版だけです",
  revision_not_accepting: "この版は校正中ではありません",
  revision_deadline_passed: "校正期日を過ぎています",
  revision_not_latest: "最新の版ではありません",
  revision_deadline_in_past: "校正期日は今より後にしてください",
  revision_artifacts_not_verified: "確認できないファイルがあります。アップロードし直してください",
  revision_no_artifacts: "ファイルか外部リンクを 1 件以上追加してください",
  revision_no_reviewable_file: "プレビューできるファイルがありません。PDF か画像も付けてください",
  upload_file_too_large: "1 ファイル 100 MB までです",
  upload_session_not_open: "この提出の準備はもう確定したか、取りやめています",
  upload_session_expired: "この提出の準備は期限が切れました。もう一度提出し直してください。",
  upload_item_not_found: "アップロードするファイルが見つかりません",
  upload_item_invalid_state: "このファイルは今はアップロードできません",
  upload_attempt_not_found:
    "アップロードを確認できませんでした。もう一度アップロードしてください。",
  upload_attempt_closed: "アップロードに時間がかかりすぎました。もう一度アップロードしてください。",
  upload_service_unavailable: "ファイルを受け付けられません。時間をおいてもう一度お試しください。",
  revision_submission_conflict:
    "準備している間に別の版が提出されました。最新の版を確認してから、もう一度提出し直してください。",
  comment_reason_required: "反映しない・次の版で対応するときは理由を書いてください",
  comment_invalid_resolution_transition: "このコメントの状態からは変更できません",
  comment_reply_not_allowed:
    "校正が終わった版には返信できません。制作者は反映するかどうかだけ記録できます",
  social_profile_invalid:
    "SNS アカウントの内容を確かめてください。ユーザー名は各サービスの規則に合わせ、アイコンは画像を選びます。",
  social_profile_limit: "SNS アカウントはこれ以上登録できません",
  work_import_invalid: "取り込めない行があります。確認の表で理由を見て、CSV を直してください。",
  work_invalid: "制作物名・区分・制作者・校了者は必須です",
  social_profile_in_use:
    "この SNS アカウントは制作物に割り当てられているため削除できません。先に割り当てを外してください。",
  team_invalid: "局・担当の名前は 40 文字までです",
  team_duplicate: "同じ局の中に同じ名前があります。別の名前にしてください",
  team_in_use: "制作物が使っている、または担当がある局は削除できません",
  team_not_found: "選んだ局・担当が見つかりません。画面を更新してから選び直してください",
  group_invalid:
    "グループの内容を確かめてください。名前は 30 文字まで（「@」は使えません）、所属する人は 100 人までです。",
  group_duplicate: "同じ名前のグループがあります。別の名前にしてください",
  group_not_found: "選んだグループが見つかりません。画面を更新してから選び直してください",
  mention_too_many: "一度にメンションできるのは 10 人までです",
  comment_body_too_long: "本文が長すぎます。5000 文字までです",
  comment_body_format_invalid:
    "本文の書式を読み取れませんでした。画面を更新してもう一度お試しください",
  mention_not_allowed: "この制作物を見られない人はメンションできません",
  anchor_invalid:
    "コメントの位置を選び直してください。文章は 1 文字以上、引用は 200 文字までです。",
  anchor_artifact_mismatch: "コメントの位置がこの版のファイルにありません",
  approval_not_approver: "校了できるのは、この制作物の校了者だけです",
  approval_already_declared: "校了済みです。ほかの校了者を待っています",
  approval_revision_not_candidate: "校了できるのは最新の通常版だけです",
  approval_rough_revision: "0版（ラフ）からは校了できません",
  approval_blocking_threads_remain:
    "未対応のコメントがあります。反映するか決めるか、理由を書いて未対応のまま校了してください",
  approval_self_approval_not_allowed:
    "制作者が校了するには、ほかの人（主管・校正者）の確認が必要です",
  approval_confirmer_not_independent: "制作者・校了者は確認を記録できません",
  approval_confirmation_not_needed: "この制作物は確認なしで校了できます",
  approval_reopen_reason_required: "再開の理由を書いてください",
  work_invalid_lifecycle_transition: "この制作物の状態からは変更できません",
  comment_edit_not_author: "コメントを訂正できるのは投稿した本人だけです",
  comment_delete_not_author: "コメントや返信を削除できるのは投稿した本人だけです",
  comment_thread_deleted: "このコメントは削除されています",
  comment_reply_not_found: "この返信は見つかりません。すでに削除されています。",
  comment_carry_target_not_accepting: "次の版で対応する先の版は校正中ではありません",
  comment_already_carried: "このコメントはもう次の版へ持ち越されています",
  comment_carry_same_revision: "同じ版へは持ち越せません",
  revision_void_not_allowed: "無効にできるのは校正中の版だけです",
  revision_void_reason_required: "無効にする理由を書いてください",
  check_not_found: "専門確認が見つかりません",
  check_already_done: "この専門確認はもう完了しているか、免除されています",
  check_not_assignee: "この専門確認を完了できるのは担当者・主管・校了者だけです",
  check_waive_reason_required: "免除の理由を書いてください",
  approval_required_checks_incomplete:
    "専門確認が残っています。完了・免除するか、理由を書いて未対応のまま校了してください",
  version_conflict: "ほかの人が先に変更しました。画面を更新してから、もう一度お試しください。",
  document_invalid: "文章を保存できません。大きすぎるか、形式が壊れています。",
  document_too_large: "原稿が長すぎて保存できません。分けてください",
  post_snapshot_mismatch:
    "投稿の内容と添付する画像が対応していません。画像をそろえ直してから提出してください。",
  document_format_mismatch:
    "この制作物の下書きとは形式が違うため保存できません。制作物に合ったエディタで開いてください。",
  notation_rule_invalid: "ルールの内容を確かめてください",
  notation_not_manager: "このカテゴリのルールを編集・承認する権限がありません",
  notation_category_invalid:
    "カテゴリの設定を確かめてください。存在しない継承元や、継承の循環があります。",
  notation_proposal_closed: "この提案はもう処理されています",
  idempotency_conflict: "同じ操作はもう処理されています",
  push_subscription_invalid:
    "この端末への通知を設定できませんでした。ブラウザを更新してやり直してください。",
  notification_prefs_invalid: "通知の設定を保存できませんでした。もう一度お試しください。",
  test_notification_too_soon: "テスト通知は 1 分に 1 回まで送れます",
  slack_workspace_invalid: "名前は 80 文字まで、ワークスペース ID は T で始まる英数字です",
  slack_workspace_duplicate: "同じワークスペース ID がもう登録されています",
  comment_file_invalid: "添付を確かめてください。1 つのコメントに付けられるのは 10 件までです。",
  comment_file_not_found: "この添付は見つかりません。",
  comment_file_not_ready:
    "まだ添付できないファイルがあります。アップロードが終わってから投稿してください。",
  proofread_retry_exhausted: "自動校正の再試行の回数が上限に達しました",
  avatar_invalid: "アバターの設定を保存できませんでした。選び直してからもう一度お試しください。",
};

/** エラーコードに決まった文言（Worker が返すコードなど、ConvexError 以外で来る失敗に使う） */
export function messageForCode(code: string): string {
  return messages[code] ?? genericErrorMessage(code);
}

/** 失敗の理由が分からないときの文言（内部のコードは問い合わせ用に添える） */
export function genericErrorMessage(code?: string): string {
  return `操作を完了できませんでした。もう一度お試しください${code ? `（${code}）` : ""}`;
}

/** 日本語の文か（ライブラリやブラウザの英語のメッセージをそのまま見せないための判定） */
const japanese = /[\u3040-\u30ff\u3400-\u9fff]/;

/** 詳細（details）が分かるときは、いまの状態やどの欄かを文言に入れる */
function withDetails(code: string, details: unknown): string | null {
  const d = (details ?? {}) as {
    from?: unknown;
    to?: unknown;
    errors?: unknown;
    reason?: unknown;
    max?: unknown;
    problems?: unknown;
    groups?: unknown;
    groupId?: unknown;
    field?: unknown;
  };
  if (code === "work_invalid") return workInvalidMessage(details);
  if (code === "forbidden") {
    const permission = (details as { orgPermission?: unknown } | null)?.orgPermission;
    if (permission === "approvers:assign") return "校了者を決める権限がありません";
    if (permission === "works:create") return "制作物を登録する権限がありません";
    if (permission === "groups:manage") return "グループを管理する権限がありません";
  }
  if (code === "work_import_invalid" && d.reason === "row_invalid") {
    const index = (details as { index?: unknown } | null)?.index;
    const cause = (details as { cause?: unknown } | null)?.cause;
    const why =
      cause === "work_invalid"
        ? workInvalidMessage({
            ...(details as object),
            reason: (details as { causeReason?: unknown }).causeReason,
          })
        : typeof cause === "string"
          ? (messages[cause] ?? null)
          : null;
    if (typeof index === "number" && why) return `${index + 1} 件目を登録できません: ${why}`;
  }
  if (code === "document_format_mismatch" && d.reason === "existing_draft")
    return "別の形式の下書きがあるため保存しませんでした";
  if (code === "post_snapshot_mismatch" && Array.isArray(d.problems)) {
    const first = d.problems.find((p): p is string => typeof p === "string");
    if (first) return `提出できません: ${first}。画像をそろえ直してから提出してください。`;
  }
  if (code === "mention_too_many" && typeof d.groups === "number")
    return `一度にメンションできるグループは ${typeof d.max === "number" ? d.max : 3} つまでです`;
  if (code === "mention_not_allowed" && typeof d.groupId === "string")
    return "メンションしたグループが見つかりません。画面を更新してから選び直してください";
  if (code === "group_invalid" && d.reason === "limit")
    return `グループはこれ以上作れません${typeof d.max === "number" ? `（${d.max} まで）` : ""}`;
  if (code === "slack_workspace_invalid") {
    if (d.field === "name") return "ワークスペースの名前を 80 文字までで入れてください";
    if (d.field === "teamId") return "ワークスペース ID は T で始まる英数字です（例: T0123ABCD）";
    if (d.reason === "limit")
      return `ワークスペースはこれ以上登録できません${typeof d.max === "number" ? `（${d.max} まで）` : ""}`;
  }
  if (code === "proofread_retry_exhausted" && typeof d.max === "number")
    return `自動校正の再試行は ${d.max} 回までです`;
  if (code === "notification_prefs_invalid" && d.field === "slackEmail")
    return "Slack のメールアドレスの形が正しくありません";
  if (code === "team_invalid" && d.reason === "limit")
    return `局・担当はこれ以上登録できません${typeof d.max === "number" ? `（${d.max} まで）` : ""}`;
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

/** 制作物の内容の誤り（domain の normalizeWorkEssentials / applyWorkPatch・名簿の確認）を欄ごとの文言にする */
function workInvalidMessage(details: unknown): string | null {
  const d = (details ?? {}) as { field?: unknown; reason?: unknown; max?: unknown };
  const max = typeof d.max === "number" ? d.max : null;
  const label: Record<string, string> = {
    title: "制作物名",
    category: "区分",
    creatorIds: "制作者",
    approverIds: "校了する人",
    approvalQuorum: "校了とみなす人数",
    managerIds: "主管",
    mediaType: "媒体",
    confidentiality: "機密区分",
    productionTeamIds: "制作担当",
  };
  const name = typeof d.field === "string" ? label[d.field] : undefined;
  if (!name) return null;
  if (d.reason === "too_many")
    return `${name}は ${max ?? 1} つまでです。選び直してください（あとから変えられます）`;
  if (d.reason === "required")
    return d.field === "creatorIds"
      ? "制作者を 1 人以上選んでください"
      : d.field === "approverIds"
        ? "校了者を 1 人以上選んでください"
        : `${name}を入力してください`;
  if (d.reason === "too_long") return `${name}は ${max ?? "決められた"} 文字までです`;
  if (d.reason === "creator_is_approver") return "制作者は校了者にできません";
  if (d.reason === "blank_id") return `${name}に空の値があります。選び直してください`;
  if (d.reason === "unknown_user")
    return `${name}に名簿にいない人が含まれています。一度サインインした人から選び直してください`;
  if (d.reason === "unknown") return `${name}の値が正しくありません`;
  if (d.reason === "out_of_range")
    return `${name}は 1 以上、校了者の人数（${max ?? "選んだ人数"}）以下にしてください`;
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
