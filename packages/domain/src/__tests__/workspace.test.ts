import { describe, expect, it } from "vite-plus/test";
import {
  checkStateOfAssignment,
  classifyMakeRow,
  defaultWorkspace,
  groupCheckEntries,
  landingWorkspace,
  type CheckEntryLike,
} from "../index.ts";

describe("最初に開く入口", () => {
  const none = { reviewsUnfinished: 0, checksPending: 0, finalizeReady: 0 };
  it("校正のやり残しが 1 つでもあれば校正、無ければ制作", () => {
    expect(defaultWorkspace(none)).toBe("make");
    expect(defaultWorkspace({ ...none, reviewsUnfinished: 1 })).toBe("check");
    expect(defaultWorkspace({ ...none, checksPending: 2 })).toBe("check");
    expect(defaultWorkspace({ ...none, finalizeReady: 1 })).toBe("check");
  });

  it("最後に使った入口を優先し、読み込み中は決めない。壊れた保存値は無視する", () => {
    expect(landingWorkspace("make", { ...none, reviewsUnfinished: 3 })).toBe("make");
    expect(landingWorkspace("check", none)).toBe("check");
    expect(landingWorkspace("check", undefined)).toBe("check");
    expect(landingWorkspace(null, undefined)).toBeNull();
    expect(landingWorkspace("home", undefined)).toBeNull();
    expect(landingWorkspace("home", { ...none, finalizeReady: 1 })).toBe("check");
    expect(landingWorkspace(undefined, none)).toBe("make");
  });
});

describe("制作: 要対応と校正中", () => {
  it("未対応のコメントがあれば、受付中でも提出できても「対応する」が先", () => {
    expect(classifyMakeRow({ accepting: true, toRespond: 2, canSubmit: true })).toEqual({
      group: "turn",
      action: "respond",
    });
  });

  it("受付中の版が無く提出できるなら「版を提出」。まだ版が無い場合も同じ", () => {
    expect(classifyMakeRow({ accepting: false, toRespond: 0, canSubmit: true })).toEqual({
      group: "turn",
      action: "submit",
    });
  });

  it("受付中で対応するコメントが無ければ校正中。提出できなくても見るだけ", () => {
    expect(classifyMakeRow({ accepting: true, toRespond: 0, canSubmit: true })).toEqual({
      group: "waiting",
      action: "view",
    });
    expect(classifyMakeRow({ accepting: false, toRespond: 0, canSubmit: false })).toEqual({
      group: "waiting",
      action: "view",
    });
  });
});

describe("校正: 未着手・確認中・完了", () => {
  const e = (title: string, state: CheckEntryLike["state"], deadlineAt: number | null) => ({
    title,
    state,
    deadlineAt,
  });

  it("割当の状態を仕事の進み具合に写す", () => {
    expect(checkStateOfAssignment("pending")).toBe("pending");
    expect(checkStateOfAssignment("viewed")).toBe("viewed");
    expect(checkStateOfAssignment("responded")).toBe("done");
    expect(checkStateOfAssignment("excused")).toBe("done");
  });

  it("進み具合で分け、各々を締切順に並べる（締切なしは後ろ、同じなら題名順）", () => {
    const g = groupCheckEntries([
      e("い", "pending", 300),
      e("あ", "pending", 100),
      e("う", "pending", null),
      e("え", "pending", 100),
      e("お", "viewed", 50),
      e("か", "done", 10),
    ]);
    expect(g.todo.map((x) => x.title)).toEqual(["あ", "え", "い", "う"]);
    expect(g.doing.map((x) => x.title)).toEqual(["お"]);
    expect(g.done.map((x) => x.title)).toEqual(["か"]);
  });

  it("校了する行は締切より先に、未着手の先頭へ固める", () => {
    const g = groupCheckEntries([
      e("あ", "pending", 100),
      { ...e("い", "pending", 900), kind: "finalize" as const },
      { ...e("う", "pending", 500), kind: "finalize" as const },
      { ...e("え", "pending", 50), kind: "review" as const },
    ]);
    expect(g.todo.map((x) => x.title)).toEqual(["う", "い", "え", "あ"]);
  });
});
