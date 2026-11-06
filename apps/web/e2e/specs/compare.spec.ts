import { expect, test } from "../support/app";
import { submitFirstRevision, submitNextRevision } from "../support/scenarios";

// 旧 screenshots.mjs の 25・25a（版の比較）
test.describe("版の比較", { tag: "@core" }, () => {
  test("第2版を開いて「比べる」から第1版を選ぶと、2 つの版が左右に描かれ、やめると戻る", async ({
    app,
    page,
  }) => {
    await submitFirstRevision(app);
    await submitNextRevision(app, 2);

    await app.compareWith("第1版");
    const panes = page.locator(".compare__pane");
    await expect(panes).toHaveCount(2);
    await expect
      .poll(() =>
        panes.evaluateAll((ps) =>
          ps.every(
            (p) => (p.querySelector<HTMLCanvasElement>(".viewer__page canvas")?.width ?? 0) > 0,
          ),
        ),
      )
      .toBe(true);

    await app.compareWith("比べるのをやめる");
    await expect(panes).toHaveCount(0);
  });
});
