import type { api } from "@mf100/convex/api";
import { workStages, backlogDelayClass, backlogDelayTone } from "@mf100/domain";
import { useNavigate } from "@tanstack/react-router";
import type { FunctionReturnType } from "convex/server";
import { useState, type ReactNode } from "react";
import { deadlineLine } from "@/features/workspace/parts";
import { formatDeadline, formatJstDate, formatJstShort } from "@/lib/format";
import { rememberWorkHint } from "@/lib/workHint";
import { stageInfo } from "@/lib/stageInfo";
import { ColumnHeader, DataTable } from "@/ui/DataTable";
import { M3eButton } from "@m3e/react/button";
import { M3eCard } from "@m3e/react/card";
import { M3eExpansionPanel } from "@m3e/react/expansion-panel";
import { M3eHeading } from "@m3e/react/heading";
import { M3eLinearProgressIndicator } from "@m3e/react/progress-indicator";
import { M3eActionList, M3eListAction } from "@m3e/react/list";

type Data = FunctionReturnType<typeof api.dashboard.works>;
type Item = Data["pinned"][number];

/** 滞っている制作物の内訳（application の backlog）と、行の 2 行目 */
const backlogGroups: Array<[keyof Data["backlog"], string, (i: Item) => string]> = [
  [
    "overdue",
    "期限超過",
    (i) => `${deadlineLine("締切", i.deadlineAt)}${i.count ? `・未対応 ${i.count}` : ""}`,
  ],
  ["unassigned", "校正者が未割り当て", (i) => deadlineLine("締切", i.deadlineAt)],
  ["stale", "14 日間更新なし", (i) => `最終更新 ${formatJstDate(i.deadlineAt ?? 0)}`],
  ["dueSoon", "納期が近い", (i) => deadlineLine("納期", i.deadlineAt)],
];
/** 内訳ごとの表示件数（これを超えたら「すべて表示」） */
const BACKLOG_ROWS = 5;

const OPEN_KEY = "mf100.works-overview-open";
/** 前回の開け閉め（既定は閉じる）。localStorage が使えない環境でも壊れない */
function readOpen(): boolean {
  try {
    return localStorage.getItem(OPEN_KEY) === "1";
  } catch {
    return false;
  }
}
function remember(set: (open: boolean) => void, open: boolean) {
  set(open);
  try {
    localStorage.setItem(OPEN_KEY, open ? "1" : "0");
  } catch {
    // 覚えられなくても動く
  }
}

/**
 * 上段の数字（自分が関わる制作物の期限と、全体の未解決のコメント）。
 * 大きな数を左上から、基準の数（次の締切・解決済みの割合）を添える。色は意味のあるときだけ（期限超過 = error）
 */
function DashboardKpis({ data }: { data: Data }) {
  const { summary, overview, nextDeadline } = data;
  const comments = overview.threads.open + overview.threads.done;
  return (
    <section className="kpis kpis--three kpis--mock-row" aria-label="サマリー">
      <Kpi label="締切が近い" value={summary.dueSoon}>
        {nextDeadline?.deadlineAt ? (
          <span className="kpi__sub">次は {formatDeadline(nextDeadline.deadlineAt)}</span>
        ) : null}
      </Kpi>
      <Kpi label="期限超過" value={summary.overdue} tone={summary.overdue > 0 ? "error" : "none"} />
      <Kpi label="未対応のコメント" value={overview.threads.open}>
        {comments > 0 ? (
          <Meter
            value={overview.threads.done}
            max={comments}
            label={`コメントの解決 ${overview.threads.done} / ${comments}`}
            text={`解決 ${overview.threads.done} / ${comments}`}
          />
        ) : null}
      </Kpi>
    </section>
  );
}

function Kpi({
  label,
  value,
  tone = "none",
  children,
}: {
  label: string;
  value: number;
  tone?: "none" | "error";
  children?: ReactNode;
}) {
  return (
    <M3eCard variant="filled" className={`kpi ${tone === "error" ? "kpi--error" : ""}`}>
      <div slot="content" className="kpi__body">
        <span className="kpi__label">{label}</span>
        <span className="kpi__value">
          <span className="kpi__num">{value}</span>
          <span className="kpi__unit">件</span>
        </span>
        {children}
      </div>
    </M3eCard>
  );
}

