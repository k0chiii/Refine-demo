import type { PDFDocumentProxy } from "pdfjs-dist";
import { describe, expect, it, vi } from "vite-plus/test";
import { pdfFeatures, type PdfPageFeature } from "./pdfFeatures";

/** 指紋とページ数だけ持つ PDF 文書のつもり */
const docOf = (fingerprint: string, numPages: number) =>
  ({ fingerprints: [fingerprint, null], numPages }) as unknown as PDFDocumentProxy;

const extract = vi.fn(async (doc: PDFDocumentProxy, n: number): Promise<PdfPageFeature> => ({
  page: n,
  text: `${doc.fingerprints[0]}:${n}`,
  lines: [],
  items: [],
}));

describe("pdfFeatures のキャッシュ", () => {
  it("同じ添付 ID でも別の文書が来たら、前の文書の特徴を返さない（比べる相手を替えた直後の描画）", async () => {
    const stale = docOf("fp-old", 2);
    const fresh = docOf("fp-new", 3);
    const first = await pdfFeatures("artifact-1", stale, extract);
    const second = await pdfFeatures("artifact-1", fresh, extract);
    expect(first.map((f) => f.text)).toEqual(["fp-old:1", "fp-old:2"]);
    expect(second.map((f) => f.text)).toEqual(["fp-new:1", "fp-new:2", "fp-new:3"]);
  });

  it("同じ添付を開き直したとき（同じ指紋）は計算し直さない", async () => {
    extract.mockClear();
    const a = await pdfFeatures("artifact-2", docOf("fp-same", 2), extract);
    const b = await pdfFeatures("artifact-2", docOf("fp-same", 2), extract);
    expect(b).toBe(a);
    expect(extract).toHaveBeenCalledTimes(2);
  });

  it("失敗した計算は残さず、次は計算し直す", async () => {
    const failing = vi
      .fn<typeof extract>()
      .mockRejectedValueOnce(new Error("broken"))
      .mockImplementation(extract);
    const doc = docOf("fp-retry", 1);
    await expect(pdfFeatures("artifact-3", doc, failing)).rejects.toThrow("broken");
    const again = await pdfFeatures("artifact-3", doc, failing);
    expect(again.map((f) => f.text)).toEqual(["fp-retry:1"]);
  });
});
