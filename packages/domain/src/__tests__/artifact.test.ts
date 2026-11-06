import { describe, expect, it } from "vite-plus/test";
import { artifactFormatLabel, isReviewableArtifact, pickReviewArtifact } from "../index.ts";

const a = (
  type: "pdf" | "image" | "document" | "video" | "other" | "external_link",
  fileName: string,
  role: "source" | "external" = "source",
) => ({
  type,
  role,
  fileName,
});

describe("紙面に出す添付（PDF と .ai を一緒に出す画像の制作物）", () => {
  it("提出の順番によらず PDF を選ぶ", () => {
    const ai = a("other", "poster.ai");
    const pdf = a("pdf", "poster.pdf");
    expect(pickReviewArtifact([ai, pdf])).toBe(pdf);
  });
  it("PDF → 画像 → 文章 の順", () => {
    const img = a("image", "p.png");
    const doc = a("document", "p.txt");
    expect(pickReviewArtifact([doc, img])).toBe(img);
    expect(pickReviewArtifact([doc, a("other", "x.ai")])).toBe(doc);
  });
  it("紙面に出せる添付が無ければ外部リンク以外の最初", () => {
    const ai = a("other", "poster.ai");
    expect(pickReviewArtifact([a("external_link", "https://x", "external"), ai])).toBe(ai);
    expect(pickReviewArtifact([a("external_link", "https://x", "external")])).toBeNull();
  });
  it("動画は PDF・画像・文章の次。動画の制作物（prefer）なら表紙の画像や絵コンテの PDF より先に動画", () => {
    const mp4 = a("video", "cm.mp4");
    const cover = a("image", "cover.png");
    const board = a("pdf", "board.pdf");
    expect(pickReviewArtifact([mp4, cover])).toBe(cover);
    expect(pickReviewArtifact([mp4, a("other", "cm.prproj")])).toBe(mp4);
    expect(pickReviewArtifact([board, cover, mp4], "video")).toBe(mp4);
    expect(pickReviewArtifact([board, cover], "video")).toBe(board);
  });
  it("紙面に出せるのは PDF・画像・文章・動画だけ", () => {
    expect(isReviewableArtifact(a("pdf", "a.pdf"))).toBe(true);
    expect(isReviewableArtifact(a("video", "a.mp4"))).toBe(true);
    expect(isReviewableArtifact(a("other", "a.ai"))).toBe(false);
    expect(isReviewableArtifact(a("external_link", "x", "external"))).toBe(false);
  });
  it("形式の呼び名", () => {
    expect(artifactFormatLabel(a("other", "poster.AI"))).toBe("Illustrator");
    expect(artifactFormatLabel(a("pdf", "p.pdf"))).toBe("PDF");
    expect(artifactFormatLabel(a("video", "cm.mov"))).toBe("動画");
    expect(artifactFormatLabel(a("other", "data.zip"))).toBe("ZIP");
    expect(artifactFormatLabel(a("other", "noext"))).toBe("ファイル");
  });
});
