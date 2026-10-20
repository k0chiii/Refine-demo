import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";
import { CommentBody, decodeEntities, findUrls, plainToMarkdown, safeHref } from "./CommentBody";

const md = (body: string, mentionUsers?: Array<{ name: string }>) =>
  renderToStaticMarkup(createElement(CommentBody, { body, format: "markdown", mentionUsers }));
const legacy = (body: string, mentionUsers?: Array<{ name: string }>) =>
  renderToStaticMarkup(createElement(CommentBody, { body, mentionUsers }));

describe("safeHref", () => {
  it("http・https・mailto だけ通す", () => {
    expect(safeHref("https://example.com/a?b=1")).toBe("https://example.com/a?b=1");
    expect(safeHref("http://example.com")).toBe("http://example.com/");
    expect(safeHref("mailto:a@example.com")).toBe("mailto:a@example.com");
  });
  it("javascript・data・vbscript・相対・壊れた URL は通さない（空白や大文字でごまかしても）", () => {
    for (const bad of [
      "javascript:alert(1)",
      "  JaVaScRiPt:alert(1)",
      "java\nscript:alert(1)",
      "data:text/html,<script>alert(1)</script>",
      "vbscript:msgbox(1)",
      "/relative/path",
      "//example.com",
      "example.com",
      "",
    ])
      expect(safeHref(bad), bad).toBeNull();
  });
});

describe("findUrls（本文中の URL）", () => {
  const found = (s: string) => findUrls(s).map((r) => s.slice(r.start, r.end));
  it("日本語の句読点・括弧・文末の記号の手前で切る", () => {
    expect(found("見て https://example.com/a。次")).toEqual(["https://example.com/a"]);
    expect(found("（https://example.com/a）です")).toEqual(["https://example.com/a"]);
    expect(found("「https://example.com」と https://b.example/x?y=1, それ")).toEqual([
      "https://example.com",
      "https://b.example/x?y=1",
    ]);
    expect(found("https://example.com/a_(b)). 続き")).toEqual(["https://example.com/a_(b)"]);
  });
  it("http・https 以外や、ホストの無いものは拾わない", () => {
    expect(found("ftp://example.com javascript:alert(1) https:// www.example.com")).toEqual([]);
  });
});

describe("CommentBody（markdown）", () => {
  it("段落・太字・斜体・取り消し線・インラインコード", () => {
    const html = md("**太字** と *斜体* と ~~消す~~ と `code`");
    expect(html).toContain("<strong>太字</strong>");
    expect(html).toContain("<em>斜体</em>");
    expect(html).toContain("<del>消す</del>");
    expect(html).toContain("<code>code</code>");
    expect(html.startsWith('<div class="comment-body')).toBe(true);
    expect(html).toContain("<p>");
  });

  it("単一の改行は改行（br）、空行は段落の区切り", () => {
    const html = md("一行目\n二行目\n\n次の段落");
    expect(html).toContain("一行目<br/>二行目");
    expect(html.match(/<p>/g)).toHaveLength(2);
  });

  it("箇条書き（入れ子）・番号つき・引用・コードブロック", () => {
    const html = md("- a\n  - b\n- c\n\n3. x\n4. y\n\n> 引用\n\n```ts\nconst a = 1 < 2;\n```");
    expect(html).toMatch(/<ul><li>a<ul><li>b<\/li><\/ul><\/li><li>c<\/li><\/ul>/);
    expect(html).toContain('<ol start="3"><li>x</li><li>y</li></ol>');
    expect(html).toContain("<blockquote><p>引用</p></blockquote>");
    // コードの中の < は文字として出る（要素にならない）
    expect(html).toContain("<pre><code>const a = 1 &lt; 2;</code></pre>");
  });

  it("javascript: などのリンクは a にせず、文字だけ出す", () => {
    const html = md(
      "[押す](javascript:alert(1)) と [別](data:text/html;base64,AAAA) と [相対](/x)",
    );
    expect(html).not.toContain("<a");
    expect(html).not.toContain("href");
    expect(html).toContain("押す");
    expect(html).toContain("別");
    expect(html).toContain("相対");
  });

  it("http・https・mailto のリンクは別タブで、noopener noreferrer nofollow つき", () => {
    const html = md("[公式](https://example.com/a) [連絡](mailto:a@example.com)");
    expect(html).toContain('href="https://example.com/a"');
    expect(html).toContain('href="mailto:a@example.com"');
    expect(html.match(/target="_blank"/g)).toHaveLength(2);
    expect(html.match(/rel="noopener noreferrer nofollow"/g)).toHaveLength(2);
  });

  it("本文中の URL は自動でリンクにする（句読点は含めない）。コードの中は触らない", () => {
    const html = md("詳細は https://example.com/a。 と `https://example.com/code`");
    expect(html).toContain('<a class="comment-body__link" href="https://example.com/a"');
    expect(html).toContain(">https://example.com/a</a>。");
    expect(html).toContain("<code>https://example.com/code</code>");
    expect(html.match(/<a /g)).toHaveLength(1);
  });

  it("リンクの文字が URL でも、リンクの中にリンクを作らない", () => {
    const html = md(
      "[https://example.com/a](https://example.com/a) と [公式](https://example.com/b)",
    );
    expect(html.match(/<a /g)).toHaveLength(2);
    expect(html).not.toMatch(/<a [^>]*><a /);
  });

  it("入力欄が書き出す &lt; などの文字参照は、HTML にせず文字へ戻す", () => {
    const html = md("&lt;script&gt;alert(1)&lt;/script&gt; &amp; 1 &lt; 2");
    expect(html).not.toContain("<script");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt; &amp; 1 &lt; 2"); // HTML の出力としては再びエスケープされる
    expect(decodeEntities("&lt;b&gt; &amp;amp; &#60; &#x3C; &bogus; &#0; &#xD800;")).toBe(
      "<b> &amp; < < &bogus; &#0; &#xD800;",
    );
  });

  it("生の HTML（script・イベント属性つきの要素）は解釈せず、書かれたとおりの文字で出す", () => {
    const html = md(
      'a <script>alert(1)</script> b <img src=x onerror="alert(1)">\n\n<div onclick="x()">raw</div>\n\n<iframe src="https://evil.example"></iframe>',
    );
    expect(html).not.toContain("<script");
    expect(html).not.toContain("<img");
    expect(html).not.toContain("<div onclick");
    expect(html).not.toContain("<iframe");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).toContain("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
    expect(html).toContain("&lt;div onclick=&quot;x()&quot;&gt;raw&lt;/div&gt;");
  });

  it("画像は読み込まず代替文字だけ。見出しは太字の段落（大きさを変えない）", () => {
    const html = md("![図](https://example.com/a.png)\n\n# 見出し");
    expect(html).not.toContain("<img");
    expect(html).toContain("図");
    expect(html).not.toContain("<h1");
    expect(html).toContain("<p><strong>見出し</strong></p>");
  });

  it("メンションされた人の @名前 だけ強調する（太字の中でも）", () => {
    const users = [{ name: "本郷 校正" }];
    const html = md("@本郷 校正 さん **@本郷 校正** と @誰か", users);
    expect(html.match(/<span class="mention">@本郷 校正<\/span>/g)).toHaveLength(2);
    expect(html).not.toContain('<span class="mention">@誰か');
  });
});

