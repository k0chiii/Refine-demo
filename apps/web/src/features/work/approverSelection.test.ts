import { describe, expect, it } from "vite-plus/test";
import { selectableApprovers, withoutCreatorsAsApprovers } from "./approverSelection";

describe("校了者の選択から制作者を外す", () => {
  it("選択済みから制作者を外す（古い行を開いたとき）", () => {
    expect(selectableApprovers(["c1", "a1"], ["c1"])).toEqual(["a1"]);
    expect(selectableApprovers(["c1"], ["c1"])).toEqual([]);
    expect(selectableApprovers(["a1"], ["c1"])).toEqual(["a1"]);
  });

  it("制作者を変えて校了者と重なったら外し、人数を校了者の数に収める", () => {
    const form = { creatorIds: ["c1", "a2"], approverIds: ["a1", "a2", "a3"], approvalQuorum: "3" };
    expect(withoutCreatorsAsApprovers(form)).toEqual({
      creatorIds: ["c1", "a2"],
      approverIds: ["a1", "a3"],
      approvalQuorum: "2",
    });
  });

  it("重ならなければそのまま", () => {
    const form = { creatorIds: ["c1"], approverIds: ["a1"], approvalQuorum: "1" };
    expect(withoutCreatorsAsApprovers(form)).toBe(form);
  });
});
