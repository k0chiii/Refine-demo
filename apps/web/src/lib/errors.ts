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
  upload_attempt_not_found:
    "アップロードを確認できませんでした。もう一度アップロードしてください。",
  upload_attempt_closed: "アップロードに時間がかかりすぎました。もう一度アップロードしてください。",
  upload_service_unavailable: "ファイルを受け付けられません。時間をおいてもう一度お試しください。",
  revision_submission_conflict:
    "準備している間に別の版が提出されました。最新の版を確認してから、もう一度提出し直してください。",
  comment_reason_required: "不採用・持ち越しには理由を書いてください",
  comment_invalid_resolution_transition: "このコメントの状態からは変更できません",
  comment_reply_not_allowed: "受付が終わった版には返信できません。制作者は採否だけ記録できます。",
  social_profile_invalid:
    "SNS アカウントの内容を確かめてください。ユーザー名は各サービスの規則に合わせ、アイコンは画像を選びます。",
  social_profile_limit: "SNS アカウントはこれ以上登録できません",
  work_import_invalid: "取り込めない行があります。確認の表で理由を見て、CSV を直してください。",
  work_invalid:
    "制作物の内容を確かめてください。名称・区分・制作者・校了権限者（1 人）は必須です。",
  social_profile_in_use:
    "この SNS アカウントは制作物に割り当てられているため削除できません。先に割り当てを外してください。",
  team_invalid:
    "局・担当の内容を確かめてください。名前は 40 文字まで、担当は局の下に作ります。使われている局・担当は種類を変えられません。",
  team_duplicate: "同じ局の中に同じ名前があります。別の名前にしてください",
  team_in_use: "制作物が使っている、または担当がある局は削除できません",
  team_not_found: "選んだ局・担当が見つかりません。画面を更新してから選び直してください",
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
  approval_self_approval_not_allowed:
    "制作者本人が校了するには、制作者・校了権限者以外の人（主管・校正者など）が、この版の独立確認をしておく必要があります",
  approval_confirmer_not_independent: "制作者・校了権限者は独立確認をできません",
  approval_confirmation_not_needed:
    "この制作物は独立確認なしで校了できます（独立確認は、制作者本人が校了するときだけ必要です）",
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
  document_too_large:
    "下書きが大きすぎて保存できません。文章と書式を合わせて約 900KB までです。文章を分けるか、長い部分を減らしてください。",
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
  feedback_invalid:
    "投稿の内容を確かめてください。題名は 80 文字まで、本文は 5000 文字まで、添付は 10 件までです。",
  feedback_not_found: "このスレッドや投稿は見つかりません。削除されたか、閲覧の権限がありません。",
  push_subscription_invalid:
    "この端末への通知を設定できませんでした。ブラウザを更新してやり直してください。",
  feedback_file_not_ready:
    "まだ添付できないファイルがあります。アップロードが終わってから投稿してください。",
  avatar_invalid: "アバターの設定を保存できませんでした。選び直してからもう一度お試しください。",
};

/** 失敗の理由が分からないときの文言（内部のコードは問い合わせ用に添える） */
export function genericErrorMessage(code?: string): string {
  return `操作を完了できませんでした。もう一度お試しください${code ? `（コード: ${code}）` : ""}。`;
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
  };
  if (code === "feedback_invalid") {
    const field = (details as { field?: unknown } | null)?.field;
    if (field === "title")
      return d.reason === "required"
        ? "スレッドの題名を書いてください"
        : `スレッドの題名は ${typeof d.max === "number" ? d.max : 80} 文字までです`;
    if (field === "body")
      return d.reason === "required"
        ? "本文を書くか、ファイルを添付してください"
        : `本文は ${typeof d.max === "number" ? d.max : 5000} 文字までです`;
    if (field === "files" && d.reason === "too_many")
      return `添付は 1 つの投稿に ${typeof d.max === "number" ? d.max : 10} 件までです`;
  }
  if (code === "work_invalid") return workInvalidMessage(details);
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
    return "この制作物には別の形式の下書きがあります。そのまま保存すると原稿が消えるため保存しませんでした。置き換える場合は、エディタの案内から明示的に置き換えてください。";
  if (code === "post_snapshot_mismatch" && Array.isArray(d.problems)) {
    const first = d.problems.find((p): p is string => typeof p === "string");
    if (first) return `提出できません: ${first}。画像をそろえ直してから提出してください。`;
  }
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
    title: "名称",
    category: "区分",
    creatorIds: "制作者",
    approverId: "校了権限者",
    managerIds: "主管・制作統括",
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
      : d.field === "approverId"
        ? "校了権限者を 1 人選んでください"
        : `${name}を入力してください`;
  if (d.reason === "too_long") return `${name}は ${max ?? "決められた"} 文字までです`;
  if (d.reason === "blank_id") return `${name}に空の値があります。選び直してください`;
  if (d.reason === "unknown_user")
    return `${name}に名簿にいない人が含まれています。一度サインインした人から選び直してください`;
  if (d.reason === "unknown") return `${name}の値が正しくありません`;
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
