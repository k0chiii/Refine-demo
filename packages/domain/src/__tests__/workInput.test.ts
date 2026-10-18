import { describe, expect, it } from "vite-plus/test";
import {
  applyWorkPatch,
  defaultWorkTeamPolicy,
  newlyReferencedPeople,
  normalizeProductionTeamIds,
  normalizeWorkEssentials,
  WORK_TITLE_MAX,
} from "../work/workInput.ts";
import { makeWork } from "./fixtures.ts";

const invalid = (field: string, reason: string) =>
  expect.objectContaining({
    code: "work_invalid",
    details: expect.objectContaining({ field, reason }),
  });

const essentials = {
  title: " パンフレット ",
  category: " 印刷物 ",
  creatorIds: ["c1", "c1", "c2"],
  approverId: " a ",
  managerIds: ["m"],
};

describe("制作物の不変条件（生成・変更で共通。PR #1 レビュー P2）", () => {
  it("名称・区分は trim、制作者・主管は重複をまとめる", () => {
    expect(normalizeWorkEssentials(essentials)).toEqual({
      title: "パンフレット",
      category: "印刷物",
      creatorIds: ["c1", "c2"],
      approverId: "a",
      approverIds: ["a"],
      approvalQuorum: 1,
      managerIds: ["m"],
    });
  });

  it("空の名称・区分、長すぎる名称、制作者なし・空の ID、空の校了権限者は拒否", () => {
    expect(() => normalizeWorkEssentials({ ...essentials, title: "   " })).toThrowError(
      invalid("title", "required"),
    );
    expect(() =>
      normalizeWorkEssentials({ ...essentials, title: "あ".repeat(WORK_TITLE_MAX + 1) }),
    ).toThrowError(invalid("title", "too_long"));
    expect(() => normalizeWorkEssentials({ ...essentials, category: "" })).toThrowError(
      invalid("category", "required"),
    );
    expect(() => normalizeWorkEssentials({ ...essentials, creatorIds: [] })).toThrowError(
      invalid("creatorIds", "required"),
    );
    expect(() => normalizeWorkEssentials({ ...essentials, creatorIds: [""] })).toThrowError(
      invalid("creatorIds", "blank_id"),
    );
    expect(() => normalizeWorkEssentials({ ...essentials, approverId: "" })).toThrowError(
      invalid("approverIds", "required"),
    );
    expect(() => normalizeWorkEssentials({ ...essentials, managerIds: [" "] })).toThrowError(
      invalid("managerIds", "blank_id"),
    );
  });

  it("変更でも同じ条件を確かめる（空の名称・制作者・校了権限者で保存できない）", () => {
    const work = makeWork();
    expect(() => applyWorkPatch(work, { title: "   " })).toThrowError(invalid("title", "required"));
    expect(() => applyWorkPatch(work, { creatorIds: [] })).toThrowError(
      invalid("creatorIds", "required"),
    );
    expect(() => applyWorkPatch(work, { approverId: "" })).toThrowError(
      invalid("approverIds", "required"),
    );
    expect(() => applyWorkPatch(work, { mediaType: "fax" as never })).toThrowError(
      invalid("mediaType", "unknown"),
    );
    const next = applyWorkPatch(work, { title: " 新しい名称 ", deadlineAt: undefined });
    expect(next).toMatchObject({ title: "新しい名称", version: work.version + 1 });
    expect(next.deadlineAt).toBe(work.deadlineAt);
  });

  it("制作担当は 1 つまで（ポリシー値。利用者決定 2026-10-17）。変えない限り古い行の 2 つは残せる", () => {
    expect(defaultWorkTeamPolicy.maxProductionTeams).toBe(1);
    expect(normalizeProductionTeamIds([" design ", "design"])).toEqual(["design"]);
    expect(normalizeProductionTeamIds([])).toEqual([]);
    expect(normalizeProductionTeamIds(["", " "])).toEqual([]);
    expect(() => normalizeProductionTeamIds(["design", "web"])).toThrowError(
      invalid("productionTeamIds", "too_many"),
    );
    // ポリシー値を上げれば複数に戻せる
    expect(normalizeProductionTeamIds(["design", "web"], { maxProductionTeams: 2 })).toEqual([
      "design",
      "web",
    ]);
    const legacy = makeWork({ productionTeamIds: ["design", "web"] });
    // 触らない変更は通る（読み・表示は壊さない）
    expect(applyWorkPatch(legacy, { title: "新しい名称" }).productionTeamIds).toEqual([
      "design",
      "web",
    ]);
    expect(() => applyWorkPatch(legacy, { productionTeamIds: ["design", "web"] })).toThrowError(
      invalid("productionTeamIds", "too_many"),
    );
    expect(applyWorkPatch(legacy, { productionTeamIds: ["web"] }).productionTeamIds).toEqual([
      "web",
    ]);
    expect(applyWorkPatch(legacy, { productionTeamIds: [] }).productionTeamIds).toEqual([]);
  });

  it("名簿で確かめるのは新しく職責に入る人だけ", () => {
    const work = makeWork();
    expect(newlyReferencedPeople(null, work).sort()).toEqual(["approver", "creator", "manager"]);
    expect(
      newlyReferencedPeople(work, { ...work, creatorIds: ["creator", "new"], approverId: "x" }),
    ).toEqual(["new", "x"]);
  });
});
