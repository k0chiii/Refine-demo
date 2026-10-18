import type { api } from "@mf100/convex/api";
import { workStages, type WorkStage, type WorkUrgency } from "@mf100/domain";
import { Link } from "@tanstack/react-router";
import type { FunctionReturnType } from "convex/server";
import { useState, type ReactNode } from "react";
import { formatDeadline, formatJstShort, remaining } from "@/lib/format";
import { rememberWorkHint } from "@/lib/workHint";
import { StatusText, type ChipTone } from "@/ui/Chip";
import { M3eButton } from "@m3e/react/button";
import { M3eCard } from "@m3e/react/card";
import { M3eHeading } from "@m3e/react/heading";
import { M3eLinearProgressIndicator } from "@m3e/react/progress-indicator";

type Data = FunctionReturnType<typeof api.dashboard.get>;
type Row = Data["overview"]["works"][number];

/** 段階の名前・アイコン・色の意味（色だけに頼らず、文字とアイコンでも出す） */
const stageInfo: Record<WorkStage, { label: string; icon: string; tone: ChipTone }> = {
  unsubmitted: { label: "未提出", icon: "upload_file", tone: "neutral" },
  reviewing: { label: "校正中", icon: "rate_review", tone: "primary" },
  lapsed: { label: "受付終了", icon: "error", tone: "error" },
  on_hold: { label: "保留", icon: "pause", tone: "warning" },
  finalized: { label: "校了", icon: "task_alt", tone: "success" },
};

/** 表の行数（これを超えたら「すべて表示」） */
const TABLE_ROWS = 8;

/**
 * 上段の数字（自分の数字 3 つと、全体の未解決のコメント）。
 * 大きな数を左上から、基準の数（次の締切・解決済みの割合）を添える。色は意味のあるときだけ（期限超過 = error）
 */
export function DashboardKpis({ data }: { data: Data }) {
  const { summary, overview, nextDeadline } = data;
  const comments = overview.threads.open + overview.threads.done;
  return (
    <section className="kpis" aria-label="サマリー">
      <Kpi label="やること" value={summary.todo}>
        {summary.unread > 0 ? (
          <span className="kpi__sub">未読のコメント {summary.unread}</span>
        ) : null}
      </Kpi>
      <Kpi label="締切が近い" value={summary.dueSoon}>
        {nextDeadline?.deadlineAt ? (
          <span className="kpi__sub">次は {formatDeadline(nextDeadline.deadlineAt)}</span>
        ) : null}
      </Kpi>
      <Kpi label="期限超過" value={summary.overdue} tone={summary.overdue > 0 ? "error" : "none"} />
      <Kpi label="未解決のコメント" value={overview.threads.open}>
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
 * 制作物の状況: 左に表（注意が要る順）、右に内訳（段階の積み上げ棒・解決と校正の進み・局別）。
 * 全部が空（制作物が 1 件も無い）のときは出さない
 */
export function DashboardOverview({ data, twoColumns }: { data: Data; twoColumns: boolean }) {
  const o = data.overview;
  if (o.total === 0) return null;
  return (
    <section className="ov" aria-labelledby="ov-title">
      <div className="dash__head">
        <M3eHeading variant="title" size="large" level={2} emphasized id="ov-title">
          制作物の状況
        </M3eHeading>
        <span className="spacer" />
        <time className="ov__asof" dateTime={new Date(o.asOf).toISOString()}>
          {formatJstShort(o.asOf)} 時点
        </time>
      </div>
      <div className={twoColumns ? "dash dash--columns" : "dash"}>
        <div className="dash__column ov__main">
          <WorkTable rows={o.works} now={o.asOf} />
        </div>
        <div className="dash__column dash__column--side ov__side">
          <StageBreakdown data={data} />
          <Progress data={data} />
          <BureauTable data={data} />
        </div>
      </div>
    </section>
  );
}

const urgencyTone: Record<WorkUrgency, ChipTone> = {
  overdue: "error",
  soon: "warning",
  open: "neutral",
  calm: "neutral",
};

function WorkTable({ rows, now }: { rows: Row[]; now: number }) {
  const [all, setAll] = useState(false);
  const shown = all ? rows : rows.slice(0, TABLE_ROWS);
  if (rows.length === 0) return <p className="muted ov__none">進行中の制作物はありません</p>;
  return (
    <>
      <div className="dtable">
        <table className="dtable__table" aria-label="進行中の制作物">
          <thead>
            <tr>
              <th scope="col" className="dtable__th">
                制作物
              </th>
              <th scope="col" className="dtable__th dtable__col--stage">
                状態
              </th>
              <th scope="col" className="dtable__th">
                締切
              </th>
              <th scope="col" className="dtable__th dtable__num">
                未解決
              </th>
              <th scope="col" className="dtable__th dtable__num dtable__col--review">
                校正
              </th>
              <th scope="col" className="dtable__th dtable__col--bureau">
                局
              </th>
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => (
              <WorkRow key={r.workId} r={r} now={now} />
            ))}
          </tbody>
        </table>
      </div>
      {rows.length > TABLE_ROWS ? (
        <M3eButton variant="text" className="dash__more" onClick={() => setAll((v) => !v)}>
          {all ? "閉じる" : `すべて表示（${rows.length} 件）`}
        </M3eButton>
      ) : null}
    </>
  );
}

