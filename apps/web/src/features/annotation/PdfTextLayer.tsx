import type { PDFDocumentProxy, PDFPageProxy } from "pdfjs-dist";
import { useEffect, useRef, useState } from "react";
import { pdfjs } from "./pdfjs";

type TextContent = Awaited<ReturnType<PDFPageProxy["getTextContent"]>>;

/** ページごとの文字の内容。拡大・回転のたびに読み直さない（回転に依らない座標なので共有できる） */
const contentCache = new WeakMap<PDFDocumentProxy, Map<number, Promise<TextContent>>>();

function loadTextContent(doc: PDFDocumentProxy, n: number): Promise<TextContent> {
  let byPage = contentCache.get(doc);
  if (!byPage) contentCache.set(doc, (byPage = new Map()));
  let hit = byPage.get(n);
  if (!hit) {
    const map = byPage;
    hit = doc
      .getPage(n)
      .then((p) => p.getTextContent())
      .catch((e: unknown) => {
        map.delete(n); // 失敗は覚えない（次に近づいたとき読み直す）
        throw e;
      });
    byPage.set(n, hit);
  }
  return hit;
}

/**
 * PDF.js の文字の層（TextLayer）。見えない文字を canvas の真上に同じ位置・大きさで重ね、マウスのドラッグ・指の長押しで
 * 文字を選んでコピーできるようにする（利用者指示 2026-10-18「文字選択とかができるように」。書き込みを「なし」にしているとき）。
 * - 重なりの順は canvas ＜ この層 ＜ リンク（PdfLinks）＜ 印の層（AnchorOverlay）。コメント・FB のモードでは出さない
 *   （範囲を選ぶ操作を印の層が受けるので、文字の選択と取り合わない）。選択しても印は作らない
 * - 舞台の近く（上下 1 画面分。canvas と同じ）に来たページだけ組み、離れたら捨てて DOM を減らす。倍率・回転が変わったら組み直す
 * - 見た目は styles.css の `.textLayer`（pdf.js の viewer css の必要な分だけ）。文字は透明で、選んだ範囲だけ主色で見せる
 */
export function PdfTextLayer({
  doc,
  n,
  scale,
  rotation,
  root,
}: {
  doc: PDFDocumentProxy;
  n: number;
  scale: number;
  rotation: number;
  root: React.RefObject<HTMLDivElement | null>;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [near, setNear] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => setNear(e?.isIntersecting ?? false), {
      root: root.current,
      rootMargin: "100% 0px",
    });
    io.observe(el);
    return () => io.disconnect();
  }, [root]);

  useEffect(() => {
    const container = ref.current;
    if (!container || !near) return;
    let cancelled = false;
    let layer: InstanceType<typeof pdfjs.TextLayer> | null = null;
    void Promise.all([doc.getPage(n), loadTextContent(doc, n)])
      .then(([p, content]) => {
        if (cancelled) return;
        const vp = p.getViewport({ scale, rotation: (p.rotate + rotation) % 360 });
        const { pageWidth, pageHeight } = vp.rawDims as { pageWidth: number; pageHeight: number };
        // 文字は回す前の向き（紙の向き）で組み、CSS で回す。横幅は 90・270 度のとき縦横が入れ替わる
        const turned = vp.rotation % 180 !== 0;
        const factor = (turned ? vp.height : vp.width) / pageWidth;
        container.replaceChildren();
        container.style.setProperty("--total-scale-factor", String(factor));
        layer = new pdfjs.TextLayer({ textContentSource: content, container, viewport: vp });
        // 幅・高さは pdf.js が整数に丸めるので、紙面（canvas）とぴったり重なるよう実寸で上書きする
        container.style.width = `${pageWidth * factor}px`;
        container.style.height = `${pageHeight * factor}px`;
        return layer.render().then(() => {
          if (cancelled) return;
          // 文字のない所をなぞっても選択が飛ばないよう、末尾の受け皿を置く（pdf.js の viewer と同じ）
          const end = document.createElement("div");
          end.className = "endOfContent";
          container.append(end);
        });
      })
      .catch(() => {
        // 取り消し、または文字を読めなかった（文字の層が無いだけで、紙面とリンクはそのまま使える）
      });
    return () => {
      cancelled = true;
      layer?.cancel();
      container.replaceChildren();
    };
  }, [doc, n, scale, rotation, near]);

  // ドラッグ中だけ受け皿を伸ばす（pdf.js の viewer と同じ）。離したら戻す
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const stop = () => el.classList.remove("selecting");
    const start = () => el.classList.add("selecting");
    el.addEventListener("pointerdown", start);
    document.addEventListener("pointerup", stop);
    document.addEventListener("pointercancel", stop);
    window.addEventListener("blur", stop);
    return () => {
      el.removeEventListener("pointerdown", start);
      document.removeEventListener("pointerup", stop);
      document.removeEventListener("pointercancel", stop);
      window.removeEventListener("blur", stop);
    };
  }, []);

  return <div className="textLayer" ref={ref} />;
}
