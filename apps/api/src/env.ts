/** Workers バインディングと環境変数。wrangler.jsonc と対応。 */
export interface Bindings {
  ASSETS: R2Bucket;
  /** Convex deployment URL（例: https://xxx.convex.cloud） */
  CONVEX_URL: string;
  /** Convex Auth の issuer（例: https://xxx.convex.site） */
  CONVEX_SITE_URL: string;
  /** CORS 許可オリジン（カンマ区切り） */
  ALLOWED_ORIGINS: string;
}
