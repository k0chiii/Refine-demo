/**
 * manifest-dashboard-cd.json の 1 id 分の変更を wt-cd-stack に適用
 */
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "../..");

function read(rel) {
  return fs.readFileSync(path.join(root, rel), "utf8");
}
function write(rel, c) {
  fs.writeFileSync(path.join(root, rel), c);
}
function patch(rel, pairs) {
  let c = read(rel);
  for (const [from, to] of pairs) {
    if (!c.includes(from)) throw new Error(`patch miss in ${rel}: ${from.slice(0, 80)}`);
    c = c.replace(from, to);
  }
  write(rel, c);
}
function appendCss(marker, chunk) {
  const rel = "apps/web/src/styles.css";
  let c = read(rel);
  if (c.includes(marker)) return;
  c += `\n/* stack-pr:${marker} */\n${chunk}\n`;
  write(rel, c);
}

const ROLE_HOME = `import { api } from "@mf100/convex/api";
import { useQuery } from "convex/react";
import { DashboardOverview } from "@/features/home/DashboardOverview";
import { useWindowClass } from "@/lib/useMedia";

type Variant = "manager" | "approver" | "member";

export function RoleHomeDashboard({ variant }: { variant: Variant }) {
  const me = useQuery(api.me.me, {});
  const dash = useQuery(api.dashboard.works, variant === "manager" ? {} : "skip");
  const cls = useWindowClass();
  const twoColumns = cls === "expanded" || cls === "large";
  if (variant === "manager" && me?.canCreateWorks && dash) {
    return (
      <div className="home-dashboard home-dashboard--manager">
        <p className="role-home-tag">主管ビュー</p>
        <DashboardOverview data={dash} twoColumns={twoColumns} />
      </div>
    );
  }
  if (variant === "approver" && me?.canAssignApprovers) {
    return (
      <div className="home-dashboard home-dashboard--approver" aria-label="校了ビュー">
        <p className="role-home-tag">校了ビュー</p>
      </div>
    );
  }
  if (variant === "member") {
    return (
      <div className="home-dashboard home-dashboard--member" aria-label="メンバービュー">
        <p className="role-home-tag">メンバービュー</p>
      </div>
    );
  }
  return null;
}
`;

