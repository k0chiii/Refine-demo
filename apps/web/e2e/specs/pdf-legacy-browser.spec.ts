import { expect, test } from "../support/app";
import { submitFirstRevision } from "../support/scenarios";

/**
 * 少し古いブラウザでも PDF が描ける（features/annotation/pdfjs.ts が PDF.js の legacy ビルドを使う理由）。
 * PDF.js の modern ビルドは読み込んだ瞬間に `Iterator` グローバル（Safari 18.4 以降・Chrome 122 以降）を触り、
 * それより古い端末では PDF が一切描けなかった（2026-10-23 〜 25）。Chromium から `Iterator` を外して、その端末を模す。
 * ワーカー側（`Uint8Array.prototype.toHex`）は Playwright から外せないので、ここでは確かめない
 */
test.describe("古いブラウザでの PDF", { tag: "@core" }, () => {
  test("Iterator の無いブラウザでも、提出した版の PDF が描ける", async ({ app, page }) => {
    await page.addInitScript(() => {
      // @ts-expect-error 模擬: Safari 18.3 以前・Chrome 121 以前には Iterator が無い
      delete globalThis.Iterator;
    });
    // 提出の確定で最初のページが描かれるまで待つ（描けなければここで止まる）。
    // 描けたあとは legacy ビルドが Iterator を埋めているので、ここで typeof を確かめても模擬の証にはならない
    await submitFirstRevision(app);
    await expect(page.locator(".viewer .alert")).toHaveCount(0);
    expect(
      await page.evaluate(
        () => document.querySelector<HTMLCanvasElement>(".viewer__page canvas")?.width ?? 0,
      ),
    ).toBeGreaterThan(0);
  });
});
