// 秘密（`wrangler secret put`）は wrangler types の Env に出ないので、ここで足す
interface Env {
  ACCESS_TEAM?: string;
  ACCESS_AUDIENCE?: string;
  // サービス間の共有秘密。未設定・短いときは、それで守られた関数ごと 404（src/serviceAuth.ts）
  MF100_UPLOAD_SECRET?: string;
  MF100_CLEANUP_SECRET?: string;
  PROCESSING_SECRET?: string;
}