describe("CommentBody（書式なし＝旧来の平文）", () => {
  it("Markdown の記号は解釈しない。改行はそのまま（br にしない）", () => {
    const html = legacy("**太字**\n- a\n# b\n`c`\n> d");
    expect(html).toContain("comment-body--plain");
    for (const tag of ["<strong", "<ul", "<li", "<h1", "<code", "<blockquote", "<br"])
      expect(html).not.toContain(tag);
    expect(html).toContain("**太字**\n- a\n# b\n`c`\n&gt; d");
  });

  it("URL だけリンクにする。javascript: は文字のまま", () => {
    const html = legacy(
      "見て https://example.com/a。 javascript:alert(1) [x](javascript:alert(1))",
    );
    expect(html.match(/<a /g)).toHaveLength(1);
    expect(html).toContain('href="https://example.com/a"');
    expect(html).not.toContain('href="javascript');
    expect(html).toContain("javascript:alert(1)");
  });

  it("生の HTML は文字のまま。メンションは強調する", () => {
    const html = legacy("<script>alert(1)</script> @本郷 校正", [{ name: "本郷 校正" }]);
    expect(html).not.toContain("<script");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain('<span class="mention">@本郷 校正</span>');
  });
});

describe("plainToMarkdown（平文のコメントを訂正するとき入力欄へ読み込む形）", () => {
  it("Markdown の記号を含む平文も、書かれた文字のまま・改行のままに戻る", () => {
    for (const text of [
      "**太字** と *斜体* と `code`",
      "- 箇条書きに見える\n1. 番号に見える\n> 引用に見える\n# 見出しに見える",
      "改行\n\n空行のあと <b>x</b> & [a](b) snake_case_name",
    ]) {
      const html = md(plainToMarkdown(text));
      for (const tag of [
        "<strong",
        "<em",
        "<code",
        "<ul",
        "<ol",
        "<blockquote",
        "<h1",
        "<b>",
        "<a ",
      ])
        expect(html, text).not.toContain(tag);
      const rendered = html
        .replace(/<br\/>/g, "\n")
        .replace(/<\/p><p>/g, "\n\n")
        .replace(/<[^>]+>/g, "")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&amp;/g, "&");
      expect(rendered, text).toBe(text);
    }
  });
});
