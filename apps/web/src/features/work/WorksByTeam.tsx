import type { api } from "@mf100/convex/api";
import { groupWorksByTeam, type Team, type WorkTeamAxis, type WorkTeamGroup } from "@mf100/domain";
import type { FunctionReturnType } from "convex/server";
import { useState } from "react";
import { formatDeadline, formatDeadlineUntil } from "@/lib/format";
import { lifecycleLabel } from "@/lib/labels";
import { M3eActionList, M3eExpandableListItem, M3eIcon, M3eListAction } from "@/ui/m3e";

export type WorkRow = FunctionReturnType<typeof api.works.listMine>[number];

/**
 * 制作物一覧を「局 › 担当」の入れ子で出す（利用者決定 2026-10-15: 担当の構造は管理画面で持つ・主管担当／制作担当を切り替える・
 * PC は表、スマホはリスト）。並べ方（どの担当の下に出すか）は domain の groupWorksByTeam が正本。
 *
 * - 表（medium 以上）: データ表（§31 の data table の仕様）に、局・担当の見出しの行を足した入れ子の表。見出しの行のボタンで開閉する
 *   （M3 にも M3E にも入れ子の表が無いので、data table の行の見た目のまま見出しの行を挟む。担当ごとに tbody を分け、見出しは rowgroup）
 * - リスト（compact）: M3E の展開できるリスト項目（expandable list item）を局 › 担当で入れ子にする
 * - 局の直下の制作物（主管担当が局そのもの）は、その局の担当より先に出す。担当の無い制作物は最後の「担当未設定」
 * - 開閉の状態はこの画面の中だけ（既定はすべて開く）
 */
export function WorksByTeam({
  works,
  teams,
  axis,
  compact,
  onOpen,
}: {
  works: readonly WorkRow[];
  teams: readonly Team[];
  axis: WorkTeamAxis;
  compact: boolean;
  /** tab: "feedback" で制作物の FB（相談）を開く */
  onOpen: (workId: string, tab?: "feedback") => void;
}) {
  const groups = groupWorksByTeam(works, teams, axis);
  return compact ? (
    <TeamList groups={groups} onOpen={onOpen} />
  ) : (
    <TeamTable groups={groups} axis={axis} onOpen={onOpen} />
  );
}

const keyOf = (bureau: Team | null, team?: Team | null) =>
  `${bureau?.id ?? "none"}/${team === undefined ? "*" : (team?.id ?? "direct")}`;
const bureauName = (b: Team | null) => b?.name ?? "担当未設定";

function TitleCell({ w }: { w: WorkRow }) {
  return (
    <>
      {w.title}
      {w.confidentiality === "restricted" ? (
        <M3eIcon
          name="lock"
          className="ml list__lock"
          role="img"
          aria-label="非公開"
          title="非公開"
        />
      ) : null}
    </>
  );
}

const done = (w: WorkRow) => w.lifecycle === "finalized" || w.lifecycle === "cancelled";

const COLUMNS: {
  key: string;
  header: string;
  width?: string;
  cell: (w: WorkRow) => React.ReactNode;
}[] = [
  {
    key: "revision",
    header: "現在の版",
    width: "112px",
    cell: (w) => w.latestRevisionLabel ?? "未提出",
  },
  {
    key: "accepting",
    header: "校正の締切",
    width: "200px",
    cell: (w) =>
      w.acceptingDeadlineAt ? (
        formatDeadlineUntil(w.acceptingDeadlineAt)
      ) : (
        <span className="muted">—</span>
      ),
  },
  {
    key: "deadline",
    header: "納期",
    width: "160px",
    cell: (w) => (w.deadlineAt ? formatDeadline(w.deadlineAt) : <span className="muted">—</span>),
  },
  {
    key: "creators",
    header: "制作者",
    cell: (w) => (w.creators.length ? w.creators.join("、") : <span className="muted">—</span>),
  },
  {
    key: "state",
    header: "状態",
    width: "96px",
    cell: (w) => lifecycleLabel[w.lifecycle] ?? w.lifecycle,
  },
];

