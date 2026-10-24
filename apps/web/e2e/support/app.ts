import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test as base, expect, type Locator, type Page } from "@playwright/test";

/**
 * デモ版の画面を操る部品。e2e/screenshots.mjs の同名の関数を、spec から使えるように切り出したもの。
 * 画面の構造（M3E の部品・クラス名）に依存する知識はここに集め、spec は「誰が・何をして・どうなるか」だけを書く。
 * 画面が変わって壊れたら、まずここを直す（spec を書き換えて回るのではなく）
 */

export const FIXTURES = fileURLToPath(new URL("../fixtures/", import.meta.url));
export const fixture = (name: string) => resolve(FIXTURES, name);

/** デモのアカウント（apps/web/src/demo のシード） */
export type DemoUser =
  | "mock-nogiku-creator"
  | "mock-nogiku-reviewer"
  | "mock-nogiku-manager"
  | "mock-nogiku-approver"
  | "mock-nogiku-admin";

/** 制作物一覧の行（「局 › 担当」の入れ子のリストの項目） */
export const WORKS_ENTRY = ".works .works-table tbody tr";
/** シードの制作物 */
export const PAMPHLET = "MF100 公式パンフレット";
export const LONG_TITLE = "100nc_デザインガイドライン";
/** 提出前の確認（§58）。提出は止めないが、ふだんの提出に合わせて印を付けておく */
export const SELF_CHECKS = ["theme_font", "balance", "committee_output"] as const;

type Demo = {
  ensureSeeded(): Promise<void>;
  signIn(sub: string): Promise<void>;
  signOut(): Promise<void>;
  users(): Promise<{ sub: string; name: string }[]>;
};
type Router = { navigate(opts: { to: string; search?: Record<string, string> }): Promise<void> };
declare global {
  var __mf100demo: Demo | undefined;
  var __mf100router: Router | undefined;
}

export class App {
  constructor(readonly page: Page) {}

  /** サインイン画面を開き、デモのデータを用意する。各 spec の入口（データはページを読み直すたびに作り直される） */
  async start() {
    await this.page.goto("/signin");
    await this.ready();
    await this.page.evaluate(() => globalThis.__mf100demo!.ensureSeeded());
  }

  ready() {
    return this.page.waitForFunction(
      () => Boolean(globalThis.__mf100demo && globalThis.__mf100router),
      null,
      { timeout: 30_000 },
    );
  }

  /**
   * 画面が落ち着くまで待つ（2 フレーム経過し、有限の animation / transition が終わるまで。Shadow DOM 内も見る）。
   * M3E のメニューやダイアログは開閉の transition 中に押すと外れるので、その前に使う。
   * スクロール連動の animation（animation-timeline: scroll()）は終わらないので、document.timeline のものだけを見る
   */
  settle() {
    return this.page.evaluate(
      () =>
        new Promise<void>((done) => {
          const limit = performance.now() + 3000;
          const busy = () => {
            const roots: (Document | ShadowRoot)[] = [document];
            for (const r of roots)
              for (const el of r.querySelectorAll("*"))
                if (el.shadowRoot) roots.push(el.shadowRoot);
            return roots.some((r) =>
              r.getAnimations().some((a) => {
                const t = a.effect?.getComputedTiming();
                return (
                  a.timeline === document.timeline &&
                  a.playState === "running" &&
                  t !== undefined &&
                  t.iterations !== Infinity
                );
              }),
            );
          };
          const check = () =>
            !busy() || performance.now() > limit ? done() : requestAnimationFrame(check);
          requestAnimationFrame(() => requestAnimationFrame(check));
        }),
    );
  }

