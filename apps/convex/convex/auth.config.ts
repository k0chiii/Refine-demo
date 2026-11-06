/**
 * Convex Auth（@convex-dev/auth）が発行する JWT を Convex が検証するための設定。UniQ と同一。
 * CONVEX_SITE_ORIGIN（= CONVEX_SITE_URL）は Convex ダッシュボードの環境変数として設定する。
 */
export default {
  providers: [
    {
      domain: process.env.CONVEX_SITE_ORIGIN,
      applicationID: "convex",
    },
  ],
};
