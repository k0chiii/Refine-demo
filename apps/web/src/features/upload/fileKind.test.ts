import { describe, expect, it } from "vite-plus/test";
import { guessArtifactType, guessMimeType, sniffPdfCompatible } from "./fileKind";

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

describe("Illustrator・InDesign（グラフィック制作物）", () => {
  it("MIME はブラウザの申告ではなく拡張子で決める（postscript・pdf・空でも）", () => {
    expect(guessMimeType("a.ai", "")).toBe("application/illustrator");
    expect(guessMimeType("a.AI", "application/postscript")).toBe("application/illustrator");
    expect(guessMimeType("a.ai", "application/pdf")).toBe("application/illustrator");
    expect(guessMimeType("a.indd", "application/octet-stream")).toBe("application/x-indesign");
  });
  it("種類は other（.ai が PDF としてプレビューに出せるかは実体の先頭を見て決める）", () => {
    expect(guessArtifactType("a.ai", "application/pdf")).toBe("other");
    expect(guessArtifactType("a.indd", "")).toBe("other");
  });
  it("PDF 互換の .ai は先頭の見出しで見分ける", async () => {
    const file = (text: string) => new File([text], "a.ai");
    expect(await sniffPdfCompatible(file("%PDF-1.6\n%AI9"))).toBe(true);
    expect(await sniffPdfCompatible(file("%!PS-Adobe-3.0"))).toBe(false);
    expect(await sniffPdfCompatible(file(""))).toBe(false);
  });
});
