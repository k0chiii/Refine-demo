import { describe, expect, it } from "vite-plus/test";
import { parsePostManifest } from "../social/post.ts";
import { validateSocialProfile } from "../social/profile.ts";

const code = (c: string) => expect.objectContaining({ code: c });
const base = {
  platform: "instagram" as const,
  displayName: "第100回五月祭",
  username: "mayfes_official",
  verified: false,
};

describe("SNS のアカウント（本体の設定）", () => {
  it("ユーザー名は各サービスの規則で確かめ、先頭の @ は外す", () => {
    expect(validateSocialProfile({ ...base, username: "@mayfes.official" }).username).toBe(
      "mayfes.official",
    );
    expect(() =>
      validateSocialProfile({ ...base, platform: "x", username: "mayfes.official" }),
    ).toThrow(code("social_profile_invalid"));
    expect(() => validateSocialProfile({ ...base, username: "a".repeat(31) })).toThrow(
      code("social_profile_invalid"),
    );
  });
  it("アイコンは画像の data URL だけ、数字は 0 以上の整数", () => {
    expect(() =>
      validateSocialProfile({ ...base, avatar: "https://example.invalid/a.png" }),
    ).toThrow(code("social_profile_invalid"));
    expect(validateSocialProfile({ ...base, avatar: "data:image/png;base64,AAAA" }).avatar).toBe(
      "data:image/png;base64,AAAA",
    );
    expect(() => validateSocialProfile({ ...base, stats: { followers: -1 } })).toThrow(
      code("social_profile_invalid"),
    );
    expect(validateSocialProfile({ ...base, stats: { posts: 12 } }).stats).toEqual({ posts: 12 });
  });
  it("投稿の記録はアイコンと認証バッジも読み、壊れたアイコンは捨てる", () => {
    const post = parsePostManifest({
      version: 1,
      platform: "x",
      format: "post",
      account: { displayName: "a", username: "b", avatar: "javascript:alert(1)", verified: true },
      body: "",
      images: [],
    });
    expect(post?.account).toEqual({ displayName: "a", username: "b", verified: true });
  });
});
