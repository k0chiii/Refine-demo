import { describe, expect, it } from "vite-plus/test";
import {
  byteLength,
  charLength,
  checkPost,
  cropRect,
  emptyPost,
  extractHashtags,
  extractMentions,
  extractUrls,
  isPostDraftContent,
  missingPostImages,
  missingPostImagesMessage,
  parsePostManifest,
  postSnapshotProblems,
  postSubmissionProblems,
  postManifest,
  xWeightedLength,
  type SocialPost,
} from "../index.ts";

const img = (k: string, alt = "説明") => ({
  key: k,
  fileName: `${k}.jpg`,
  alt,
  aspect: "1:1" as const,
});

describe("SNS 投稿", () => {
  it("ハッシュタグ・URL・メンションを日本語の本文から取り出す", () => {
    const body =
      "第100回 #五月祭 へようこそ！＃MF100 詳しくは https://example.com/a?b=1 を @gogatsusai_pr まで #2026 #五月祭2026";
    expect(extractHashtags(body).map((t) => t.tag)).toEqual(["五月祭", "MF100", "五月祭2026"]);
    const u = extractUrls(body);
    expect(u[0]!.url).toBe("https://example.com/a?b=1");
    expect(body.slice(u[0]!.start, u[0]!.end)).toBe(u[0]!.url);
    expect(extractMentions(body).map((m) => m.name)).toEqual(["gogatsusai_pr"]);
    // 本文中の位置が合っている
    const t = extractHashtags(body)[0]!;
    expect(body.slice(t.start, t.end)).toBe("#五月祭");
  });

  it("X の文字数は日本語 2・URL 23 で数える（近似）", () => {
    expect(xWeightedLength("abc")).toBe(3);
    expect(xWeightedLength("五月祭")).toBe(6);
    expect(xWeightedLength("見て https://example.com/very/long/path")).toBe(4 + 1 + 23);
    expect(charLength("👍五")).toBe(2);
  });

  it("上限と ALT の確認（Instagram / X）", () => {
    const ig: SocialPost = {
      ...emptyPost("instagram"),
      format: "carousel",
      account: { displayName: "五月祭", username: "may_fes" },
      body: "#a ".repeat(31),
      images: [img("a"), img("b", "")],
    };
    const codes = checkPost(ig).map((i) => i.code);
    expect(codes).toContain("hashtags");
    expect(codes).toContain("alt_missing");
    expect(checkPost({ ...ig, format: "feed" }).map((i) => i.code)).toContain("images_many");
    // ストーリーズは 10 枚まで（1 枚ずつ別のストーリー）
    const frames = (n: number) => Array.from({ length: n }, (_, i) => img(`s${i}`));
    const story = { ...ig, body: "", format: "story" as const };
    expect(checkPost({ ...story, images: frames(10) }).map((i) => i.code)).not.toContain(
      "images_many",
    );
    expect(checkPost({ ...story, images: frames(11) }).map((i) => i.code)).toContain("images_many");
    const x: SocialPost = {
      ...emptyPost("x"),
      account: { displayName: "", username: "u" },
      body: "あ".repeat(141),
      images: [img("a"), img("b"), img("c"), img("d"), img("e")],
    };
    expect(
      checkPost(x)
        .map((i) => i.code)
        .sort(),
    ).toEqual(["body_long", "images_many"]);
    expect(checkPost({ ...x, body: "あ".repeat(140), images: [] })).toEqual([]);
  });

  it("切り抜きは比率を保ち、焦点に寄せて画像からはみ出さない", () => {
    expect(cropRect("1:1", 2000, 1000)).toEqual({ x: 0.25, y: 0, w: 0.5, h: 1 });
    expect(cropRect("1:1", 2000, 1000, { x: 1, y: 0.5 })).toEqual({ x: 0.5, y: 0, w: 0.5, h: 1 });
    const r = cropRect("9:16", 1000, 1000);
    expect(r.w).toBeCloseTo(0.5625);
    expect(cropRect("4:5", 800, 1000).h).toBeCloseTo(1);
    expect(cropRect("original", 10, 10)).toEqual({ x: 0, y: 0, w: 1, h: 1 });
  });

  it("内容の記録は往復でき、壊れた値は落とす", () => {
    const post: SocialPost = {
      ...emptyPost("instagram"),
      body: "本文",
      images: [{ ...img("a"), focus: { x: 0.2, y: 0.8 } }],
      scheduledAt: 1,
    };
    const json = postManifest(post);
    expect(isPostDraftContent(json)).toBe(true);
    expect(parsePostManifest(JSON.parse(json))).toEqual(post);
    expect(parsePostManifest({ version: 2 })).toBeNull();
    const bad = parsePostManifest({
      version: 1,
      platform: "x",
      format: "carousel",
      images: [{ fileName: "a.png", aspect: "3:1", focus: { x: 5, y: -1 } }, { nope: 1 }],
    })!;
    expect(bad.format).toBe("post");
    expect(bad.images).toEqual([
      { key: "img0", fileName: "a.png", alt: "", aspect: "original", focus: { x: 1, y: 0 } },
    ]);
    expect(isPostDraftContent('{"type":"doc"}')).toBe(false);
  });
});

