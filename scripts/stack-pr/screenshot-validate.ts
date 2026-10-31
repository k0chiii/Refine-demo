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
  "02-works-list": ["MF100 公式パンフレット"],
  "27-make-creator": ["進行中"],
  "28-check-reviewer": ["校正"],
  "33-work-form": ["制作物を登録"],
  "34-acl": ["閲覧権限"],
  "dashboard-manager": ["制作物の状況"],
  "dashboard-manager-mobile": ["制作物の状況"],
  "dashboard-approver": ["MF100 公式パンフレット"],
  "dashboard-member": ["進行中"],
  "dashboard-detail": ["未提出"],
  "08-workspace-comment": ["コメント"],
  "076-before-editor": ["MF100 公式パンフレット"],
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
      const selfBase = path.basename(opts.selfPath ?? filePath);
      const pairedDesktop =
        selfBase.endsWith("-desktop.png") &&
        others.some((p) => {
          const o = path.basename(p);
          return (
            (selfBase.startsWith("after-") && o === selfBase.replace("after-", "before-")) ||
            (selfBase.startsWith("before-") && o === selfBase.replace("before-", "after-"))
          );
        });
      const paired = others.some((p) => {
        const o = path.basename(p);
        const mobilePair =
          selfBase.endsWith("-mobile.png") &&
          o.endsWith("-mobile.png") &&
          selfBase.startsWith("after") !== o.startsWith("after");
        if (mobilePair) {
          const dir = path.dirname(filePath);
          const desk = (tag: string) => {
            const f = path.join(dir, `${tag}-desktop.png`);
            return fs.existsSync(f) ? md5File(f) : null;
          };
          const b = desk("before");
          const a = desk("after");
          return b !== null && a !== null && b !== a;
        }
        return false;
      });
      if (!paired && !pairedDesktop) {
        throw new Error(`duplicate md5 ${md5} on ${filePath} (also ${others[0]})`);
      }
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

/** 撮影時に DOM 上でマーカーが見えたことを sidecar に残す */
export async function writeSceneDomSidecar(
  page: import("playwright").Page,
  sceneKey: string,
  pngPath: string,
): Promise<string> {
  const markers = SCENE_MARKERS[sceneKey] ?? [];
  const lines: string[] = [
    `capturedAt=${new Date().toISOString()}`,
    `url=${page.url()}`,
    `scene=${sceneKey}`,
  ];
  for (const text of markers) {
    const loc = page.getByText(text, { exact: false }).first();
    const ok = await loc.isVisible().catch(() => false);
    const snippet = ok
      ? (await loc.innerText().catch(() => text)).replace(/\s+/g, " ").trim().slice(0, 240)
      : "MISSING";
    lines.push(`marker:${text}=${snippet}`);
  }
  const body = `${lines.join("\n")}\n`;
  const sidecar = pngPath.replace(/\.png$/i, ".dom.txt");
  fs.writeFileSync(sidecar, body, "utf8");
  for (const text of markers) {
    if (!body.includes(`marker:${text}=`) || body.includes(`marker:${text}=MISSING`)) {
      throw new Error(`dom sidecar missing marker "${text}" for ${pngPath}`);
    }
  }
  return sidecar;
}

export function validateDomSidecar(pngPath: string, sceneKey: string): void {
  const sidecar = pngPath.replace(/\.png$/i, ".dom.txt");
  if (!fs.existsSync(sidecar)) throw new Error(`missing dom sidecar ${sidecar}`);
  const body = fs.readFileSync(sidecar, "utf8");
  const markers = SCENE_MARKERS[sceneKey] ?? [];
  for (const text of markers) {
    if (body.includes(`marker:${text}=MISSING`)) {
      throw new Error(`dom sidecar marker missing: ${text} in ${sidecar}`);
    }
  }
}