export function applyCdEdit(id) {
  switch (id) {
    case "078":
      patch("apps/web/src/features/home/DashboardOverview.tsx", [
        [`className="kpis kpis--three"`, `className="kpis kpis--three kpis--mock-row"`],
      ]);
      appendCss(
        "ui-kpi-row-mock",
        `.kpis--mock-row {
  margin-block-end: 4px;
}
@media (min-width: 840px) {
  .kpis--mock-row {
    grid-template-columns: 2fr 1fr 1fr;
  }
}`,
      );
      return;
    case "079":
      patch("apps/web/src/features/home/DashboardOverview.tsx", [
        [`className="stagebar"`, `className="stagebar stagebar--mock"`],
        [
          `className="ov__block" aria-labelledby="ov-bureaus"`,
          `className="ov__block ov__block--bureau-mock" aria-labelledby="ov-bureaus"`,
        ],
      ]);
      appendCss(
        "ui-graphs-stage-bureau",
        `.stagebar--mock {
  min-height: 12px;
  border-radius: var(--mf-shape-sm);
}
.ov__block--bureau-mock .mf-table {
  --mf-table-header-bg: var(--mf-surface-container-high);
}`,
      );
      return;
    case "080": {
      write(
        "apps/web/src/features/home/SnsHomeBand.tsx",
        `import { api } from "@mf100/convex/api";
import { useQuery } from "convex/react";
import { M3eCard } from "@m3e/react/card";
import { M3eHeading } from "@m3e/react/heading";

/** SNS 帯: 校了者または制作物登録権限（SNS 主管相当）だけ */
export function SnsHomeBand() {
  const me = useQuery(api.me.me, {});
  const make = useQuery(api.dashboard.make, {});
  if (!me?.canAssignApprovers && !me?.canCreateWorks) return null;
  const snsCount = make?.works.filter((w) => w.isCreator).length ?? 0;
  if (snsCount === 0) return null;
  return (
    <M3eCard variant="filled" className="sns-home-band">
      <div slot="content">
        <M3eHeading variant="title" size="small" level={2}>
          SNS 投稿
        </M3eHeading>
        <p className="sns-home-band__meta">{snsCount} 件が進行中</p>
      </div>
    </M3eCard>
  );
}
`,
      );
      patch("apps/web/src/routes/_app/make.tsx", [
        [
          `import { ViewSwitcher } from "@/features/home/ViewSwitcher";`,
          `import { ViewSwitcher } from "@/features/home/ViewSwitcher";
import { SnsHomeBand } from "@/features/home/SnsHomeBand";`,
        ],
        [
          `      {tabs}`,
          `      <SnsHomeBand />
      {tabs}`,
        ],
      ]);
      appendCss(
        "ui-sns-band-visibility",
        `.sns-home-band {
  margin: 0 16px 12px;
  --m3e-filled-card-container-color: var(--mf-secondary-container);
}
.sns-home-band__meta {
  margin: 4px 0 0;
  color: var(--mf-on-secondary-container);
}`,
      );
      return;
    }
    case "081":
      patch("apps/web/src/features/home/DashboardOverview.tsx", [
        [
          `function Kpi({`,
          `const kpiLabelEn: Record<string, string> = {
  "締切が近い": "Due soon",
  "期限超過": "Overdue",
  "未対応のコメント": "Open threads",
};

function Kpi({`,
        ],
        [
          `<span className="kpi__label">{label}</span>`,
          `<span className="kpi__label">{label}<span className="kpi__label-en" aria-hidden="true">{kpiLabelEn[label] ?? ""}</span></span>`,
        ],
      ]);
      appendCss(
        "ui-english-parallel-labels",
        `.kpi__label-en {
  display: block;
  font-size: 11px;
  font-weight: 400;
  color: var(--mf-on-surface-variant);
  margin-top: 2px;
}`,
      );
      return;
    case "082": {
      write(
        "packages/domain/src/dashboard/submissionPrepDays.ts",
        `/** 入稿準備日数（Issue #92）。planned が無ければ null */
export function submissionPrepDays(
  plannedSubmitAt: number | undefined,
  now: number,
): number | null {
  if (plannedSubmitAt == null) return null;
  const day = 86_400_000;
  return Math.max(0, Math.ceil((plannedSubmitAt - now) / day));
}
`,
      );
      write(
        "packages/domain/src/__tests__/submissionPrepDays.test.ts",
        `import { describe, expect, it } from "vitest";
import { submissionPrepDays } from "../dashboard/submissionPrepDays.ts";

describe("submissionPrepDays", () => {
  const now = 1_000_000;
  it("returns days until planned submit", () => {
    expect(submissionPrepDays(now + 3 * 86_400_000, now)).toBe(3);
  });
  it("null when no planned date", () => {
    expect(submissionPrepDays(undefined, now)).toBeNull();
  });
});
`,
      );
      patch("packages/domain/src/index.ts", [
        [
          `export * from "./dashboard/backlogDelay.ts";`,
          `export * from "./dashboard/backlogDelay.ts";
export * from "./dashboard/submissionPrepDays.ts";`,
        ],
      ]);
      patch("packages/domain/src/revision/Revision.ts", [
        [
          `  deadlineAt: Instant;
  reviewState: ReviewState;`,
          `  deadlineAt: Instant;
  plannedSubmitAt?: Instant;
  reviewState: ReviewState;`,
        ],
      ]);
      patch("packages/domain/src/dashboard/workSummary.ts", [
        [
          `  deadlineAt: Instant;
  /** 期限到来で受付が終わった版 */
  lapsed: boolean;`,
          `  deadlineAt: Instant;
  plannedSubmitAt?: Instant;
  /** 期限到来で受付が終わった版 */
  lapsed: boolean;`,
        ],
        [
          `    deadlineAt: revision.deadlineAt,
    lapsed: revision.reviewState === "closed" && revision.reviewClosedReason === "deadline",`,
          `    deadlineAt: revision.deadlineAt,
    ...(revision.plannedSubmitAt != null ? { plannedSubmitAt: revision.plannedSubmitAt } : {}),
    lapsed: revision.reviewState === "closed" && revision.reviewClosedReason === "deadline",`,
        ],
      ]);
      patch("packages/application/src/usecases/dashboard.ts", [
        [
          `  deadlineAt: number | null;
  /** 未対応のコメント数など、行の右に出す数 */
  count: number;`,
          `  deadlineAt: number | null;
  plannedSubmitAt?: number;
  /** 未対応のコメント数など、行の右に出す数 */
  count: number;`,
        ],
        [
          `    deadlineAt,
    count,
  };`,
          `    deadlineAt,
    plannedSubmitAt: r?.plannedSubmitAt ?? undefined,
    count,
  };`,
        ],
      ]);
      patch("apps/web/src/features/home/DashboardOverview.tsx", [
        [
          `import { workStages, backlogDelayClass, backlogDelayTone } from "@mf100/domain";`,
          `import { workStages, backlogDelayClass, backlogDelayTone, submissionPrepDays } from "@mf100/domain";`,
        ],
        [
          `["dueSoon", "納期が近い", (i) => deadlineLine("納期", i.deadlineAt)],`,
          `[
    "dueSoon",
    "納期が近い",
    (i) => {
      const prep = submissionPrepDays(i.plannedSubmitAt, data.overview.asOf);
      const base = deadlineLine("納期", i.deadlineAt);
      return prep != null ? \`\${base}・入稿準備 \${prep} 日\` : base;
    },
  ],`,
        ],
      ]);
      return;
    }
    case "083":
      write("apps/web/src/features/home/RoleHomeDashboard.tsx", ROLE_HOME);
      patch("apps/web/src/routes/_app/make.tsx", [
        [
          `import { SnsHomeBand } from "@/features/home/SnsHomeBand";`,
          `import { SnsHomeBand } from "@/features/home/SnsHomeBand";
import { RoleHomeDashboard } from "@/features/home/RoleHomeDashboard";`,
        ],
        [
          `      <SnsHomeBand />`,
          `      <RoleHomeDashboard variant="manager" />
      <SnsHomeBand />`,
        ],
      ]);
      appendCss(
        "ui-role-home-manager",
        `.home-dashboard--manager .ov { margin-inline: 16px; }
.role-home-tag {
  margin: 0 16px 8px;
  font-size: 12px;
  font-weight: 600;
  color: var(--mf-on-surface-variant);
}`,
      );
      patch("apps/web/src/routes/_app/works/index.tsx", [
        [
          `import { DashboardOverview } from "@/features/home/DashboardOverview";`,
          `import { DashboardOverview } from "@/features/home/DashboardOverview";
import { RoleHomeDashboard } from "@/features/home/RoleHomeDashboard";`,
        ],
        [
          `{dash ? <DashboardOverview data={dash} twoColumns={twoColumns} /> : null}`,
          `{dash ? (
        <div className="home-dashboard home-dashboard--manager">
          <p className="role-home-tag">主管ビュー</p>
          <DashboardOverview data={dash} twoColumns={twoColumns} />
        </div>
      ) : null}`,
        ],
      ]);
      return;
    case "084":
      patch("apps/web/src/routes/_app/make.tsx", [
        [`<RoleHomeDashboard variant="manager" />`, `<RoleHomeDashboard variant="approver" />`],
      ]);
      patch("apps/web/src/routes/_app/works/index.tsx", [
        [
          `<div className="works">`,
          `<RoleHomeDashboard variant="approver" />
      <div className="works">`,
        ],
      ]);
      appendCss(
        "ui-role-home-approver",
        `.home-dashboard--approver {
  margin: 8px 16px;
  padding: 12px 16px;
  border-radius: var(--mf-shape-lg);
  background: var(--mf-tertiary-container);
  color: var(--mf-on-tertiary-container);
  min-height: 48px;
}`,
      );
      return;
    case "085":
      patch("apps/web/src/routes/_app/make.tsx", [
        [`<RoleHomeDashboard variant="approver" />`, `<RoleHomeDashboard variant="member" />`],
      ]);
      appendCss(
        "ui-role-home-member",
        `.home-dashboard--member { margin: 8px 16px; min-height: 32px; }`,
      );
      return;
    case "086":
      appendCss(
        "ui-detail-shell-mock",
        `.detail-shell {
  background: var(--mf-surface-container-lowest);
  min-height: 720px;
}
.detail-shell__head {
  border-bottom: 1px solid var(--mf-outline-variant);
}`,
      );
      return;
    case "087":
      appendCss(
        "ui-tablet-layout",
        `@media (min-width: 600px) and (max-width: 839px) {
  .dash--columns {
    grid-template-columns: 1fr;
  }
  .home-dashboard--manager .kpis--three {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
}`,
      );
      return;
    case "088":
      appendCss(
        "ui-dark-theme-home",
        `@media (prefers-color-scheme: dark) {
  .home-dashboard--manager .kpi,
  .ov .kpi {
    --m3e-filled-card-container-color: var(--mf-surface-container-high);
  }
  .sns-home-band {
    --m3e-filled-card-container-color: var(--mf-surface-container);
  }
}`,
      );
      return;
    default:
      throw new Error(`unknown cd id ${id}`);
  }
}

if (process.argv[1]?.includes("cd-edits.mjs")) {
  applyCdEdit(process.argv[2]);
}
