import { describe, expect, it } from "vite-plus/test";
import { fitWithin } from "./fitWithin";

describe("fitWithin（OCR に渡す画像の大きさ）", () => {
  it("長辺が上限以下ならそのまま", () => {
    expect(fitWithin(800, 600, 3000)).toEqual({ width: 800, height: 600 });
    expect(fitWithin(3000, 2000, 3000)).toEqual({ width: 3000, height: 2000 });
  });

  it("長辺が上限を超えたら、縦横比を保って長辺を上限に縮める", () => {
    expect(fitWithin(4032, 3024, 3000)).toEqual({ width: 3000, height: 2250 });
    expect(fitWithin(1080, 7200, 3000)).toEqual({ width: 450, height: 3000 });
  });

  it("極端に細長くても短辺は 1 px 以上", () => {
    expect(fitWithin(60000, 10, 3000)).toEqual({ width: 3000, height: 1 });
  });
});
