import { describe, expect, it } from "vite-plus/test";
import { activeMentions, createMentionDirectory, mentionQueryAt } from "./mentions";

describe("mentionQueryAt", () => {
  it("カーソル直前の @よみ を拾う", () => {
    expect(mentionQueryAt("確認 @本郷", 6)).toEqual({ start: 3, query: "本郷" });
    expect(mentionQueryAt("@", 1)).toEqual({ start: 0, query: "" });
  });
  it("メールアドレスや語の途中の @ は拾わない", () => {
    expect(mentionQueryAt("a@b", 3)).toBeNull();
    expect(mentionQueryAt("@本郷 校正 です", 10)).toBeNull();
  });
});

describe("activeMentions", () => {
  // 候補から選んだ人の名前は検索先（directory）に控える
  const dir = createMentionDirectory("w1", "comments");
  dir.remember({ id: "u1", name: "本郷 校正" });
  dir.remember({ id: "u2", name: "五月 めい" });
  it("本文に @名前 が残っている人だけ", () => {
    expect(activeMentions("@本郷 校正 お願いします", ["u1", "u2", "u1"], dir)).toEqual(["u1"]);
    expect(activeMentions("名前を消した", ["u1"], dir)).toEqual([]);
    // 控えの無い人（候補から選んでいない ID）は数えない
    expect(activeMentions("@誰か", ["u9"], dir)).toEqual([]);
  });
});
