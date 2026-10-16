import type { api } from "@mf100/convex/api";
import { groupWorksByTeam, type Team, type WorkTeamAxis, type WorkTeamGroup } from "@mf100/domain";
import type { FunctionReturnType } from "convex/server";
import { formatDeadline, formatDeadlineUntil } from "@/lib/format";
import { lifecycleLabel } from "@/lib/labels";
import { M3eActionList, M3eExpandableListItem, M3eIcon, M3eListAction } from "@/ui/m3e";

export type WorkRow = FunctionReturnType<typeof api.works.listMine>[number];

/**
 * 制作物一覧を「局 › 担当」の入れ子で出す（利用者決定 2026-10-15: 担当の構造は管理画面で持つ・主管担当／制作担当を切り替える）。
 * 並べ方（どの担当の下に出すか）は domain の groupWorksByTeam が正本。
 *
 * - PC もスマホも M3E のリスト（利用者決定 2026-10-16。M3 にも M3E にも表の部品が無いので、表をやめて M3E に揃えた。§48）。
 *   局 › 担当は M3E の展開できるリスト項目（expandable list item）の入れ子（既定はすべて開く）
 * - 行は 1 件 2 行: 題名と、版・校正の締切（PC は納期・制作者も）。状態（進行中以外）と FB の数は行の末尾
 * - 局の直下の制作物（主管担当が局そのもの）は、その局の担当より先に出す。担当の無い制作物は最後の「担当未設定」
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
  onOpen: (workId: string) => void;
}) {
  const groups = groupWorksByTeam(works, teams, axis);
  return <TeamList groups={groups} compact={compact} onOpen={onOpen} />;
}

const keyOf = (bureau: Team | null, team?: Team | null) =>
  `${bureau?.id ?? "none"}/${team === undefined ? "*" : (team?.id ?? "direct")}`;
const bureauName = (b: Team | null) => b?.name ?? "担当未設定";

const done = (w: WorkRow) => w.lifecycle === "finalized" || w.lifecycle === "cancelled";

/** 行の 2 行目。スマホは版と締切まで（2 行に収める）、PC は納期と制作者も */
function supporting(w: WorkRow, compact: boolean): string {
  const parts = [
    w.latestRevisionLabel ?? "未提出",
    w.acceptingDeadlineAt ? `校正の締切 ${formatDeadlineUntil(w.acceptingDeadlineAt)}` : null,
  ];
  if (!compact)
    parts.push(
      w.deadlineAt ? `納期 ${formatDeadline(w.deadlineAt)}` : null,
      w.creators.length ? `制作者 ${w.creators.join("、")}` : null,
    );
  return parts.filter(Boolean).join("・");
}

function TeamList({
  groups,
  compact,
  onOpen,
}: {
  groups: WorkTeamGroup<WorkRow>[];
  compact: boolean;
  onOpen: (workId: string) => void;
}) {
  const item = (w: WorkRow, k: string) => (
    <M3eListAction
      key={`${k}:${w.id}`}
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
      <span slot="supporting-text">{supporting(w, compact)}</span>
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
