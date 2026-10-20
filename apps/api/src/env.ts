/** Workers バインディングと環境変数。wrangler.jsonc と対応。 */
export interface Bindings {
  ASSETS: R2Bucket;
  /** Convex deployment URL（例: https://xxx.convex.cloud） */
  CONVEX_URL: string;
  /** Convex Auth の issuer（例: https://xxx.convex.site） */
  CONVEX_SITE_URL: string;
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
