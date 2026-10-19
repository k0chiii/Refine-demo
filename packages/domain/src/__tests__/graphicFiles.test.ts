import { describe, expect, it } from "vite-plus/test";
import {
  artifactFormatLabel,
  assertGraphicHasReviewableFile,
  assertUploadSizeWithinLimit,
  hasPdfSignature,
  isGraphicSubmissionFile,
  markItemVerified,
  MAX_UPLOAD_BYTES,
  needsPdfSignatureCheck,
  normalizeDeclaredFile,
  PDF_SIGNATURE_WINDOW,
  pickReviewArtifact,
  resolveStoredType,
  type ArtifactType,
  type UploadItem,
} from "../index.ts";

const bytes = (s: string, pad = 0) =>
  new Uint8Array([
    ...Array.from({ length: pad }, () => 0x20),
    ...Array.from(s, (c) => c.charCodeAt(0) & 0xff),
  ]);

const a = (type: ArtifactType, fileName: string, role: "source" | "external" = "source") => ({
  type,
  role,
  fileName,
});

describe("PDF の見分け（.ai の PDF 互換）", () => {
  it("先頭が %PDF- なら PDF", () => {
    expect(hasPdfSignature(bytes("%PDF-1.6\n%âãÏÓ"))).toBe(true);
  });
  it("見出しの前に少し余白があってもよい（先頭 1024 バイトまで）", () => {
    expect(hasPdfSignature(bytes("%PDF-1.7", 100))).toBe(true);
    expect(hasPdfSignature(bytes("%PDF-1.7", PDF_SIGNATURE_WINDOW - 5))).toBe(true);
    expect(hasPdfSignature(bytes("%PDF-1.7", PDF_SIGNATURE_WINDOW - 4))).toBe(false);
  });
  it("PostScript 始まり・空・短い実体は PDF ではない", () => {
    expect(hasPdfSignature(bytes("%!PS-Adobe-3.0 EPSF-3.0"))).toBe(false);
    expect(hasPdfSignature(new Uint8Array())).toBe(false);
    expect(hasPdfSignature(bytes("%PDF"))).toBe(false);
  });
  it("実体の先頭を見るのは .ai だけ", () => {
    expect(needsPdfSignatureCheck("poster.AI")).toBe(true);
    expect(needsPdfSignatureCheck("poster.indd")).toBe(false);
    expect(needsPdfSignatureCheck("poster.pdf")).toBe(false);
  });
});

describe("グラフィック制作物で受けるファイル", () => {
  it("PDF・画像・Illustrator・InDesign を受ける（MIME が空・別物でも拡張子で）", () => {
    for (const f of [
      { fileName: "a.pdf", mimeType: "application/pdf" },
      { fileName: "a.png", mimeType: "image/png" },
      { fileName: "a.ai", mimeType: "" },
      { fileName: "a.AI", mimeType: "application/postscript" },
      { fileName: "a.indd", mimeType: "application/octet-stream" },
    ])
      expect(isGraphicSubmissionFile(f)).toBe(true);
  });
  it("動画・圧縮ファイルなどは受けない", () => {
    expect(isGraphicSubmissionFile({ fileName: "a.mp4", mimeType: "video/mp4" })).toBe(false);
    expect(isGraphicSubmissionFile({ fileName: "a.zip", mimeType: "application/zip" })).toBe(false);
  });
  it(".ai / .indd は拡張子から MIME と種類 other に正す（それ以外は申告のまま）", () => {
    expect(
      normalizeDeclaredFile({ fileName: "a.ai", mimeType: "application/pdf", type: "pdf" }),
    ).toEqual({ fileName: "a.ai", mimeType: "application/illustrator", type: "other" });
    expect(
      normalizeDeclaredFile({ fileName: "a.indd", mimeType: "", type: "other" }).mimeType,
    ).toBe("application/x-indesign");
    const pdf = { fileName: "a.pdf", mimeType: "application/pdf", type: "pdf" as const };
    expect(normalizeDeclaredFile(pdf)).toBe(pdf);
  });
});

describe("検証後の種類（.ai は PDF 互換と確かめられたときだけ PDF）", () => {
  it("PDF 互換の .ai は pdf、そうでなければ other。ほかのファイルは申告のまま", () => {
    expect(resolveStoredType({ fileName: "a.ai", type: "other" }, true)).toBe("pdf");
    expect(resolveStoredType({ fileName: "a.ai", type: "other" }, false)).toBe("other");
    // 見ていない（互換と確かめていない）なら申告が pdf でも紙面には出さない
    expect(resolveStoredType({ fileName: "a.ai", type: "pdf" }, undefined)).toBe("other");
    expect(resolveStoredType({ fileName: "a.indd", type: "other" }, true)).toBe("other");
    expect(resolveStoredType({ fileName: "a.pdf", type: "pdf" }, undefined)).toBe("pdf");
  });
  it("項目の検証完了で種類が決まり、元のファイル名が残る", () => {
    const item: UploadItem = {
      id: "i1",
      sessionId: "s1",
      fileName: "poster.ai",
      mimeType: "application/illustrator",
      type: "other",
      role: "source",
      keyPrefix: "k",
      status: "pending",
    };
    const meta = { size: 10, sha256: "x", objectKey: "k/attempts/1" };
    const ok = markItemVerified(item, { ...meta, pdfCompatible: true });
    expect(ok).toMatchObject({ status: "verified", type: "pdf", fileName: "poster.ai" });
    expect(markItemVerified(item, { ...meta, pdfCompatible: false }).type).toBe("other");
  });
});

