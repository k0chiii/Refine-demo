import { describe, expect, it } from "vite-plus/test";
import {
  createLimiter,
  dragHasFiles,
  filesFromClipboard,
  overallProgress,
  planAdd,
} from "./attachmentQueue";

const f = (name: string, size = 10) => ({ name, size });

describe("planAdd（足す計画）", () => {
  it("上限まで受け付け、超えた分は数えて断る", () => {
    const plan = planAdd([f("a")], [f("b"), f("c"), f("d")], 3);
    expect(plan.accepted.map((x) => x.name)).toEqual(["b", "c"]);
    expect(plan.overflow).toBe(1);
    expect(plan.duplicates).toEqual([]);
  });
  it("同じ名前・同じ大きさは重ねない。名前が同じでも大きさが違えば別のもの", () => {
    const plan = planAdd([f("a", 1)], [f("a", 1), f("a", 2), f("a", 2)], 10);
    expect(plan.accepted).toEqual([f("a", 2)]);
    expect(plan.duplicates).toHaveLength(2);
  });
  it("重複は上限の数に入れない", () => {
    const plan = planAdd([f("a")], [f("a"), f("b")], 2);
    expect(plan.accepted.map((x) => x.name)).toEqual(["b"]);
    expect(plan.overflow).toBe(0);
  });
});

describe("createLimiter（同時に走る数）", () => {
  it("同時には上限の数までしか走らず、頼んだ順に始める", async () => {
    const limit = createLimiter(2);
    let running = 0;
    let peak = 0;
    const started: number[] = [];
    const releases: Array<() => void> = [];
    const task = (n: number) =>
      limit(
        () =>
          new Promise<number>((resolve) => {
            started.push(n);
            running++;
            peak = Math.max(peak, running);
            releases.push(() => {
              running--;
              resolve(n);
            });
          }),
      );
    const flush = () => new Promise((r) => setTimeout(r, 0));
    const all = [task(1), task(2), task(3), task(4)];
    await flush();
    expect(started).toEqual([1, 2]);
    releases[0]!();
    await flush();
    expect(started).toEqual([1, 2, 3]);
    releases[1]!();
    await flush();
    expect(started).toEqual([1, 2, 3, 4]);
    releases[2]!();
    releases[3]!();
    expect(await Promise.all(all)).toEqual([1, 2, 3, 4]);
    expect(peak).toBe(2);
  });
  it("失敗しても次を始める", async () => {
    const limit = createLimiter(1);
    const a = limit(() => Promise.reject(new Error("x")));
    const b = limit(() => Promise.resolve("ok"));
    await expect(a).rejects.toThrow("x");
    expect(await b).toBe("ok");
  });
});

describe("貼り付け・ドロップ", () => {
  const file = new File([new Uint8Array(3)], "image.png", { type: "image/png" });
  it("画像だけが入っているクリップボードは取り込む", () => {
    expect(filesFromClipboard({ files: [file], getData: () => "" })).toEqual([file]);
  });
  it("文字も入っているとき（Word などからの貼り付け）は取り込まず、文字の貼り付けに任せる", () => {
    expect(filesFromClipboard({ files: [file], getData: () => "本文" })).toEqual([]);
  });
  it("ファイルが無ければ何もしない", () => {
    expect(filesFromClipboard({ files: [], getData: () => "" })).toEqual([]);
    expect(filesFromClipboard({ files: null })).toEqual([]);
  });
  it("ドラッグの中身がファイルのときだけ受ける", () => {
    expect(dragHasFiles(["text/plain", "Files"])).toBe(true);
    expect(dragHasFiles(["text/plain"])).toBe(false);
    expect(dragHasFiles(null)).toBe(false);
  });
});

describe("overallProgress", () => {
  it("完了は 1、送信中はその進み具合、失敗は数えない", () => {
    expect(
      overallProgress([
        { phase: "done", progress: 1 },
        { phase: "uploading", progress: 0.5 },
        { phase: "compressing", progress: 0 },
        { phase: "error", progress: 0 },
      ]),
    ).toBeCloseTo(0.5);
    expect(overallProgress([])).toBe(1);
    expect(overallProgress([{ phase: "error", progress: 0 }])).toBe(1);
  });
});
