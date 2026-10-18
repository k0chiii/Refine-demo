import { describe, expect, it } from "vite-plus/test";
import {
  bureauNameOf,
  compareWorkRows,
  nextDeadlineOf,
  summarizeByBureau,
  tallyResolutions,
  tallyStages,
  workStageOf,
  workStages,
  workUrgency,
  type WorkOverviewRow,
} from "../dashboard/overview.ts";
import type { Team } from "../org/team.ts";

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 9, 18);
const SOON = 7 * DAY;

const base = {
  stage: "reviewing" as const,
  reviewDeadlineAt: null,
  deliveryAt: null,
  unresolved: 0,
  reviewersTotal: 1,
  checksPending: 0,
};

describe("制作物の段階", () => {
  it("下書き・取消は数えない。校了・保留はライフサイクルのまま", () => {
    const f = (lifecycle: Parameters<typeof workStageOf>[0]["lifecycle"]) =>
      workStageOf({ lifecycle, accepting: false, hasRevision: true });
    expect(f("draft")).toBeNull();
    expect(f("cancelled")).toBeNull();
    expect(f("finalized")).toBe("finalized");
    expect(f("on_hold")).toBe("on_hold");
  });

  it("進行中は、受付中の版→校正中、版はあるが受付が終わっている→受付終了、版なし→未提出", () => {
    expect(workStageOf({ lifecycle: "active", accepting: true, hasRevision: true })).toBe(
      "reviewing",
    );
    expect(workStageOf({ lifecycle: "active", accepting: false, hasRevision: true })).toBe(
      "lapsed",
    );
    expect(workStageOf({ lifecycle: "active", accepting: false, hasRevision: false })).toBe(
      "unsubmitted",
    );
  });

  it("段階ごとの数は、無い段階も 0 で返す", () => {
    const t = tallyStages(["reviewing", "reviewing", "finalized"]);
    expect(t).toEqual({ unsubmitted: 0, reviewing: 2, lapsed: 0, on_hold: 0, finalized: 1 });
    expect(Object.keys(t)).toEqual([...workStages]);
  });
});

describe("指摘の数え方", () => {
  it("未対応・確認済み・採用済み未反映は未解決、反映済み・不採用・持越は片付いた", () => {
    expect(
      tallyResolutions(["open", "acknowledged", "accepted", "resolved", "rejected", "deferred"]),
    ).toEqual({ open: 3, done: 3 });
    expect(tallyResolutions([])).toEqual({ open: 0, done: 0 });
  });
});

describe("注意の度合い", () => {
  it("次の締切は校正期限と納期の早いほう", () => {
    expect(nextDeadlineOf({ reviewDeadlineAt: 10, deliveryAt: 5 })).toBe(5);
    expect(nextDeadlineOf({ reviewDeadlineAt: null, deliveryAt: 5 })).toBe(5);
    expect(nextDeadlineOf({ reviewDeadlineAt: null, deliveryAt: null })).toBeNull();
  });

  it("受付が終わったまま、または締切を過ぎたら overdue。校了・保留は常に calm", () => {
    expect(workUrgency({ ...base, stage: "lapsed" }, NOW, SOON)).toBe("overdue");
    expect(workUrgency({ ...base, deliveryAt: NOW - 1 }, NOW, SOON)).toBe("overdue");
    expect(workUrgency({ ...base, stage: "finalized", deliveryAt: NOW - 1 }, NOW, SOON)).toBe(
      "calm",
    );
    expect(workUrgency({ ...base, stage: "on_hold", deliveryAt: NOW - 1 }, NOW, SOON)).toBe("calm");
  });

  it("締切が閾値ちょうどなら soon、1ms 超えれば soon ではない", () => {
    expect(workUrgency({ ...base, reviewDeadlineAt: NOW + SOON }, NOW, SOON)).toBe("soon");
    expect(workUrgency({ ...base, reviewDeadlineAt: NOW + SOON + 1 }, NOW, SOON)).toBe("calm");
  });

  it("未解決の指摘・専門確認・校正者不在は open、何も無ければ calm", () => {
    expect(workUrgency({ ...base, unresolved: 1 }, NOW, SOON)).toBe("open");
    expect(workUrgency({ ...base, checksPending: 1 }, NOW, SOON)).toBe("open");
    expect(workUrgency({ ...base, reviewersTotal: 0 }, NOW, SOON)).toBe("open");
    expect(workUrgency({ ...base, stage: "unsubmitted", reviewersTotal: 0 }, NOW, SOON)).toBe(
      "calm",
    );
    expect(workUrgency(base, NOW, SOON)).toBe("calm");
  });
});

