import { describe, expect, it } from "vite-plus/test";
import { pdfDocumentParams } from "./pdfjs";

/**
 * PDF.js 5+ は JPEG2000 / JBIG2 / ICC の復号を wasm に分けた。
 * wasmUrl（と CMYK 向け iccUrl）が無いと、文字は出ても写真だけ空白になる。
 */
describe("pdfDocumentParams（画像コーデック）", () => {
  it("wasmUrl と iccUrl を自前配信の pdfjs 配下に向ける", () => {
    const base = import.meta.env.BASE_URL;
    expect(pdfDocumentParams.wasmUrl).toBe(`${base}pdfjs/wasm/`);
    expect(pdfDocumentParams.iccUrl).toBe(`${base}pdfjs/iccs/`);
  });
});