describe("SNS 投稿の提出（画像の実体）", () => {
  it("実体の無い画像があれば提出を止める（黙って除かない）", () => {
    const post = {
      images: [{ ...img("a"), artifactId: "art-a" }, img("b"), img("c")],
    };
    const ready = new Set(["c"]);
    const missing = missingPostImages(post, (k) => ready.has(k));
    expect(missing.map((m) => [m.index, m.reason])).toEqual([
      [0, "loading"],
      [1, "lost"],
    ]);
    expect(missingPostImagesMessage(missing)).toContain(
      "1 枚目の画像を読み込んでいます（ほか 1 枚）",
    );
    expect(missingPostImagesMessage(missingPostImages(post, () => true))).toBeNull();
    expect(missingPostImagesMessage(missing.slice(1))).toContain("「b.jpg」がこの端末にありません");
  });

  it("内容の記録の画像はすべて添付に 1 対 1 で対応する", () => {
    const snapshot = { images: [img("01-a"), img("02-b")] };
    expect(postSnapshotProblems(snapshot, ["post-body.txt", "01-a.jpg", "02-b.jpg"])).toEqual([]);
    expect(postSnapshotProblems(snapshot, ["01-a.jpg"])).toEqual([
      "2 枚目の画像のファイルがありません",
    ]);
    expect(postSnapshotProblems({ images: [img("x"), img("x")] }, ["x.jpg"])).toEqual([
      "2 枚目の画像のファイル名が重複しています",
    ]);
  });

  it("提出の準備で、内容の記録と添付の対応をサーバー側でも確かめる", () => {
    const post: SocialPost = { ...emptyPost("instagram"), images: [img("01-a"), img("02-b")] };
    const json = postManifest(post);
    const size = byteLength(json);
    const items = (names: string[], manifestSize = size) => [
      { fileName: "post-body.txt", declaredSize: 3 },
      ...names.map((fileName) => ({ fileName, declaredSize: 10 })),
      { fileName: "mf100-post.json", declaredSize: manifestSize },
    ];
    expect(postSubmissionProblems(json, items(["01-a.jpg", "02-b.jpg"]))).toEqual([]);
    // 画像が 1 枚欠けた版は作らない
    expect(postSubmissionProblems(json, items(["01-a.jpg"]))).toEqual([
      "2 枚目の画像のファイルがありません",
    ]);
    // 記録を渡さずに添付だけ、記録だけで添付なし
    expect(postSubmissionProblems(undefined, items(["01-a.jpg", "02-b.jpg"]))).toEqual([
      "内容の記録が渡されていません",
    ]);
    expect(postSubmissionProblems(json, [{ fileName: "a.pdf" }])).toEqual([
      "内容の記録の添付がありません",
    ]);
    // 渡した記録と添付する記録が別物（サイズが違う）
    expect(postSubmissionProblems(json, items(["01-a.jpg", "02-b.jpg"], size + 1))).toEqual([
      "内容の記録が添付と一致しません",
    ]);
    // 読むときに除かれる画像（ファイル名なし）も見逃さない
    const broken = JSON.stringify({ ...JSON.parse(json), images: [img("01-a"), { key: "x" }] });
    const brokenItems = [
      { fileName: "post-body.txt" },
      { fileName: "01-a.jpg" },
      { fileName: "mf100-post.json", declaredSize: byteLength(broken) },
    ];
    expect(postSubmissionProblems(broken, brokenItems)).toEqual([
      "内容の記録に読めない画像があります",
    ]);
    expect(postSubmissionProblems("{", items([]))).toEqual(["内容の記録を読めません"]);
    // 投稿でない版は対象外
    expect(postSubmissionProblems(undefined, [{ fileName: "a.pdf" }])).toEqual([]);
  });
});
