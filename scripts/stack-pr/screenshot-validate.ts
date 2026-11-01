import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { Page } from "../../apps/web/e2e/support/app.ts";

/** サインイン画面だけの PNG（禁止） */
export const SIGNIN_SCREEN_MD5 = "ac741f735c6593b5cbdc397deb4a8004";

/** 監査で検出した再利用 PNG（禁止） */
export const BANNED_MD5_PREFIXES = [
  "eb1139a2", // #170 after 旧再利用
  "ac741f73", // sign-in
] as const;

/** 青帯+黄四角プレースホルダー等の典型サイズ（禁止） */
export const PLACEHOLDER_MAX_BYTES = 4096;

export const MIN_SCREENSHOT_BYTES = 30 * 1024;
export const MIN_CLIP_SCREENSHOT_BYTES = 4 * 1024;

/** 画面ごとに DOM 上で必須の部分一致文言（Playwright getByText 相当） */
export const SCENE_MARKERS: Record<string, readonly string[]> = {
  "01-signin": ["校正システム", "サインイン"],
  "02-works-list": [],
  "27-make-creator": ["進行中"],
  "28-check-reviewer": ["校正"],
  "33-work-form": ["制作物を登録"],
  "q63b-admin-csv": ["CSV で一括登録"],
  "q63b-admin-register": ["登録"],
  "q63b-works-chip": ["進行中"],
  "q63b-works-dashboard": ["制作物の状況"],
  "q63b-editor-toolbar": ["MF100 公式パンフレット"],
  "q63b-admin-tab": ["担当"],
  "12-submit-dialog": ["版を提出"],
  "34-acl": ["閲覧権限"],
  "dashboard-manager": ["制作物の状況"],
  "dashboard-kpi-summary": ["制作物の状況"],
  "dashboard-bureau-graphs": ["制作物の状況"],
  "make-sns-band": ["進行中"],
  "dashboard-manager-mobile": ["制作物の状況"],
  "dashboard-approver": ["MF100 公式パンフレット"],
  "dashboard-member": ["進行中"],
  "dashboard-detail": ["未提出"],
  "08-workspace-comment": ["コメント"],
  "076-before-editor": ["MF100 公式パンフレット"],
  "e090-before": ["全体へのコメント"],
  "e090-after": ["全体コメント", "キャンセル"],
  "e090-after-mobile": ["キャンセル"],
  "e090-after-video-c": ["位置なし", "キャンセル"],
  "09-decision": ["コメント"],
  "editor-comments-header": [],
  "editor-comments-q66": ["解決済みを表示"],
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
  /** 要素クリップのときは最小サイズを緩める */
  allowSmallClip?: boolean;
};

/** 撮影直後: サインイン画面のまま／ログイン URL なら失敗 */
export async function assertAuthenticatedCapture(page: Page): Promise<void> {
  const url = new URL(page.url());
  const path = url.pathname;
  if (path.includes("/signin") || path === "/login") {
    throw new Error(`capture still on auth URL ${path}`);
  }
  const mockSignIn = page.getByRole("button", { name: "モックでサインイン" });
  if (await mockSignIn.isVisible().catch(() => false)) {
    throw new Error("capture shows mock sign-in button");
  }
  const heading = page.getByRole("heading", { name: /サインイン/ });
  if (await heading.isVisible().catch(() => false)) {
    throw new Error("capture shows sign-in heading");
  }
}

export function assertBeforeAfterDistinct(beforePath: string, afterPath: string): void {
  if (!fs.existsSync(beforePath) || !fs.existsSync(afterPath)) return;
  const a = md5File(beforePath);
  const b = md5File(afterPath);
  if (a === b) {
    throw new Error(`before and after identical md5 ${a} (${beforePath} vs ${afterPath})`);
  }
}