describe("表の並び", () => {
  const row = (
    title: string,
    over: Partial<Pick<WorkOverviewRow, "stage" | "unresolved" | "nextDeadlineAt" | "urgency">>,
  ) => ({
    title,
    stage: "reviewing" as const,
    unresolved: 0,
    nextDeadlineAt: null,
    urgency: "calm" as const,
    ...over,
  });

  it("期限超過 → 期限が近い → 手を付けるもの → 落ち着き。保留・校了は最後。同じなら締切が早い順、未解決が多い順", () => {
    const rows = [
      row("calm", {}),
      row("final", { stage: "finalized" }),
      row("soon-late", { urgency: "soon", nextDeadlineAt: 20 }),
      row("hold", { stage: "on_hold", urgency: "calm" }),
      row("open", { urgency: "open", unresolved: 2 }),
      row("soon-early", { urgency: "soon", nextDeadlineAt: 10 }),
      row("over", { urgency: "overdue", nextDeadlineAt: 99 }),
      row("open-more", { urgency: "open", unresolved: 5 }),
    ];
    expect([...rows].sort(compareWorkRows).map((r) => r.title)).toEqual([
      "over",
      "soon-early",
      "soon-late",
      "open-more",
      "open",
      "calm",
      "hold",
      "final",
    ]);
  });
});

describe("局ごとの集計", () => {
  const team = (t: Partial<Team> & Pick<Team, "id" | "name" | "kind">): Team => ({
    order: 1,
    updatedAt: 0,
    updatedBy: "u",
    ...t,
  });
  const teams: Team[] = [
    team({ id: "b1", name: "広報局", kind: "bureau" }),
    team({ id: "t1", name: "デザイン担当", kind: "team", parentId: "b1" }),
    team({ id: "b2", name: "総務局", kind: "bureau" }),
  ];

  it("担当は親の局、局はそのまま、未設定・見つからないものは空", () => {
    expect(bureauNameOf("t1", teams)).toBe("広報局");
    expect(bureauNameOf("b2", teams)).toBe("総務局");
    expect(bureauNameOf(undefined, teams)).toBe("");
    expect(bureauNameOf("zzz", teams)).toBe("");
  });

  it("制作物の多い局から。未設定は最後。校正中・校了・未解決を足し合わせる", () => {
    const r = (
      bureau: string,
      stage: WorkOverviewRow["stage"],
      unresolved = 0,
    ): Pick<WorkOverviewRow, "bureau" | "stage" | "unresolved"> => ({ bureau, stage, unresolved });
    const s = summarizeByBureau([
      r("", "unsubmitted"),
      r("総務局", "reviewing", 1),
      r("広報局", "reviewing", 2),
      r("広報局", "finalized"),
      r("広報局", "unsubmitted"),
    ]);
    expect(s.map((x) => x.bureau)).toEqual(["広報局", "総務局", ""]);
    expect(s[0]).toEqual({
      bureau: "広報局",
      works: 3,
      reviewing: 1,
      unresolved: 2,
      finalized: 1,
    });
    expect(s[1]).toMatchObject({ works: 1, reviewing: 1, unresolved: 1, finalized: 0 });
  });
});
