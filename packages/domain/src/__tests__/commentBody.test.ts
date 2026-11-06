import { describe, expect, it } from "vite-plus/test";
import {
  COMMENT_BODY_MAX,
  isCommentBodyFormat,
  plainTextOf,
  validateCommentBody,
  validateCommentBodyFormat,
} from "../comment/body.ts";
import { editThreadBody, planCarryForward } from "../comment/CommentThread.ts";
import { makeThread } from "./fixtures.ts";

const code = (c: string) => expect.objectContaining({ code: c });

describe("コメント本文の書式", () => {
  it("書式は markdown だけ。無ければ平文（undefined）、知らない値は拒否", () => {
    expect(isCommentBodyFormat("markdown")).toBe(true);
    expect(isCommentBodyFormat("html")).toBe(false);
    expect(validateCommentBodyFormat(undefined)).toBeUndefined();
    expect(validateCommentBodyFormat("markdown")).toBe("markdown");
    expect(() => validateCommentBodyFormat("html")).toThrow(code("comment_body_format_invalid"));
    expect(() => validateCommentBodyFormat("")).toThrow(code("comment_body_format_invalid"));
  });

  it("本文は 5000 文字まで（サロゲートペアは 1 文字）", () => {
    expect(COMMENT_BODY_MAX).toBe(5000);
    expect(validateCommentBody("あ".repeat(5000), "markdown")).toBe("markdown");
    expect(validateCommentBody("𠮷".repeat(5000), undefined)).toBeUndefined();
    expect(() => validateCommentBody("あ".repeat(5001), "markdown")).toThrow(
      code("comment_body_too_long"),
    );
    expect(() => validateCommentBody("a", "x")).toThrow(code("comment_body_format_invalid"));
  });
});

describe("editThreadBody と書式", () => {
  const t = makeThread({ authorId: "reviewer", body: "旧", bodyFormat: "markdown" });
  it("訂正後の本文の書式に置き換わる（指定が無ければ平文に戻る）", () => {
    expect(editThreadBody(t, "reviewer", "**新**", "markdown").bodyFormat).toBe("markdown");
    const plain = editThreadBody(t, "reviewer", "新");
    expect(plain.bodyFormat).toBeUndefined();
    expect("bodyFormat" in plain).toBe(false);
    // 平文のコメントを Markdown で訂正できる
    const legacy = makeThread({ authorId: "reviewer", body: "旧" });
    expect(editThreadBody(legacy, "reviewer", "- a", "markdown").bodyFormat).toBe("markdown");
  });
  it("長すぎる本文・知らない書式で訂正できない", () => {
    expect(() => editThreadBody(t, "reviewer", "あ".repeat(5001), "markdown")).toThrow(
      code("comment_body_too_long"),
    );
    expect(() => editThreadBody(t, "reviewer", "x", "html")).toThrow(
      code("comment_body_format_invalid"),
    );
  });
});

describe("planCarryForward と書式", () => {
  it("持ち越した先のコメントも同じ書式", () => {
    const src = makeThread({ body: "**a**", bodyFormat: "markdown" });
    expect(planCarryForward(src, "rev2", 1).target.bodyFormat).toBe("markdown");
    const legacy = planCarryForward(makeThread({ body: "a" }), "rev2", 1).target;
    expect("bodyFormat" in legacy).toBe(false);
  });
});

describe("plainTextOf（通知の抜粋）", () => {
  it("平文（書式なし）はそのまま。Markdown の記号に見える文字も触らない", () => {
    expect(plainTextOf("**a** と [b](c) と `d`")).toBe("**a** と [b](c) と `d`");
    expect(plainTextOf("# a\n- b", undefined)).toBe("# a\n- b");
  });

  it("太字・斜体・取り消し線・インラインコードの記号を外す", () => {
    expect(plainTextOf("**太字** と *斜体* と ~~消す~~ と `code`", "markdown")).toBe(
      "太字 と 斜体 と 消す と code",
    );
    expect(plainTextOf("__太字__ と _斜体_", "markdown")).toBe("太字 と 斜体");
    // 語の途中の _ は斜体にしない
    expect(plainTextOf("snake_case_name", "markdown")).toBe("snake_case_name");
  });

  it("リンクは文字だけ、URL はそのまま、画像は代替文字", () => {
    expect(plainTextOf("[公式](https://example.com/a_(b)) を見て", "markdown")).toBe("公式 を見て");
    expect(plainTextOf("<https://example.com> へ", "markdown")).toBe("https://example.com へ");
    expect(plainTextOf("https://example.com/a?b=1", "markdown")).toBe("https://example.com/a?b=1");
    expect(plainTextOf("![図](https://example.com/a.png)", "markdown")).toBe("図");
  });

  it("行頭の見出し・引用・箇条書き・番号の記号を外し、改行は残す", () => {
    expect(plainTextOf("## 見出し\n> 引用\n- 一\n  - 二\n1. 三\n2) 四", "markdown")).toBe(
      "見出し\n引用\n一\n二\n三\n四",
    );
    expect(plainTextOf("- [x] 済\n- [ ] 未", "markdown")).toBe("済\n未");
  });

  it("コードブロックは囲いを外して中身だけ残す（中の記号は解釈しない）", () => {
    expect(plainTextOf("前\n```ts\nconst a = **b**;\n```\n後", "markdown")).toBe(
      "前\nconst a = **b**;\n後",
    );
    // 閉じていないフェンスは最後まで中身
    expect(plainTextOf("```\n*a*", "markdown")).toBe("*a*");
  });

  it("&lt; などの文字参照は文字に戻す（入力欄が < を &lt; と書き出す）", () => {
    expect(plainTextOf("1 &lt; 2 &amp;&amp; &lt;b&gt;", "markdown")).toBe("1 < 2 && <b>");
  });

  it("バックスラッシュのエスケープを戻す。メンションはそのまま", () => {
    expect(plainTextOf("\\*a\\* と @本郷 校正 へ", "markdown")).toBe("*a* と @本郷 校正 へ");
  });
});