/** 進み具合の細い棒（M3E linear progress。0 から始まる軸で、割合を長さで比べる） */
function Meter({
  value,
  max,
  label,
  text,
}: {
  value: number;
  max: number;
  label: string;
  text: string;
}) {
  return (
    <span className="meter">
      <M3eLinearProgressIndicator
        className="meter__bar"
        value={value}
        max={max}
        aria-label={label}
      />
      <span className="meter__text" aria-hidden="true">
        {text}
      </span>
    </span>
  );
}

/**
 * 制作物の状況（制作物のページの先頭。管理する人のための全体像）: 上に数字、左に滞っている制作物、右に内訳
 * （段階の積み上げ棒・解決と校正の進み・局別）。既定は閉じておく（その下の表に早く届くように。監査 W-01）。
 * 開け閉めは覚える（localStorage。使えないときは閉じたまま）。
 * 全部が空（制作物が 1 件も無い）のときは出さない
 */
export function DashboardOverview({ data, twoColumns }: { data: Data; twoColumns: boolean }) {
  const o = data.overview;
  const [open, setOpen] = useState(readOpen);
  if (o.total === 0) return null;
  const hasBacklog = backlogGroups.some(([k]) => data.backlog[k].length > 0);
  const breakdown = (
    <>
      <StageBreakdown data={data} />
      <Progress data={data} />
      <BureauTable data={data} />
    </>
  );
  return (
    <M3eExpansionPanel
      open={open}
      className="expansion ov"
      onOpening={() => remember(setOpen, true)}
      onClosing={() => remember(setOpen, false)}
    >
      <span slot="header" className="ov__header">
        <M3eHeading variant="title" size="medium" level={2} emphasized id="ov-title">
          制作物の状況
        </M3eHeading>
        <time className="ov__asof" dateTime={new Date(o.asOf).toISOString()}>
          {formatJstShort(o.asOf)} 時点
        </time>
      </span>
      <div className="ov__body">
        <DashboardKpis data={data} />
        {hasBacklog ? (
          <div className={twoColumns ? "dash dash--columns" : "dash"}>
            <div className="dash__column ov__main">
              <Backlog data={data} />
            </div>
            <div className="dash__column dash__column--side ov__side">{breakdown}</div>
          </div>
        ) : (
          <div className="dash__column dash__column--side ov__side ov__side--flat">{breakdown}</div>
        )}
      </div>
    </M3eExpansionPanel>
  );
}

/** 滞っている制作物（期限超過・校正者が未割り当て・動きがない・納期が近い）。内訳ごとに数件、押すとエディタが開く */
function Backlog({ data }: { data: Data }) {
  const navigate = useNavigate();
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const toggle = (k: string) =>
    setExpanded((s) => {
      const n = new Set(s);
      if (n.has(k)) n.delete(k);
      else n.add(k);
      return n;
    });
  return (
    <section className="dash__section" aria-labelledby="ov-backlog">
      <div className="dash__head">
        <M3eHeading variant="title" size="medium" level={3} emphasized id="ov-backlog">
          滞っている制作物
        </M3eHeading>
      </div>
      {backlogGroups
        .filter(([k]) => data.backlog[k].length > 0)
        .map(([k, title, sub]) => {
          const all = data.backlog[k];
          const items = expanded.has(k) ? all : all.slice(0, BACKLOG_ROWS);
          return (
            <div key={k} className="dash__group">
              <h4 className="dash__subtitle">
                {title}
                <span className="dash__count">{all.length}</span>
              </h4>
              <M3eActionList className="list" aria-label={title}>
                {items.map((i) => {
                  const delayTone =
                    k === "overdue" && i.deadlineAt
                      ? backlogDelayTone(i.deadlineAt, data.overview.asOf)
                      : "none";
                  const delayClass = backlogDelayClass(delayTone);
                  return (
                    <M3eListAction
                      key={`${i.workId}-${i.revisionId}`}
                      className={`list__item ${delayClass}`.trim()}
                      onClick={() => {
                        rememberWorkHint(i.workId, { title: i.workTitle });
                        void navigate({ to: "/works/$workId", params: { workId: i.workId } });
                      }}
                    >
                      <span className="list__headline">
                        {i.workTitle}
                        {i.revisionLabel ? (
                          <span className="muted">　{i.revisionLabel}</span>
                        ) : null}
                      </span>
                      <span slot="supporting-text">{sub(i)}</span>
                    </M3eListAction>
                  );
                })}
              </M3eActionList>
              {all.length > BACKLOG_ROWS ? (
                <M3eButton variant="text" className="dash__more" onClick={() => toggle(k)}>
                  {expanded.has(k) ? "閉じる" : `すべて表示（${all.length} 件）`}
                </M3eButton>
              ) : null}
            </div>
          );
        })}
    </section>
  );
}

