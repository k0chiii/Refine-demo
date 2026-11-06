/** Workers バインディングと環境変数。wrangler.jsonc と対応。 */
export interface Bindings extends Omit<
  Cloudflare.Env,
  "CONVEX_URL" | "CONVEX_SITE_URL" | "ALLOWED_ORIGINS" | "BACKEND" | "CLOUDFLARE_SITE_URL"
> {
  STATIC_ASSETS?: Fetcher;
  AI?: import("./workersAi").AiBinding;
  WORKERS_AI_SECRET?: string;
  WORKERS_AI_MODEL?: string;
  ACCESS_TEAM?: string;
  ACCESS_AUDIENCE?: string;
  /** Convex deployment URL（例: https://xxx.convex.cloud） */
  CONVEX_URL: string;
  /** Convex Auth の issuer（例: https://xxx.convex.site） */
  CONVEX_SITE_URL: string;
  /** 業務の正本。未設定は convex（当面の本番）。cloudflare にすると apps/cloudflare を呼ぶ（CLOUDFLARE_SITE_URL が要る） */
  BACKEND?: "convex" | "cloudflare";
  /** apps/cloudflare の URL。JWT の issuer・JWKS の基でもある（apps/cloudflare の SITE_URL と同じ値） */
  CLOUDFLARE_SITE_URL?: string;
  /** CORS 許可オリジン（カンマ区切り） */
  ALLOWED_ORIGINS: string;
  /** R2 清掃 cron が Convex の /internal エンドポイントを呼ぶための共有秘密（`wrangler secret put`）。未設定なら清掃は走らない */
  MF100_CLEANUP_SECRET?: string;
  /**
   * 実体の転送（試行の開始・採用・破棄）を Convex の /internal/uploads・/internal/comments/files に送るための共有秘密
   * （`wrangler secret put`。Convex 側にも同じ値。16 文字以上）。未設定ならアップロードは 503
   */
  MF100_UPLOAD_SECRET?: string;
  /**
   * Figma REST API のトークン（`wrangler secret put FIGMA_ACCESS_TOKEN`。個人アクセストークンは最長 90 日、
   * スコープ `file_content:read`）。未設定なら /figma/import は「未設定」を返し、UI は取り込みを出さない。
   * 利用者決定 2026-10-17「API が使えるならまずはそっちで試す」。トークンを置くのは利用者の手順
   */
  FIGMA_ACCESS_TOKEN?: string;
}

/**
 * 処理台帳（/internal/processing）と JWT の issuer が向く先。Queue・Workflow・cron からも同じ規則で引くので 1 か所に置く。
 * cloudflare を選んだのに URL が無いときは、黙って Convex に落とさず投げる（取り違えに気づけるように）
 */
export function backendSiteUrl(
  env: Pick<Bindings, "BACKEND" | "CONVEX_SITE_URL" | "CLOUDFLARE_SITE_URL">,
) {
  if (env.BACKEND !== "cloudflare") return env.CONVEX_SITE_URL;
  if (!env.CLOUDFLARE_SITE_URL)
    throw new Error("BACKEND=cloudflare には CLOUDFLARE_SITE_URL が要ります");
  // issuer は末尾の / なしで発行される（apps/cloudflare の SITE_URL と同じ扱い）
  return env.CLOUDFLARE_SITE_URL.replace(/\/+$/, "");
}