  /**
   * SPA 内で移動する（デモのデータはメモリ上にあるので page.goto で読み直すと消える）。
   * 校正画面を離れるときの「校正を完了しますか？」は「あとで」で閉じて進む
   */
  async go(path: string) {
    const page = this.page;
    const nav = page.evaluate(
      (p) => {
        const [to, q] = p.split("?");
        const search = q ? Object.fromEntries(new URLSearchParams(q)) : undefined;
        return globalThis.__mf100router!.navigate(search ? { to: to!, search } : { to: to! });
      },
      path.replace(/^https?:\/\/[^/]+/, ""),
    );
    let moved = false;
    const leave = page.locator("m3e-dialog[open]", { hasText: "校正を完了しますか？" });
    const watch = (async () => {
      while (!moved) {
        if (await leave.count()) {
          await leave.locator("m3e-button", { hasText: "あとで" }).click();
          return;
        }
        await page.waitForTimeout(100);
      }
    })();
    try {
      await nav;
    } finally {
      moved = true;
    }
    await watch;
    await this.settle();
  }

  /** 別の人としてサインインし直す（入口の振り分けが終わり /make・/check に着くまで待つ） */
  async signInAs(sub: DemoUser) {
    await this.page.evaluate(() => globalThis.__mf100demo!.signOut());
    await this.go("/signin");
    await this.page.evaluate(async (s) => {
      await globalThis.__mf100demo!.ensureSeeded();
      await globalThis.__mf100demo!.signIn(s);
    }, sub);
    await this.page.waitForURL((u) => ["/make", "/check"].includes(u.pathname), {
      timeout: 10_000,
    });
    await this.settle();
  }

  async user(sub: DemoUser) {
    const all = await this.page.evaluate(() => globalThis.__mf100demo!.users());
    const u = all.find((x) => x.sub === sub);
    if (!u) throw new Error(`デモのユーザーがいない: ${sub}`);
    return u;
  }

  btn(text: string) {
    return this.page.locator("m3e-button", { hasText: text }).first();
  }

  dialog() {
    return this.page.locator("m3e-dialog[open]");
  }

  /** ユーザー選択 UI（UserPicker）で名前を検索して 1 人（または 1 グループ）選ぶ */
  async pickUser(scope: Locator, name: string) {
    const input = scope.locator(".picker__input").first();
    await input.click();
    await input.fill(name);
    await this.page
      .getByRole("option", { name: new RegExp(name) })
      .first()
      .click();
    await this.settle();
  }

  /** PDF の最初のページが描かれるまで待つ */
  pdfReady() {
    return this.page.waitForFunction(
      () => (document.querySelector<HTMLCanvasElement>(".viewer__page canvas")?.width ?? 0) > 0,
      null,
      { timeout: 30_000 },
    );
  }

  /** 制作物一覧から題名で開き、そのパスを返す */
  async openWork(title: string) {
    await this.go("/works");
    const entry = this.page.locator(WORKS_ENTRY, { hasText: title }).first();
    await entry.click();
    await this.page.waitForURL(/\/works\/[^/]+$/);
    await this.settle();
    return new URL(this.page.url()).pathname;
  }

  /**
   * 版提出ダイアログを開いてファイルを置き、転送と検証が終わるまで待つ（確定はしない）。
   * beforeStart は「アップロードを開始」の前に入力を足すところ（専門確認・提出前の確認など）
   */
  async uploadRevision(
    buttonText: "最初の版を提出" | "新しい版を提出",
    files: string[],
    summary: string,
    beforeStart?: () => Promise<void>,
  ) {
    const page = this.page;
    await this.btn(buttonText).click();
    await page.waitForSelector('m3e-dialog[open] input[type="file"]');
    await page.setInputFiles('m3e-dialog[open] input[type="file"]', files);
    await page.fill("m3e-dialog[open] textarea >> nth=0", summary);
    if (beforeStart) await beforeStart();
    await this.dialog().locator("m3e-button", { hasText: "アップロードを開始" }).click();
    await expect(page.locator(".upload-item__state--verified")).toHaveCount(files.length, {
      timeout: 30_000,
    });
  }

