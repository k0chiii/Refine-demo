import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

/** 誤ってサインイン画面だけ撮ったときの PNG（大地さん指摘） */
export const SIGNIN_SCREEN_MD5 = "ac741f735c6593b5cbdc397deb4a8004";

const scriptRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");
const repoRoot = process.env.STACK_PR_REPO ?? scriptRoot;

function runCapture(payload) {
  const req = path.join(os.tmpdir(), `mf100-capture-${process.pid}-${Date.now()}.json`);
  fs.writeFileSync(req, JSON.stringify(payload));
  const port = String(4200 + (Date.now() % 200));
  const r = spawnSync("pnpm", ["dlx", "tsx", "scripts/stack-pr/capture-cli.ts", req], {
    cwd: scriptRoot,
    stdio: "inherit",
    env: {
      ...process.env,
      STACK_PR_REPO: repoRoot,
      CAPTURE_PORT: port,
      BASE_URL: `http://127.0.0.1:${port}`,
      CHROMIUM_PATH: process.env.CHROMIUM_PATH ?? "/usr/bin/google-chrome",
    },
  });
  fs.unlinkSync(req);
  if (r.status !== 0) throw new Error("capture failed");
}

/** App (`apps/web/e2e/support/app.ts` の signInAs / go) + build:demo + signin md5/URL ガード。実装は capture.ts */
export async function captureShots(shots, prefix, opts = {}) {
  runCapture({ shots, prefix, opts });
}

export function assertNotSigninScreenshot() {
  /* validation runs inside capture.ts */
}
