import { ConvexError } from "convex/values";

/** ドメインのエラーコード → 利用者向けメッセージ（§13 可観測性: 利用者が操作失敗を判別できる）。 */
const messages: Record<string, string> = {
  unauthenticated: "ログインが必要です",
  forbidden: "この操作を行う権限がありません（対象が存在しないか、閲覧許可が付与されていません）",
  acl_requires_system_admin: "閲覧権限の変更は校正システム管理者のみ行えます",
  acl_group_principal_not_enabled: "グループ単位の権限付与は今回のMVPでは無効です（後続機能）",
  work_not_active: "この制作物は進行中ではありません",
  work_already_finalized:
    "この制作物は校了済みです。変更するには校了権限者が理由付きで再開してください",
  work_not_finalized: "この制作物は校了されていません",
  revision_rough_already_exists: "0版（ラフ）は制作物につき1件のみです",
  revision_rough_after_standard: "通常版の提出後に0版（ラフ）は提出できません",
  revision_not_accepting: "この版は校正を受け付けていません",
  revision_deadline_passed: "校正期限を過ぎています（サーバー時刻で判定）",
  revision_not_latest: "最新の受付対象版ではありません",
  revision_deadline_in_past: "校正期限は現在より後の時刻を指定してください",
  revision_artifacts_not_verified:
    "検証が完了していないファイルがあります。失敗したファイルを再アップロードしてから確定してください",
  revision_no_artifacts: "ファイルまたは外部リンクを1件以上指定してください",
  upload_session_not_open: "この提出準備は既に確定または破棄されています",
  upload_session_expired: "この提出準備は期限切れです。もう一度提出をやり直してください",
  upload_item_not_found: "アップロード項目が見つかりません",
  upload_item_invalid_state: "この項目は現在アップロードできる状態ではありません",
  comment_reason_required: "不採用・持越には理由の入力が必要です",
  comment_invalid_resolution_transition: "この状態からその判断へは変更できません",
  comment_reply_not_allowed: "受付終了後の返信は制作者の処置記録のみ可能です（D5 暫定）",
  anchor_invalid: "コメント位置が不正です",
  anchor_artifact_mismatch: "コメント位置がこの版のファイルを指していません",
  approval_not_approver: "校了できるのは、この制作物の校了権限者だけです",
  approval_revision_not_candidate: "校了できるのは最新の通常版だけです",
  approval_rough_revision: "0版（ラフ）からの直接校了は制度確認までできません",
  approval_blocking_threads_remain:
    "未対応の重大な指摘が残っています。処置するか、理由を記入して例外校了してください",
  approval_self_approval_not_allowed:
    "制作者本人による校了は、独立した確認者の記録がない限りできません（D2 承認待ち）",
  approval_reopen_reason_required: "再開には理由が必要です",
  version_conflict: "他の人が先に変更しました。画面を更新して再度お試しください",
  idempotency_conflict: "同じ操作が既に処理されています",
};

export interface AppError {
  code: string;
  message: string;
  details: unknown;
}

export function describeError(error: unknown): AppError {
  if (error instanceof ConvexError) {
    const data = error.data as { code?: string; details?: unknown };
    const code = data.code ?? "unknown";
    return { code, message: messages[code] ?? `エラー: ${code}`, details: data.details ?? null };
  }
  if (error instanceof Error)
    return { code: "client_error", message: error.message, details: null };
  return { code: "unknown", message: "不明なエラーが発生しました", details: null };
}
