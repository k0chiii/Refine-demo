import type { EmailContent, SendOutcome } from "@mf100/domain";

/*
 * 登録メールアドレスへの通知（Resend の HTTP API。無料枠 3,000 通/月・100 通/日）。
 * 鍵は Convex の環境変数（RESEND_API_KEY・NOTIFY_EMAIL_FROM。lib/channels.ts が読む）。応答は SendOutcome にして返す。
 * ログに宛先と本文は出さない。
 */

const ENDPOINT = "https://api.resend.com/emails";

/** 速さ制限の Retry-After（秒）を待つ時間。action を長く止めないよう 5 秒まで。無い・読めないときは 0 */
function retryAfterMs(header: string | null): number {
  const seconds = Number(header);
  if (!header || !Number.isFinite(seconds) || seconds <= 0) return 0;
  return Math.min(seconds, 5) * 1000;
}

const sleepFor = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** Resend の誤りの応答（{ name, message }）。本文が無い・JSON でないときは空 */
interface ResendError {
  name?: string;
  message?: string;
}

const QUOTA_ERRORS = new Set(["daily_quota_exceeded", "monthly_quota_exceeded"]);

/** validation_error が宛先（to）を指しているか */
function mentionsTo(message: string | undefined): boolean {
  return /`to`|\bto (field|address)\b/i.test(message ?? "");
}

/** 応答 → 結果。"wait" は速さ制限の 429（待ってから一度だけ送り直す） */
function outcomeOf(status: number, err: ResendError): SendOutcome | "wait" {
  if (status >= 200 && status < 300) return { kind: "sent", httpStatus: status };
  if (status === 409)
    return err.name === "invalid_idempotent_request"
      ? { kind: "sent", httpStatus: status }
      : { kind: "retry" };
  if (status === 400 || status === 422) {
    const toInvalid =
      err.name === "invalid_to_address" ||
      (err.name === "validation_error" && mentionsTo(err.message));
    return {
      kind: "rejected",
      reason: toInvalid ? "invalid_address" : "invalid_content",
      httpStatus: status,
    };
  }
  if (status === 429)
    return err.name && QUOTA_ERRORS.has(err.name)
      ? { kind: "unavailable", reason: err.name }
      : "wait";
  if (status >= 500) return { kind: "retry" };
  // 401・403（鍵の誤り・送信元ドメイン未確認）と、ほかの想定外の 4xx は運用側の問題
  return { kind: "unavailable", reason: err.name ?? `http_${status}` };
}

async function errorBody(res: Response): Promise<ResendError> {
  try {
    const body: unknown = await res.json();
    return body && typeof body === "object" ? (body as ResendError) : {};
  } catch {
    return {};
  }
}

/**
 * 1 通送る。Idempotency-Key（通知 × 届け先）で、記録の前に落ちたときの送り直しを Resend が 1 通にまとめる。
 * 2xx・409 invalid_idempotent_request → sent、409 concurrent → retry、400・422 → rejected、
 * 401・403・送信枠切れの 429 → unavailable、速さ制限の 429 → Retry-After を一度だけ待って retry、5xx・つながらない → retry
 */
export async function sendEmail(
  cfg: { apiKey: string; from: string },
  mail: { to: string; content: EmailContent },
  opts: { idempotencyKey: string; fetch?: typeof fetch; sleep?: (ms: number) => Promise<void> },
): Promise<SendOutcome> {
  const doFetch = opts.fetch ?? fetch;
  const sleep = opts.sleep ?? sleepFor;
  const request = (): Promise<Response> =>
    doFetch(ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${cfg.apiKey}`,
        "Content-Type": "application/json",
        "Idempotency-Key": opts.idempotencyKey,
      },
      body: JSON.stringify({
        from: cfg.from,
        to: [mail.to],
        subject: mail.content.subject,
        text: mail.content.text,
      }),
    });
  let waited = false;
  for (;;) {
    let res: Response;
    try {
      res = await request();
    } catch {
      return { kind: "retry" };
    }
    const outcome = outcomeOf(res.status, await errorBody(res));
    if (outcome !== "wait") return outcome;
    if (waited) return { kind: "retry" };
    waited = true;
    const ms = retryAfterMs(res.headers.get("Retry-After"));
    if (ms > 0) await sleep(ms);
  }
}
