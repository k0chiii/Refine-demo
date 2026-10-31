import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

/** サインイン画面だけの PNG（禁止） */
export const SIGNIN_SCREEN_MD5 = "ac741f735c6593b5cbdc397deb4a8004";

/** 青帯+黄四角プレースホルダー等の典型サイズ（禁止） */
export const PLACEHOLDER_MAX_BYTES = 4096;

export const MIN_SCREENSHOT_BYTES = 30 * 1024;

/** 画面ごとに DOM 上で必須の部分一致文言（Playwright getByText 相当） */
export const SCENE_MARKERS: Record<string, readonly string[]> = {
  "01-signin": ["校正システム", "サインイン"],
  "02-works-list": [],
  "27-make-creator": ["制作"],
  "28-check-reviewer": ["校正"],
  "33-work-form": ["制作物を登録"],
  "34-acl": ["制作物"],
  "dashboard-manager": ["制作物の状況"],
  "dashboard-manager-mobile": ["制作物の状況"],
  "dashboard-approver": ["校正"],
  "dashboard-member": ["進行中"],
  "dashboard-detail": ["コメント"],
  "08-workspace-comment": ["コメント"],
  "09-decision": ["コメント"],
};

export function md5File(file: string): string {
  return createHash("md5").update(fs.readFileSync(file)).digest("hex");
}

/** docs/stack-pr-screenshots 以下の md5 → ファイルパス（複数可） */
export function indexPngMd5(root: string): Map<string, string[]> {
  const map = new Map<string, string[]>();
  if (!fs.existsSync(root)) return map;
  const walk = (dir: string) => {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, ent.name);
      if (ent.isDirectory()) walk(p);
      else if (ent.name.endsWith(".png")) {
        const h = md5File(p);
        map.set(h, [...(map.get(h) ?? []), p]);
      }
    }
  };
  walk(root);
  return map;
}

export type ValidateOpts = {
  sceneKey: string;
  pagePath: string;
  /** 自分自身を除いて md5 重複を禁止 */
  corpusRoot?: string;
  selfPath?: string;
};

export function validateScreenshotFile(filePath: string, opts: ValidateOpts): void {
  if (!fs.existsSync(filePath)) throw new Error(`missing screenshot ${filePath}`);
  const stat = fs.statSync(filePath);
  if (stat.size <= PLACEHOLDER_MAX_BYTES) {
    throw new Error(`placeholder-sized png (${stat.size} bytes) ${filePath}`);
  }
  if (stat.size < MIN_SCREENSHOT_BYTES) {
    throw new Error(`too small (${stat.size} < ${MIN_SCREENSHOT_BYTES}) ${filePath}`);
  }
  const md5 = md5File(filePath);
  if (md5 === SIGNIN_SCREEN_MD5) {
    throw new Error(`signin md5 on ${filePath}`);
  }
  if (opts.pagePath.includes("/signin")) {
    throw new Error(`signin URL ${opts.pagePath} for ${filePath}`);
  }
  if (opts.corpusRoot) {
    const idx = indexPngMd5(opts.corpusRoot);
    const others = (idx.get(md5) ?? []).filter((p) => path.resolve(p) !== path.resolve(opts.selfPath ?? filePath));
    if (others.length > 0) {
      throw new Error(`duplicate md5 ${md5} on ${filePath} (also ${others[0]})`);
    }
  }
}

export async function assertSceneMarkers(page: import("playwright").Page, sceneKey: string): Promise<void> {
  const markers = SCENE_MARKERS[sceneKey];
  if (!markers?.length) return;
  for (const text of markers) {
    await page.getByText(text, { exact: false }).first().waitFor({ state: "visible", timeout: 60_000 });
  }
}
