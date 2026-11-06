// 秘密（`wrangler secret put`）は wrangler types の Env に出ないので、ここで足す
interface Env {
  ACCESS_TEAM?: string;
  // 認証（src/auth/env.ts の AuthEnv と同じ名前。秘密は wrangler types に出ない）
  AUTH_PRIVATE_KEY_JWK?: string;
  NOGIKU_CLIENT_ID?: string;
  NOGIKU_CLIENT_SECRET?: string;
  NOGIKU_ISSUER?: string;
  NOGIKU_ACCESS_API_URL?: string;
  NOGIKU_ACCESS_ORG_SLUG?: string;
  NOGIKU_ACCESS_SYSTEM_ID?: string;
  NOGIKU_ACCESS_ENABLED?: string;
  ACCESS_AUDIENCE?: string;
  // サービス間の共有秘密。未設定・短いときは、それで守られた関数ごと 404（src/serviceAuth.ts）
  MF100_UPLOAD_SECRET?: string;
  MF100_CLEANUP_SECRET?: string;
  PROCESSING_SECRET?: string;
  // 外への通知（src/delivery/channels.ts）。揃わない経路は使わない
  VAPID_PUBLIC_KEY?: string;
  VAPID_PRIVATE_KEY?: string;
  VAPID_SUBJECT?: string;
  RESEND_API_KEY?: string;
  NOTIFY_EMAIL_FROM?: string;
  SLACK_BASE_URL?: string;
  // "true" のときだけ、ルールの埋め込みの索引づけ（indexRule）を積む（Convex と同じ）
  RULE_EMBEDDINGS_ENABLED?: string;
}