describe("紙面に出す添付（PDF・画像・.ai・.indd の組み合わせ）", () => {
  const aiPdf = a("pdf", "poster.ai");
  const indd = a("other", "poster.indd");
  const ai = a("other", "poster.ai");
  it("ふつうの PDF があれば、PDF 互換の .ai が先に並んでいても PDF", () => {
    const pdf = a("pdf", "poster.pdf");
    expect(pickReviewArtifact([aiPdf, indd, pdf])).toBe(pdf);
    expect(pickReviewArtifact([pdf, aiPdf])).toBe(pdf);
  });
  it("画像があれば PDF 互換の .ai より画像", () => {
    const img = a("image", "poster.png");
    expect(pickReviewArtifact([aiPdf, img])).toBe(img);
  });
  it("PDF も画像も無ければ、PDF 互換の .ai を紙面に出す。.indd は選ばない", () => {
    expect(pickReviewArtifact([indd, aiPdf])).toBe(aiPdf);
  });
  it("紙面に出せるものが無ければ外部リンク以外の最初（ダウンロードのみ）", () => {
    expect(pickReviewArtifact([indd, ai])).toBe(indd);
  });
  it("PDF 互換の .ai は PDF と呼び分け、.indd は InDesign と呼ぶ", () => {
    expect(artifactFormatLabel(aiPdf)).not.toBe(artifactFormatLabel(a("pdf", "poster.pdf")));
    expect(artifactFormatLabel(aiPdf)).toContain("Illustrator");
    expect(artifactFormatLabel(indd)).toBe("InDesign");
  });
});

describe("グラフィック制作物は紙面に出せるファイルが要る（確定のとき）", () => {
  const code = (c: string) => expect.objectContaining({ code: c });
  it(".indd だけ・PDF 互換でない .ai だけでは確定しない（書き出した PDF か画像が要る）", () => {
    for (const mediaType of ["pdf", "image"]) {
      expect(() => assertGraphicHasReviewableFile(mediaType, [a("other", "p.indd")])).toThrow(
        code("revision_no_reviewable_file"),
      );
      expect(() =>
        assertGraphicHasReviewableFile(mediaType, [a("other", "p.ai"), a("other", "p.indd")]),
      ).toThrow(code("revision_no_reviewable_file"));
    }
  });
  it("外部リンクは数えない", () => {
    expect(() =>
      assertGraphicHasReviewableFile("pdf", [
        a("other", "p.indd"),
        a("external_link", "https://example.com", "external"),
      ]),
    ).toThrow(code("revision_no_reviewable_file"));
  });
  it("PDF・画像・PDF 互換の .ai があれば確定できる", () => {
    expect(() =>
      assertGraphicHasReviewableFile("pdf", [a("other", "p.indd"), a("pdf", "p.pdf")]),
    ).not.toThrow();
    expect(() =>
      assertGraphicHasReviewableFile("image", [a("other", "p.indd"), a("image", "p.png")]),
    ).not.toThrow();
    expect(() =>
      assertGraphicHasReviewableFile("pdf", [a("other", "p.indd"), a("pdf", "p.ai")]),
    ).not.toThrow();
  });
  it("グラフィック以外の媒体には課さない", () => {
    for (const mediaType of ["video", "web", "figma", "document", "sns", "other", undefined])
      expect(() => assertGraphicHasReviewableFile(mediaType, [a("other", "p.indd")])).not.toThrow();
  });
});

describe("1 ファイルの大きさの上限", () => {
  it("上限ちょうどまでは通り、超えると upload_file_too_large", () => {
    expect(() => assertUploadSizeWithinLimit("a.ai", MAX_UPLOAD_BYTES)).not.toThrow();
    expect(() => assertUploadSizeWithinLimit("a.ai", undefined)).not.toThrow();
    expect(() => assertUploadSizeWithinLimit("a.ai", MAX_UPLOAD_BYTES + 1)).toThrow(
      expect.objectContaining({ code: "upload_file_too_large" }),
    );
  });
  it("数十 MB の原本は通る", () => {
    expect(() => assertUploadSizeWithinLimit("poster.indd", 80_000_000)).not.toThrow();
  });
});