export function validateScreenshotFile(filePath: string, opts: ValidateOpts): void {
  if (!fs.existsSync(filePath)) throw new Error(`missing screenshot ${filePath}`);
  const stat = fs.statSync(filePath);
  if (stat.size <= PLACEHOLDER_MAX_BYTES) {
    throw new Error(`placeholder-sized png (${stat.size} bytes) ${filePath}`);
  }
  const minBytes = opts.allowSmallClip ? MIN_CLIP_SCREENSHOT_BYTES : MIN_SCREENSHOT_BYTES;
  if (stat.size < minBytes) {
    throw new Error(`too small (${stat.size} < ${minBytes}) ${filePath}`);
  }
  const md5 = md5File(filePath);
  if (md5 === SIGNIN_SCREEN_MD5) {
    throw new Error(`signin md5 on ${filePath}`);
  }
  for (const prefix of BANNED_MD5_PREFIXES) {
    if (md5.startsWith(prefix)) {
      throw new Error(`banned md5 prefix ${prefix} on ${filePath}`);
    }
  }
  if (opts.pagePath.includes("/signin")) {
    throw new Error(`signin URL ${opts.pagePath} for ${filePath}`);
  }
  if (opts.corpusRoot) {
    const idx = indexPngMd5(opts.corpusRoot);
    const others = (idx.get(md5) ?? []).filter(
      (p) => path.resolve(p) !== path.resolve(opts.selfPath ?? filePath),
    );
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

export async function assertSceneMarkers(page: Page, sceneKey: string): Promise<void> {
  const markers = SCENE_MARKERS[sceneKey];
  if (!markers?.length) return;
  for (const text of markers) {
    await page
      .getByText(text, { exact: false })
      .first()
      .waitFor({ state: "visible", timeout: 60_000 });
  }
}

/** 撮影時に DOM 上でマーカーが見えたことを sidecar に残す */
export async function writeSceneDomSidecar(
  page: Page,
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
  assertDomSidecarClean(sidecar, body);
}

/** DOM sidecar / 撮影後チェック: プレースホルダ・bot 警告を禁止 */
export function assertDomSidecarClean(sidecarPath: string, body?: string): void {
  const text = body ?? fs.readFileSync(sidecarPath, "utf8");
  const lower = text.toLowerCase();
  if (lower.includes("not found")) {
    throw new Error(`dom sidecar contains "not found": ${sidecarPath}`);
  }
  if (text.includes("見つかりません")) {
    throw new Error(`dom sidecar contains 見つかりません: ${sidecarPath}`);
  }
  const missingMarkers = [...text.matchAll(/marker:[^=]+=MISSING/g)];
  if (missingMarkers.length > 0) {
    throw new Error(`dom sidecar has MISSING markers: ${sidecarPath}`);
  }
  const warnMatch = text.match(/forbidden:plan-info-warnings=(\d+)/);
  if (warnMatch && Number(warnMatch[1]) > 0) {
    const allowWarnBeforeRecheck =
      /before-recheck/i.test(sidecarPath) || /before-recheck/i.test(text);
    if (!allowWarnBeforeRecheck) {
      throw new Error(`plan-info warnings still visible (${warnMatch[1]}) in ${sidecarPath}`);
    }
  }
  const nfMatch = text.match(/forbidden:not-found=(\d+)/);
  if (nfMatch && Number(nfMatch[1]) > 0) {
    throw new Error(`not-found warnings still visible (${nfMatch[1]}) in ${sidecarPath}`);
  }
}

export function assertPngPairValidated(beforePath: string, afterPath: string, corpusRoot?: string): void {
  assertBeforeAfterDistinct(beforePath, afterPath);
  for (const p of [beforePath, afterPath]) {
    if (!fs.existsSync(p)) throw new Error(`missing ${p}`);
    const allowSmallClip = fs.statSync(p).size < MIN_SCREENSHOT_BYTES;
    validateScreenshotFile(p, {
      sceneKey: "pair",
      pagePath: "/works",
      corpusRoot,
      selfPath: p,
      allowSmallClip,
    });
    validateDomSidecar(p, "pair");
  }
}

/** ディレクトリ内の before/after PNG ペアをすべて検証 */
export function assertAllBeforeAfterPairs(root: string, corpusRoot?: string): void {
  if (!fs.existsSync(root)) return;
  const walk = (dir: string) => {
    const ents = fs.readdirSync(dir, { withFileTypes: true });
    const pngs = ents.filter((e) => e.isFile() && e.name.endsWith(".png")).map((e) => e.name);
    for (const name of pngs) {
      if (!name.includes("before")) continue;
      const afterName = name.replace("before", "after");
      if (!pngs.includes(afterName)) continue;
      assertPngPairValidated(path.join(dir, name), path.join(dir, afterName), corpusRoot ?? root);
    }
    for (const ent of ents) {
      if (ent.isDirectory()) walk(path.join(dir, ent.name));
    }
  };
  walk(root);
}