/** 段階の積み上げ棒。棒は画像として「未提出 1・校正中 2」と読み上げ、下の凡例（文字と数）が同じ内容を表で出す */
function StageBreakdown({ data }: { data: Data }) {
  const { stages, total } = data.overview;
  const present = workStages.filter((s) => stages[s] > 0);
  const summary = present.map((s) => `${stageInfo[s].label} ${stages[s]}`).join("・");
  return (
    <section className="ov__block" aria-labelledby="ov-stages">
      <div className="ov__blockhead">
        <M3eHeading
          variant="title"
          size="small"
          level={3}
          className="dash__title--side"
          id="ov-stages"
        >
          状態の内訳
        </M3eHeading>
        <span className="spacer" />
        <span className="dash__count">全 {total} 件</span>
      </div>
      <div className="stagebar stagebar--mock" role="img" aria-label={`状態の内訳: ${summary}`}>
        {present.map((s) => (
          <span
            key={s}
            className={`stagebar__seg stagebar__seg--${s}`}
            style={{ flexGrow: stages[s] }}
            title={`${stageInfo[s].label} ${stages[s]}`}
          />
        ))}
      </div>
      <ul className="legend">
        {present.map((s) => (
          <li key={s} className="legend__item">
            <span className={`legend__swatch stagebar__seg--${s}`} aria-hidden="true" />
            <span className="legend__label">{stageInfo[s].label}</span>
            <span className="legend__num">{stages[s]}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** コメントの解決と、校正者の確認の進み（0 から始まる棒） */
function Progress({ data }: { data: Data }) {
  const { reviewers, checksPending } = data.overview;
  if (reviewers.total === 0 && checksPending === 0) return null;
  return (
    <section className="ov__block" aria-labelledby="ov-progress">
      <M3eHeading
        variant="title"
        size="small"
        level={3}
        className="dash__title--side"
        id="ov-progress"
      >
        校正の進み
      </M3eHeading>
      <div className="progress-rows">
        {reviewers.total > 0 ? (
          <ProgressRow
            label="校正の完了"
            value={reviewers.done}
            max={reviewers.total}
            text={`${reviewers.done} / ${reviewers.total}`}
          />
        ) : null}
        {checksPending > 0 ? (
          <div className="progress-row">
            <span className="progress-row__label">未完了の専門確認</span>
            <span className="progress-row__text">{checksPending}</span>
          </div>
        ) : null}
      </div>
    </section>
  );
}

function ProgressRow({
  label,
  value,
  max,
  text,
}: {
  label: string;
  value: number;
  max: number;
  text: string;
}) {
  return (
    <div className="progress-row">
      <span className="progress-row__label">{label}</span>
      <span className="progress-row__text">{text}</span>
      <M3eLinearProgressIndicator
        className="progress-row__bar"
        value={value}
        max={max}
        aria-label={`${label} ${text}`}
      />
    </div>
  );
}

/** 局ごとの数。主管担当を決めた制作物が無ければ（全部が未設定なら）出さない */
function BureauTable({ data }: { data: Data }) {
  const rows = data.overview.bureaus;
  if (rows.every((b) => b.bureau === "")) return null;
  return (
    <section className="ov__block ov__block--bureau-mock" aria-labelledby="ov-bureaus">
      <M3eHeading
        variant="title"
        size="small"
        level={3}
        className="dash__title--side"
        id="ov-bureaus"
      >
        局別
      </M3eHeading>
      <DataTable label="局別の制作物" dense flush>
        <thead>
          <tr>
            <ColumnHeader>局</ColumnHeader>
            <ColumnHeader numeric>制作物</ColumnHeader>
            <ColumnHeader numeric>校正中</ColumnHeader>
            <ColumnHeader numeric>未対応</ColumnHeader>
            <ColumnHeader numeric>校了</ColumnHeader>
          </tr>
        </thead>
        <tbody>
          {rows.map((b) => (
            <tr key={b.bureau} className="mf-table__row">
              <th scope="row" className="mf-table__td">
                {b.bureau || <span className="muted">未設定</span>}
              </th>
              <td className="mf-table__td mf-table__num">{b.works}</td>
              <td className="mf-table__td mf-table__num">{b.reviewing}</td>
              <td className="mf-table__td mf-table__num">{b.unresolved}</td>
              <td className="mf-table__td mf-table__num">{b.finalized}</td>
            </tr>
          ))}
        </tbody>
      </DataTable>
    </section>
  );
}