  /** 提出前の確認（3 つ）に印を付ける */
  async tickSelfChecks() {
    for (const id of SELF_CHECKS)
      await this.dialog().locator(`m3e-checkbox#self-check-${id}`).click();
  }

  /** 提出を確定して、その版（/v/<n>）の紙面が描かれるまで待つ。版の URL を返す */
  async confirmRevision(n: number) {
    await this.dialog().locator("m3e-button", { hasText: "提出を確定する" }).click();
    await this.page.waitForURL(new RegExp(`/v/${n}$`), { timeout: 15_000 });
    await this.pdfReady();
    return new URL(this.page.url()).pathname;
  }

  /** エディタの引き出し（コメント／版／情報）を開く */
  async drawer(label: "コメント" | "版" | "情報") {
    const page = this.page;
    const bar = page.locator(".ws__side-toolbar");
    if (await bar.isVisible()) {
      await bar.locator(`m3e-icon-button[aria-label^="${label}"]`).click();
    } else {
      const tab = page.locator(".drawer .pane-tabs m3e-tab", { hasText: label }).first();
      if ((await tab.getAttribute("selected")) === null) await tab.click();
    }
    await page.waitForSelector(".drawer__body");
    await this.settle();
  }

  /** 紙面をなぞって（範囲）その場の投稿欄からコメントする。座標は紙面の幅・高さに対する割合 */
  async commentOnRect(x0: number, y0: number, x1: number, y1: number, body: string) {
    const page = this.page;
    const box = await page.locator(".viewer__overlay").first().boundingBox();
    if (!box) throw new Error("紙面が表示されていない");
    await page.mouse.move(box.x + box.width * x0, box.y + box.height * y0);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * x1, box.y + box.height * y1, { steps: 8 });
    await page.mouse.up();
    await this.send(body);
  }

  /** 位置なしのコメント（コメントの一覧の下の入口） */
  async freeComment(body: string) {
    await this.page.locator(".comments__free").click();
    await this.send(body);
  }

  private async send(body: string) {
    const page = this.page;
    await page.waitForSelector(".compose-pop .rt__content");
    await page.fill(".compose-pop .rt__content", body);
    await page.locator(".compose-pop .rt__send").click();
    await page.waitForSelector(".compose-pop", { state: "detached" });
  }

  /** コメントの一覧のカード（校正のコメント。先頭に留まる「制作者からのコメント」のカードは数えない） */
  threads() {
    return this.page.locator(".comments .thread:not(.thread--note)");
  }

  /** 一覧のカードの下の行を押してスレッドのパネルを開く */
  async openPanel(card: Locator) {
    await card.locator(".thread__footer").click();
    await this.page.waitForSelector(".thread-panel");
    await this.settle();
    return this.page.locator(".thread-panel");
  }

  /** アプリバーの「比べる」から版や操作を選ぶ（広い画面は Menu、compact は Bottom sheet） */
  async compareWith(label: string) {
    const page = this.page;
    const compact = (page.viewportSize()?.width ?? 1440) < 600;
    await page.locator('.shell__appbar m3e-icon-button[aria-label^="比べる"]').click();
    if (compact) await page.waitForSelector("m3e-bottom-sheet.compare-sheet[open]");
    else await page.waitForSelector("#compare-menu m3e-menu-item:visible");
    await this.settle();
    const item = compact
      ? page.locator("m3e-bottom-sheet.compare-sheet m3e-list-action", { hasText: label }).first()
      : page.locator("#compare-menu m3e-menu-item:visible", { hasText: label }).first();
    await item.click();
    await this.settle();
  }
}

/** spec の入口: `app` は新しいデモのデータでサインイン画面まで開いた状態で渡る */
export const test = base.extend<{ app: App }>({
  app: async ({ page }, use) => {
    page.on("pageerror", (e) => console.error("[pageerror]", e.message));
    const app = new App(page);
    await app.start();
    await use(app);
  },
});
export { expect };
