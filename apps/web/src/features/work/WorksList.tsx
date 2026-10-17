import type { api } from "@mf100/convex/api";
import { teamPath, type Team, type WorkSortKey } from "@mf100/domain";
import type { FunctionReturnType } from "convex/server";
import { formatDeadline, formatDeadlineUntil } from "@/lib/format";
import { lifecycleLabel } from "@/lib/labels";
import { M3eIcon } from "@m3e/react/icon";
import { M3eActionList, M3eListAction } from "@m3e/react/list";

export type WorkRow = FunctionReturnType<typeof api.works.listMine>[number];

/**
 * 制作物一覧（入れ子にせずに 1 本のリストで並べる。利用者決定 2026-10-16:
 * 主管担当・制作担当は絞り込み・並べ替えのときに使う）。並べる順と絞り込みは呼び出し側（domain の sortWorks・workBelongsToTeam）。
 *
 * - 行は 1 件 2 行: 題名と、版・校正の締切（PC は納期・担当・制作者も）。状態（進行中以外）と FB の数は行の末尾
 * - 担当で並べている・絞っているときは、その担当を 2 行目の先頭に出す（スマホでも。並びの理由が分かるように）
 */
export function WorksList({
  works,
  teams,
  sort,
  teamAxis,
  compact,
  onOpen,
}: {
  works: readonly WorkRow[];
  teams: readonly Team[];
  sort: WorkSortKey;
  /** 担当で絞っている軸（無ければ null） */
  teamAxis: "owner" | "production" | null;
  compact: boolean;
  onOpen: (workId: string) => void;
}) {
  const axis = sort === "owner" || sort === "production" ? sort : teamAxis;
  return (
    <M3eActionList className="list" aria-label="制作物一覧">
      {works.map((w) => (
        <M3eListAction
          key={w.id}
          className={`list__item ${done(w) ? "list__item--done" : ""} ${w.fb.unread ? "list__item--unread" : ""}`}
          onClick={() => onOpen(w.id)}
        >
          <span className="list__headline">
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
          </span>
          <span slot="supporting-text">{supporting(w, teams, axis, compact)}</span>
          {w.lifecycle !== "active" || w.fb.threads ? (
            <span slot="trailing" className="meta works-list__trailing">
              {w.lifecycle !== "active" ? (
                <span>{lifecycleLabel[w.lifecycle] ?? w.lifecycle}</span>
              ) : null}
              {w.fb.threads ? (
                <span
                  className="works-list__fb"
                  role="img"
                  aria-label={`FB ${w.fb.threads} 件${w.fb.unread ? `（未読 ${w.fb.unread}）` : ""}`}
                >
                  <M3eIcon name="forum" />
                  {w.fb.threads}
                  {w.fb.unread ? <span className="dash__unread" /> : null}
                </span>
              ) : null}
            </span>
          ) : null}
        </M3eListAction>
      ))}
    </M3eActionList>
  );
}

const done = (w: WorkRow) => w.lifecycle === "finalized" || w.lifecycle === "cancelled";

/** 主管担当（1 つ）・制作担当（複数は「、」で）の名前。無ければ「担当未設定」 */
function teamText(w: WorkRow, teams: readonly Team[], axis: "owner" | "production"): string {
  const ids = axis === "owner" ? (w.ownerTeamId ? [w.ownerTeamId] : []) : w.productionTeamIds;
  const names = ids.map((id) => teamPath(id, teams)).filter((n): n is string => n !== null);
  const label = axis === "owner" ? "主管" : "制作";
  return names.length ? `${label} ${names.join("、")}` : `${label}担当未設定`;
}

/** 行の 2 行目。スマホは版と締切まで（2 行に収める）、PC は納期・主管担当・制作者も */
function supporting(
  w: WorkRow,
  teams: readonly Team[],
  axis: "owner" | "production" | null,
  compact: boolean,
): string {
  const parts = [
    axis ? teamText(w, teams, axis) : null,
    w.latestRevisionLabel ?? "未提出",
    w.acceptingDeadlineAt ? `校正の締切 ${formatDeadlineUntil(w.acceptingDeadlineAt)}` : null,
  ];
  if (!compact)
    parts.push(
      w.deadlineAt ? `納期 ${formatDeadline(w.deadlineAt)}` : null,
      axis === null && teams.length ? teamText(w, teams, "owner") : null,
      w.creators.length ? `制作者 ${w.creators.join("、")}` : null,
    );
  return parts.filter(Boolean).join("・");
}
