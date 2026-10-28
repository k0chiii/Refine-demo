import type { EmailContent, SendOutcome } from "@mf100/domain";

/*
 * 登録メールアドレスへの通知（Resend の HTTP API。無料枠 3,000 通/月・100 通/日）。
 * 鍵は Convex の環境変数（RESEND_API_KEY・NOTIFY_EMAIL_FROM。lib/channels.ts が読む）。応答は SendOutcome にして返す。
 */

/**
 * 1 通送る。Idempotency-Key（通知 × 届け先）で、記録の前に落ちたときの送り直しを Resend が 1 通にまとめる。
 * 2xx・409 invalid_idempotent_request → sent、409 concurrent → retry、400・422 → rejected、
 * 401・403・送信枠切れの 429 → unavailable、速さ制限の 429 → Retry-After を一度だけ待って retry、5xx・つながらない → retry
 */
export async function sendEmail(
  cfg: { apiKey: string; from: string },
  mail: { to: string; content: EmailContent },
  opts: { idempotencyKey: string; fetch?: typeof fetch },
): Promise<SendOutcome> {
  void [cfg, mail, opts];
  throw new Error("not implemented");
}
