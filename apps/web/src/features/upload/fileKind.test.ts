import { describe, expect, it } from "vite-plus/test";
import { guessArtifactType, guessMimeType } from "./fileKind";

describe("提出ファイルの種類", () => {
  it("MIME が無い .md は Markdown の文章として扱う", () => {
    expect(guessMimeType("案内.md", "")).toBe("text/markdown");
    expect(guessArtifactType("案内.md", "")).toBe("document");
  });
  it("Word は文字として読めないので other", () => {
    expect(
      guessArtifactType(
        "a.docx",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      ),
    ).toBe("other");
  });
  it("PDF・画像・テキスト・HTML", () => {
    expect(guessArtifactType("a.pdf", "application/pdf")).toBe("pdf");
    expect(guessArtifactType("a.png", "image/png")).toBe("image");
    expect(guessArtifactType("a.txt", "text/plain")).toBe("document");
    expect(guessArtifactType("a.html", "")).toBe("document");
    expect(guessArtifactType("a.bin", "")).toBe("other");
  });
  it("動画（MIME が無い .mov も拡張子で）", () => {
    expect(guessArtifactType("cm.mp4", "video/mp4")).toBe("video");
    expect(guessArtifactType("cm.webm", "video/webm")).toBe("video");
    expect(guessMimeType("cm.MOV", "")).toBe("video/quicktime");
    expect(guessArtifactType("cm.mov", "")).toBe("video");
  });
});