function WorkRow({ r, now }: { r: Row; now: number }) {
  const s = stageInfo[r.stage];
  const next = r.nextDeadlineAt;
  const kind = next !== null && r.deliveryAt === next ? "納期" : "校正";
  const overdue = r.urgency === "overdue";
  const tone = urgencyTone[r.urgency];
  return (
    <tr className={`dtable__row dtable__row--${r.urgency}`}>
      <th scope="row" className="dtable__td dtable__title">
        <Link
          to="/works/$workId"
          params={{ workId: r.workId }}
          className="dtable__link"
          onClick={() => rememberWorkHint(r.workId, { title: r.title })}
        >
          {r.title}
        </Link>
        {/* 状態の列が隠れる幅では、題名の下に出す */}
        <span className="dtable__sub dtable__stage-inline">
          <StatusText tone={s.tone} icon={s.icon}>
            {s.label}
          </StatusText>
          {r.revisionLabel ? <span>・{r.revisionLabel}</span> : null}
        </span>
      </th>
      <td className="dtable__td dtable__col--stage">
        <StatusText tone={s.tone} icon={s.icon}>
          {s.label}
        </StatusText>
        {r.revisionLabel ? <span className="dtable__sub">{r.revisionLabel}</span> : null}
      </td>
      <td className="dtable__td">
        {next === null ? (
          <span className="muted">—</span>
        ) : (
          <>
            <span className={`dtable__date ${overdue ? "dtable__date--overdue" : ""}`}>
              {formatDeadline(next, now)}
            </span>
            <span className="dtable__sub">
              {kind}・
              <span className={tone === "neutral" ? "" : `meta--${tone}`}>
                {remaining(next, now)}
              </span>
            </span>
          </>
        )}
      </td>
      <td className="dtable__td dtable__num">
        {r.unresolved > 0 ? (
          <span className="dtable__count">{r.unresolved}</span>
        ) : (
          <span className="muted">0</span>
        )}
      </td>
      <td className="dtable__td dtable__num dtable__col--review">
        {r.stage !== "reviewing" ? (
          <span className="muted">—</span>
        ) : r.reviewersTotal === 0 ? (
          <StatusText tone="warning">未割当</StatusText>
        ) : (
          <span>
            {r.reviewersDone} / {r.reviewersTotal}
          </span>
        )}
      </td>
      <td className="dtable__td dtable__col--bureau">
        {r.bureau || <span className="muted">—</span>}
      </td>
    </tr>
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
      <div className="stagebar" role="img" aria-label={`状態の内訳: ${summary}`}>
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
        {workStages.map((s) => (
          <li key={s} className={`legend__item ${stages[s] === 0 ? "legend__item--zero" : ""}`}>
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
    <section className="ov__block" aria-labelledby="ov-bureaus">
      <M3eHeading
        variant="title"
        size="small"
        level={3}
        className="dash__title--side"
        id="ov-bureaus"
      >
        局別
      </M3eHeading>
      <div className="dtable dtable--small">
        <table className="dtable__table" aria-label="局別の制作物">
          <thead>
            <tr>
              <th scope="col" className="dtable__th">
                局
              </th>
              <th scope="col" className="dtable__th dtable__num">
                制作物
              </th>
              <th scope="col" className="dtable__th dtable__num">
                校正中
              </th>
              <th scope="col" className="dtable__th dtable__num">
                未解決
              </th>
              <th scope="col" className="dtable__th dtable__num">
                校了
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((b) => (
              <tr key={b.bureau} className="dtable__row">
                <th scope="row" className="dtable__td">
                  {b.bureau || <span className="muted">未設定</span>}
                </th>
                <td className="dtable__td dtable__num">{b.works}</td>
                <td className="dtable__td dtable__num">{b.reviewing}</td>
                <td className="dtable__td dtable__num">{b.unresolved}</td>
                <td className="dtable__td dtable__num">{b.finalized}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
