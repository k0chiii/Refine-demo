// 認証の署名鍵（ES256 / P-256）を作る。
//   node scripts/auth-keygen.mjs            → 秘密鍵の JWK を 1 行の JSON で標準出力へ
// 本番:  node scripts/auth-keygen.mjs | pnpm exec wrangler secret put AUTH_PRIVATE_KEY_JWK
// 開発:  .dev.vars に AUTH_PRIVATE_KEY_JWK='<出力>' を書く（.dev.vars は gitignore 済み）
// 公開鍵は Worker が秘密鍵から作って /.well-known/jwks.json に出すので、ここでは出さない。
import { exportJWK, generateKeyPair } from "jose";

const { privateKey } = await generateKeyPair("ES256", { extractable: true });
console.log(JSON.stringify(await exportJWK(privateKey)));
