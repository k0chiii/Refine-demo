import { api } from "@mf100/convex/api";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { formatJstDate, remaining } from "@/lib/format";
import { AppBarSlot } from "@/ui/AppBarSlot";
import { M3eActionList, M3eHeading, M3eListAction } from "@/ui/m3e";

export const Route = createFileRoute("/_app/")({ component: Dashboard });

type Dashboard = FunctionReturnType<typeof api.dashboard.get>;
type Item = Dashboard["mine"]["review"][number];

const mineGroups: Array<[keyof Dashboard["mine"], string, (i: Item) => string]> = [
  [
    "review",
    "校正する",
    (i) => `締切 ${formatJstDate(i.deadlineAt ?? 0)}（${remaining(i.deadlineAt ?? 0)}）`,
  ],
  ["respond", "返事をする", (i) => `未対応 ${i.count}`],
  ["finalize", "校了する", () => "未対応なし・専門確認済み"],
  ["assign", "割り当てる", () => "校正者がいません"],
];
const backlogGroups: Array<[keyof Dashboard["backlog"], string, (i: Item) => string]> = [
  [
    "overdue",
    "期限超過",
    (i) => `締切 ${formatJstDate(i.deadlineAt ?? 0)}${i.count ? `・未対応 ${i.count}` : ""}`,
  ],
  ["unassigned", "校正者が未割当", (i) => `締切 ${formatJstDate(i.deadlineAt ?? 0)}`],
  ["stale", "動きがない", (i) => `最後の動き ${formatJstDate(i.deadlineAt ?? 0)}`],
  [
    "dueSoon",
    "納期が近い",
    (i) => `納期 ${formatJstDate(i.deadlineAt ?? 0)}（${remaining(i.deadlineAt ?? 0)}）`,
  ],
];

/**
 * U-00 ダッシュボード。開いた瞬間に「次に何をするか」が分かる画面。
 * 上: あなたの担当（役割ごとに自動で出る）。下: 自分が関わる制作物で溜まっているもの。行を押すとエディタへ直行。
 * 画面の見出し「あなたの担当」は共通アプリバーに差し込む（M3 App bars: 見出しはアプリバーに置く）。
 */
function Dashboard() {
  const data = useQuery(api.dashboard.get, {});
  const navigate = useNavigate();
  if (data === undefined) return <p className="muted">読み込み中…</p>;
  const mine = mineGroups.filter(([k]) => data.mine[k].length > 0);
  const backlog = backlogGroups.filter(([k]) => data.backlog[k].length > 0);
  const open = (i: Item) => void navigate({ to: "/works/$workId", params: { workId: i.workId } });
  const list = (items: Item[], sub: (i: Item) => string, label: string) => (
    <M3eActionList className="list" aria-label={label}>
      {items.map((i) => (
        <M3eListAction
          key={`${i.workId}-${i.revisionId}`}
          className="list__item"
          onClick={() => open(i)}
        >
          <span className="list__headline">
            {i.workTitle}
            {i.revisionLabel ? <span className="muted">　{i.revisionLabel}</span> : null}
          </span>
          <span slot="supporting-text">{sub(i)}</span>
        </M3eListAction>
      ))}
    </M3eActionList>
  );

  return (
    <div>
      <AppBarSlot slot="title">あなたの担当</AppBarSlot>
      <div className="dash">
        <section className="dash__section">
          {mine.length === 0 ? (
            <p className="muted dash__empty">いま やることはありません。</p>
          ) : (
            mine.map(([k, title, sub]) => (
              <div key={k} className="dash__group">
                <h2 className="dash__title">
                  {title}
                  <span className="dash__count">{data.mine[k].length}</span>
                </h2>
                {list(data.mine[k], sub, title)}
              </div>
            ))
          )}
        </section>
        {backlog.length > 0 ? (
          <section className="dash__section">
            <M3eHeading variant="headline" size="small" level={2} emphasized>
              溜まっているもの
            </M3eHeading>
            {backlog.map(([k, title, sub]) => (
              <div key={k} className="dash__group">
                <h2 className="dash__title">
                  {title}
                  <span className="dash__count">{data.backlog[k].length}</span>
                </h2>
                {list(data.backlog[k], sub, title)}
              </div>
            ))}
          </section>
        ) : null}
      </div>
    </div>
  );
}
