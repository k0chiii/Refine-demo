import { describe, expect, it } from "vite-plus/test";
import {
  anchorFitsArtifact,
  TEXT_QUOTE_MAX,
  validateAnchor,
  WEB_SELECTOR_MAX,
  webElementAnchor,
  type Anchor,
  type WebElementPlace,
} from "../comment/Anchor.ts";
import {
  collectFigmaUrls,
  figmaDeepLink,
  figmaEmbedUrl,
  formatFigmaPlace,
  normalizeFigmaNodeId,
  parseFigmaUrl,
} from "../web/figma.ts";
import {
  formatWebPlace,
  placeIn,
  relativeTo,
  resolveWebAnchor,
  shortSelector,
  toViewportUnit,
  type WebAnchor,
} from "../web/webProof.ts";
import {
  figmaFrameFileName,
  markItemVerified,
  type UploadItem,
} from "../revision/UploadSession.ts";
import { isFigmaUrl, isWebLiveArtifact } from "../revision/Artifact.ts";

const place: WebElementPlace = {
  url: "/events/?day=1",
  selector: {
    css: "main > section:nth-of-type(2) > h2",
    xpath: "/html/body/main/section[2]/h2",
    tag: "H2",
  },
  point: { x: 0.5, y: 0.5 },
  viewport: { width: 402, height: 874, dpr: 1, deviceId: "iphone-17", orientation: "portrait" },
  fallback: { pageX: 201, pageY: 1430.4, scrollY: 1200 },
};
const web = (over: Partial<WebAnchor> = {}): WebAnchor => ({
  ...webElementAnchor("ext1", place),
  ...over,
});
const code = (c: string) => expect.objectContaining({ code: c });

describe("web_element アンカー（docs/FIGMA_WEB_PROOFING.md §6.1）", () => {
  it("ブリッジの位置から作り、タグは小文字・座標は丸める・矩形があればピンは付けない", () => {
    const a = webElementAnchor("ext1", place);
    expect(a).toMatchObject({
      type: "web_element",
      artifactId: "ext1",
      url: "/events/?day=1",
      selector: { tag: "h2" },
      point: { x: 0.5, y: 0.5 },
      fallback: { pageX: 201, pageY: 1430, scrollY: 1200 },
    });
    expect(() => validateAnchor(a)).not.toThrow();
    const r = webElementAnchor("ext1", {
      ...place,
      rect: { x: 0.1, y: 0.1, w: 0.5, h: 0.5 },
      selector: { ...place.selector, textQuote: { exact: " 企画一覧 ", prefix: "p" } },
    });
    expect(r.rect).toEqual({ x: 0.1, y: 0.1, w: 0.5, h: 0.5 });
    expect(r.point).toBeUndefined();
    expect(r.selector.textQuote).toEqual({ exact: " 企画一覧 ", prefix: "p" });
  });
  it("空・長すぎるセレクタ、相対 URL でない url、矩形とピンの両方、変な viewport は拒否", () => {
    const bad = (a: Anchor) => expect(() => validateAnchor(a)).toThrow(code("anchor_invalid"));
    bad(web({ selector: { css: "", tag: "h2" } }));
    bad(web({ selector: { css: "x".repeat(WEB_SELECTOR_MAX + 1), tag: "h2" } }));
    bad(web({ url: "https://example.com/" }));
    bad(web({ rect: { x: 0, y: 0, w: 0.5, h: 0.5 }, point: { x: 0.1, y: 0.1 } }));
    bad(web({ viewport: { ...place.viewport, width: 0 } }));
    bad(web({ viewport: { ...place.viewport, width: 402.5 } }));
    bad(web({ viewport: { ...place.viewport, orientation: "upside" as "portrait" } }));
    bad(
      web({
        selector: { css: "h2", tag: "h2", textQuote: { exact: "x".repeat(TEXT_QUOTE_MAX + 1) } },
      }),
    );
    bad(web({ fallback: { pageX: Number.NaN, pageY: 0, scrollY: 0 } }));
  });
  it("添付との組み合わせ: web_element は URL の添付、figma_node は Figma の URL、位置のアンカーは実体のある添付", () => {
    const ext = { role: "external", externalUrl: "https://example.com/" };
    const figma = {
      role: "external",
      externalUrl: "https://www.figma.com/design/abcdefghij12/x?node-id=1-2",
    };
    const pdf = { role: "source" };
    const node: Anchor = {
      type: "figma_node",
      artifactId: "f",
      fileKey: "abcdefghij12",
      nodeId: "1:2",
    };
    expect(anchorFitsArtifact(web(), ext)).toBe(true);
    expect(anchorFitsArtifact(web(), pdf)).toBe(false);
    expect(anchorFitsArtifact(node, figma)).toBe(true);
    expect(anchorFitsArtifact(node, ext)).toBe(false);
    expect(anchorFitsArtifact({ type: "external", artifactId: "x", note: "" }, ext)).toBe(true);
    expect(
      anchorFitsArtifact({ type: "image_pin", artifactId: "x", point: { x: 0, y: 0 } }, ext),
    ).toBe(false);
    expect(
      anchorFitsArtifact({ type: "image_pin", artifactId: "x", point: { x: 0, y: 0 } }, pdf),
    ).toBe(true);
  });
  it("figma_node はファイルキーとノード ID（1:2）を検証する", () => {
    const ok: Anchor = {
      type: "figma_node",
      artifactId: "f",
      fileKey: "abcdefghij12",
      nodeId: "1:2",
      nodeName: "ホーム",
    };
    expect(() => validateAnchor(ok)).not.toThrow();
    expect(() => validateAnchor({ ...ok, nodeId: "abc" })).toThrow(code("anchor_invalid"));
    expect(() => validateAnchor({ ...ok, fileKey: "../x" })).toThrow(code("anchor_invalid"));
    expect(formatFigmaPlace(ok)).toBe("フレーム: ホーム");
    expect(
      formatFigmaPlace({
        type: "figma_node",
        artifactId: "f",
        fileKey: "abcdefghij12",
        nodeId: "1:2",
      }),
    ).toBe("フレーム: 1:2");
  });
});