function TeamTable({
  groups,
  axis,
  onOpen,
}: {
  groups: WorkTeamGroup<WorkRow>[];
  axis: WorkTeamAxis;
  onOpen: (workId: string, tab?: "feedback") => void;
}) {
  const [closed, setClosed] = useState<ReadonlySet<string>>(new Set());
  const toggle = (k: string) =>
    setClosed((s) => {
      const next = new Set(s);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });
  // 担当がまだ無い（全部が「担当未設定」）ときは見出しの行を出さず、ふつうの表にする
  const flat = groups.length === 1 && groups[0]!.bureau === null;
  const span = COLUMNS.length + 2;
  const label = `制作物一覧（${axis === "owner" ? "主管担当" : "制作担当"}ごと）`;

  const head = (k: string, level: 1 | 2, name: string, count: number) => {
    const open = !closed.has(k);
    return (
      <tr className={`data-table__group data-table__group--${level === 1 ? "bureau" : "team"}`}>
        <th scope="rowgroup" colSpan={span}>
          <button
            type="button"
            className="data-table__group-toggle"
            aria-expanded={open}
            onClick={() => toggle(k)}
          >
            <M3eIcon name={open ? "expand_more" : "chevron_right"} />
            <span>{name}</span>
            <span className="data-table__group-count">{count} 件</span>
          </button>
        </th>
      </tr>
    );
  };
  const rows = (list: WorkRow[], depth: 0 | 1 | 2, groupKey: string) =>
    list.map((w) => (
      <tr
        key={`${groupKey}:${w.id}`}
        className={`data-table__row data-table__row--action ${done(w) ? "data-table__row--done" : ""}`}
        onClick={() => onOpen(w.id)}
      >
        <th
          scope="row"
          className={`data-table__td data-table__rowhead data-table__indent-${depth}`}
        >
          {/* 行全体を押せるが、キーボードと読み上げのために題名をボタンにする */}
          <button
            type="button"
            className="data-table__link"
            onClick={(e) => {
              e.stopPropagation();
              onOpen(w.id);
            }}
          >
            <TitleCell w={w} />
          </button>
        </th>
        {COLUMNS.map((c) => (
          <td key={c.key} className="data-table__td">
            {c.cell(w)}
          </td>
        ))}
        <td className="data-table__td">
          <FbCount w={w} onOpen={onOpen} />
        </td>
      </tr>
    ));

  return (
    <div className="data-table works-team-table" role="region" aria-label={label} tabIndex={0}>
      <table className="data-table__table">
        <thead>
          <tr>
            <th scope="col" className="data-table__th">
              制作物
            </th>
            {COLUMNS.map((c) => (
              <th
                key={c.key}
                scope="col"
                className="data-table__th"
                style={c.width ? { width: c.width } : undefined}
              >
                {c.header}
              </th>
            ))}
            <th scope="col" className="data-table__th" style={{ width: "88px" }}>
              FB
            </th>
          </tr>
        </thead>
        {flat ? (
          <tbody>
            {rows(
              groups[0]!.teams.flatMap((t) => t.works),
              0,
              "flat",
            )}
          </tbody>
        ) : (
          groups.map((g) => {
            const bk = keyOf(g.bureau);
            const bureauOpen = !closed.has(bk);
            return [
              <tbody key={bk}>{head(bk, 1, bureauName(g.bureau), g.count)}</tbody>,
              ...(bureauOpen
                ? g.teams.map((t) => {
                    const tk = keyOf(g.bureau, t.team);
                    // 局の直下（担当を持たない制作物）は局の見出しのすぐ下に、担当の見出しを挟まずに出す
                    if (t.team === null) return <tbody key={tk}>{rows(t.works, 1, tk)}</tbody>;
                    return (
                      <tbody key={tk}>
                        {head(tk, 2, t.team.name, t.works.length)}
                        {closed.has(tk) ? null : rows(t.works, 2, tk)}
                      </tbody>
                    );
                  })
                : []),
            ];
          })
        )}
      </table>
    </div>
  );
}

function TeamList({
  groups,
  onOpen,
}: {
  groups: WorkTeamGroup<WorkRow>[];
  onOpen: (workId: string, tab?: "feedback") => void;
}) {
  const item = (w: WorkRow, k: string) => (
    <M3eListAction
      key={`${k}:${w.id}`}
      className={`list__item ${done(w) ? "list__item--done" : ""}`}
      onClick={() => onOpen(w.id)}
    >
      <span className="list__headline">
        <TitleCell w={w} />
      </span>
      <span slot="supporting-text">
        {w.latestRevisionLabel ?? "未提出"}
        {w.acceptingDeadlineAt ? `・締切 ${formatDeadlineUntil(w.acceptingDeadlineAt)}` : ""}
        {w.fb.threads ? `・FB ${w.fb.threads}${w.fb.unread ? `（未読 ${w.fb.unread}）` : ""}` : ""}
      </span>
      {w.lifecycle !== "active" ? (
        <span slot="trailing" className="meta">
          {lifecycleLabel[w.lifecycle]}
        </span>
      ) : null}
    </M3eListAction>
  );
  if (groups.length === 1 && groups[0]!.bureau === null)
    return (
      <M3eActionList className="list" aria-label="制作物一覧">
        {groups[0]!.teams.flatMap((t) => t.works).map((w) => item(w, "flat"))}
      </M3eActionList>
    );
  return (
    <M3eActionList className="list works-team-list" aria-label="制作物一覧">
      {groups.map((g) => {
        const bk = keyOf(g.bureau);
        return (
          <M3eExpandableListItem key={bk} open className="list__item works-team-list__bureau">
            <M3eIcon slot="leading" name={g.bureau ? "corporate_fare" : "help_outline"} />
            {bureauName(g.bureau)}
            <span slot="supporting-text">{g.count} 件</span>
            <div slot="items">
              {g.teams.map((t) => {
                const tk = keyOf(g.bureau, t.team);
                if (t.team === null) return t.works.map((w) => item(w, tk));
                return (
                  <M3eExpandableListItem key={tk} open className="list__item works-team-list__team">
                    <M3eIcon slot="leading" name="groups" />
                    {t.team.name}
                    <span slot="supporting-text">{t.works.length} 件</span>
                    <div slot="items">{t.works.map((w) => item(w, tk))}</div>
                  </M3eExpandableListItem>
                );
              })}
            </div>
          </M3eExpandableListItem>
        );
      })}
    </M3eActionList>
  );
}

/** FB（相談）の数と未読。押すと制作物の FB を開く（制作物一覧から相談へ直接入る。§43） */
export function FbCount({
  w,
  onOpen,
}: {
  w: WorkRow;
  onOpen: (workId: string, tab?: "feedback") => void;
}) {
  if (w.fb.threads === 0) return <span className="muted">—</span>;
  return (
    <button
      type="button"
      className={`works-fb ${w.fb.unread ? "works-fb--unread" : ""}`}
      aria-label={`FB ${w.fb.threads} 件${w.fb.unread ? `（未読 ${w.fb.unread}）` : ""}を開く`}
      onClick={(e) => {
        e.stopPropagation();
        onOpen(w.id, "feedback");
      }}
    >
      <M3eIcon name="forum" />
      {w.fb.threads}
      {w.fb.unread ? <span className="works-fb__dot" aria-hidden="true" /> : null}
    </button>
  );
}
