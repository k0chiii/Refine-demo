// 秘密（`wrangler secret put`）は wrangler types の Env に出ないので、ここで足す
interface Env {
  ACCESS_TEAM?: string;
  ACCESS_AUDIENCE?: string;
}