describe("resolveWebAnchor（再アンカー: attached / moved / detached）", () => {
  const el = { x: 16, y: 1400, w: 370, h: 60 };
  it("CSS で見つかれば attached。要素の中の相対位置で印の場所を出す", () => {
    const r = resolveWebAnchor(web(), [{ by: "css", rect: el, text: "企画一覧" }]);
    expect(r.state).toBe("attached");
    expect(r.rect).toEqual({ x: 201, y: 1430, w: 0, h: 0 });
  });
  it("CSS が無ければ XPath で attached、引用文だけなら moved、何も無ければ fallback で detached", () => {
    expect(resolveWebAnchor(web(), [{ by: "xpath", rect: el }]).state).toBe("attached");
    expect(resolveWebAnchor(web(), [{ by: "text", rect: el }])).toEqual({
      state: "moved",
      rect: { x: 201, y: 1430, w: 0, h: 0 },
    });
    expect(resolveWebAnchor(web(), [])).toEqual({
      state: "detached",
      rect: { x: 201, y: 1430, w: 0, h: 0 },
    });
  });
  it("引用文があるのにセレクタの要素にその文字が無ければ、引用文で見つけた要素を採る（moved）", () => {
    const a = web({ selector: { ...place.selector, textQuote: { exact: "企画一覧" } } });
    const other = { x: 16, y: 2400, w: 370, h: 60 };
    const r = resolveWebAnchor(a, [
      { by: "css", rect: el, text: "アクセス" },
      { by: "text", rect: other, text: "企画一覧" },
    ]);
    expect(r.state).toBe("moved");
    expect(r.rect.y).toBe(2430);
    // 文字が無くても他に候補が無ければ、セレクタの要素に moved で出す
    expect(resolveWebAnchor(a, [{ by: "css", rect: el, text: "アクセス" }]).state).toBe("moved");
    // 文字が合えば attached（空白・大文字小文字の違いは無視）
    expect(resolveWebAnchor(a, [{ by: "css", rect: el, text: " 企画 一覧 " }]).state).toBe(
      "attached",
    );
  });
  it("矩形は要素の中の 0..1 ↔ 文書座標で往復できる。ビューポートに入っていない印は描かない", () => {
    const rect = relativeTo(el, { x: 53, y: 1415, w: 185, h: 30 });
    expect(rect).toEqual({ x: 0.1, y: 0.25, w: 0.5, h: 0.5 });
    expect(placeIn({ rect }, el)).toEqual({ x: 53, y: 1415, w: 185, h: 30 });
    expect(placeIn({}, el)).toEqual(el);
    expect(
      toViewportUnit(
        { x: 201, y: 1430, w: 0, h: 0 },
        { x: 0, y: 1200 },
        { width: 402, height: 874 },
      ),
    ).toEqual({ x: 0.5, y: 230 / 874, w: 0, h: 0 });
    expect(
      toViewportUnit({ x: 201, y: 1430, w: 0, h: 0 }, { x: 0, y: 0 }, { width: 402, height: 874 }),
    ).toBeNull();
    // 一部だけ見えている矩形は切って描く
    const clipped = toViewportUnit(
      { x: -10, y: 860, w: 100, h: 100 },
      { x: 0, y: 0 },
      { width: 402, height: 874 },
    )!;
    expect(clipped.x).toBe(0);
    expect(clipped.y).toBeCloseTo(860 / 874);
    expect(clipped.w).toBeCloseTo(90 / 402);
    expect(clipped.h).toBeCloseTo(14 / 874);
  });
  it("場所の表示: 端末名（幅）・セレクタの末尾か引用文", () => {
    expect(formatWebPlace(web(), "iPhone 17")).toBe("iPhone 17（402px）・h2");
    expect(formatWebPlace(web(), null)).toBe("幅 402px・h2");
    expect(
      formatWebPlace(
        web({
          selector: {
            css: "#hero > .title",
            tag: "p",
            textQuote: { exact: "第100回五月祭へようこそ、みなさん" },
          },
        }),
        "PC",
      ),
    ).toBe("PC（402px）・「第100回五月祭へようこそ、み…」");
    expect(
      formatWebPlace(
        web({ viewport: { ...place.viewport, orientation: "landscape" } }),
        "iPhone 17",
      ),
    ).toBe("iPhone 17（874px）・h2");
    expect(shortSelector("#hero > .title", "p")).toBe(".title");
    expect(shortSelector("main > section:nth-of-type(2) > h2:nth-of-type(1)", "h2")).toBe("h2");
  });
});

