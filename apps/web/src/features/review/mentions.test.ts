import { describe, expect, it } from "vite-plus/test";
import { activeMentions, mentionQueryAt } from "./mentions";

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
  const users = [
    { id: "u1", name: "本郷 校正" },
    { id: "u2", name: "五月 めい" },
  ];
  it("本文に @名前 が残っている人だけ", () => {
    expect(activeMentions("@本郷 校正 お願いします", ["u1", "u2", "u1"], users)).toEqual(["u1"]);
    expect(activeMentions("名前を消した", ["u1"], users)).toEqual([]);
  });
});