describe("Figma の URL（parseFigmaUrl・リンク・埋め込み）", () => {
  const url = "https://www.figma.com/design/AbCdEfGhIjKl/MF100%20Web?node-id=12-34&t=xyz";
  it("design / file / proto / ブランチの URL を解釈し、node-id は 1:2 に揃える", () => {
    expect(parseFigmaUrl(url)).toEqual({
      kind: "design",
      fileKey: "AbCdEfGhIjKl",
      fileName: "MF100 Web",
      nodeId: "12:34",
    });
    expect(
      parseFigmaUrl("https://www.figma.com/file/AbCdEfGhIjKl/Old?node-id=1%3A2"),
    ).toMatchObject({
      kind: "design",
      nodeId: "1:2",
    });
    expect(parseFigmaUrl("https://www.figma.com/proto/AbCdEfGhIjKl/P?node-id=5-6")).toMatchObject({
      kind: "proto",
      nodeId: "5:6",
    });
    expect(
      parseFigmaUrl("https://www.figma.com/design/AbCdEfGhIjKl/branch/ZyXwVuTsRqPo/MF100"),
    ).toMatchObject({
      fileKey: "ZyXwVuTsRqPo",
      fileName: "MF100",
    });
    expect(parseFigmaUrl("https://www.figma.com/design/AbCdEfGhIjKl")).toEqual({
      kind: "design",
      fileKey: "AbCdEfGhIjKl",
    });
    expect(parseFigmaUrl("https://example.com/design/AbCdEfGhIjKl")).toBeNull();
    expect(parseFigmaUrl("http://www.figma.com/design/AbCdEfGhIjKl")).toBeNull();
    expect(parseFigmaUrl("https://www.figma.com/files/recent")).toBeNull();
    expect(parseFigmaUrl("not a url")).toBeNull();
    expect(normalizeFigmaNodeId("1-2")).toBe("1:2");
    expect(normalizeFigmaNodeId("1%3A2")).toBe("1:2");
    expect(normalizeFigmaNodeId("abc")).toBeNull();
  });
  it("ディープリンクと Embed Kit 2.0 の URL を作る。解釈できない URL は 1.0 の embed に逃がす", () => {
    const ref = parseFigmaUrl(url)!;
    expect(figmaDeepLink(ref)).toBe(
      "https://www.figma.com/design/AbCdEfGhIjKl/MF100%20Web?node-id=12-34",
    );
    expect(figmaEmbedUrl(url)).toBe(
      "https://embed.figma.com/design/AbCdEfGhIjKl/MF100%20Web?node-id=12-34&embed-host=mf100",
    );
    expect(figmaEmbedUrl("https://www.figma.com/proto/AbCdEfGhIjKl/P?node-id=5-6")).toBe(
      "https://embed.figma.com/proto/AbCdEfGhIjKl/P?node-id=5-6&embed-host=mf100",
    );
    expect(figmaEmbedUrl("https://www.figma.com/community/file/123")).toBe(
      "https://www.figma.com/embed?embed_host=mf100&url=https%3A%2F%2Fwww.figma.com%2Fcommunity%2Ffile%2F123",
    );
  });
  it("貼られた文から Figma の URL を集める（重複は除く）。Figma の URL はライブ表示の対象にしない", () => {
    const urls = collectFigmaUrls(
      `${url}\nhttps://example.com/\n${url}\nhttps://www.figma.com/design/AbCdEfGhIjKl/MF100?node-id=56-78`,
    );
    expect(urls.map((u) => u.ref.nodeId)).toEqual(["12:34", "56:78"]);
    expect(isFigmaUrl(url)).toBe(true);
    expect(isWebLiveArtifact({ role: "external", externalUrl: url })).toBe(false);
    expect(isWebLiveArtifact({ role: "external", externalUrl: "https://example.com/" })).toBe(true);
    expect(isWebLiveArtifact({ role: "external", externalUrl: "ftp://example.com/" })).toBe(false);
    expect(isWebLiveArtifact({ role: "source" })).toBe(false);
  });
  it("Figma から取り込んだ項目は、検証完了でノード名・版・大きさが入りファイル名はノード名になる", () => {
    const item: UploadItem = {
      id: "i1",
      sessionId: "s1",
      fileName: "figma-12-34.png",
      mimeType: "image/png",
      type: "image",
      role: "source",
      keyPrefix: "k",
      status: "pending",
      origin: {
        kind: "figma",
        fileKey: "AbCdEfGhIjKl",
        nodeId: "12:34",
        scale: 2,
        box: { width: 0, height: 0 },
      },
    };
    const next = markItemVerified(item, {
      size: 10,
      sha256: "s",
      objectKey: "k/a",
      figma: {
        nodeName: "ホーム / トップ",
        figmaVersion: "v9",
        lastModified: "2026-10-17T00:00:00Z",
        box: { width: 402, height: 874 },
      },
    });
    expect(next.fileName).toBe("ホーム _ トップ.png");
    expect(next.origin).toEqual({
      kind: "figma",
      fileKey: "AbCdEfGhIjKl",
      nodeId: "12:34",
      nodeName: "ホーム / トップ",
      figmaVersion: "v9",
      lastModified: "2026-10-17T00:00:00Z",
      scale: 2,
      box: { width: 402, height: 874 },
    });
    // 由来の無い項目には反映しない
    const { origin: _origin, ...noOrigin } = item;
    const plain = markItemVerified(noOrigin, {
      size: 10,
      sha256: "s",
      objectKey: "k/a",
      figma: { nodeName: "x", box: { width: 1, height: 1 } },
    });
    expect(plain.fileName).toBe("figma-12-34.png");
    expect(plain.origin).toBeUndefined();
    expect(figmaFrameFileName("   ", "1:2")).toBe("figma-1-2.png");
  });
});
