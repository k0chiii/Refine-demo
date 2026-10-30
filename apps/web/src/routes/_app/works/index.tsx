import { api } from "@mf100/convex/api";
import {
  sortTeams,
  sortWorks,
  workBelongsToTeam,
  workGenreLabels,
  workGenres,
  workStageOf,
  type Team,
  type WorkGenre,
  type WorkSortDir,
  type WorkSortKey,
} from "@mf100/domain";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery } from "convex/react";
import { useWorkSummaries } from "@/lib/useWorkSummaries";
import type { M3eFilterChipElement } from "@m3e/web/chips";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { DashboardOverview } from "@/features/home/DashboardOverview";
import { NewWorkDialog } from "@/features/work/NewWorkDialog";
import { WorksTable, type WorkRow } from "@/features/work/WorksTable";
import { lifecycleLabel } from "@/lib/labels";
import { useWindowClass } from "@/lib/useMedia";
import { rememberWorkHint } from "@/lib/workHint";
import { AppBarSlot } from "@/ui/AppBarSlot";
import { Loading } from "@/ui/Loading";
import { M3eFilterChip, M3eFilterChipSet } from "@m3e/react/chips";
import { M3eIcon } from "@m3e/react/icon";
import { M3eIconButton } from "@m3e/react/icon-button";
import { M3eMenu, M3eMenuItemGroup, M3eMenuItemRadio, M3eMenuTrigger } from "@m3e/react/menu";

type TeamAxis = "owner" | "production";
const SORT_KEYS = ["accepting", "deadline", "title", "stage", "owner", "production"] as const;
const sortLabel: Record<WorkSortKey, string> = {
  accepting: "校正期日順",
  deadline: "納期順",
  title: "制作物名順",
  stage: "状態順",
  owner: "主管担当順",
  production: "制作担当順",
};
const axisLabel: Record<TeamAxis, string> = { owner: "主管担当", production: "制作担当" };

export const Route = createFileRoute("/_app/works/")({
  validateSearch: (
    s: Record<string, unknown>,
  ): {
    q?: string;
    new?: boolean;
    owner?: string;
    production?: string;
    genre?: WorkGenre;
    pinned?: boolean;
    sort?: WorkSortKey;
    dir?: "desc";
  } => ({
    ...(typeof s.q === "string" && s.q ? { q: s.q } : {}),
    ...(s.new === true || s.new === "true" ? { new: true } : {}),
    ...((workGenres as readonly string[]).includes(s.genre as string)
      ? { genre: s.genre as WorkGenre }
      : {}),
    ...(s.pinned === true || s.pinned === "true" ? { pinned: true } : {}),
    ...(typeof s.owner === "string" && s.owner ? { owner: s.owner } : {}),
    ...(typeof s.production === "string" && s.production ? { production: s.production } : {}),
    ...(SORT_KEYS.includes(s.sort as WorkSortKey) && s.sort !== "accepting"
      ? { sort: s.sort as WorkSortKey }
      : {}),
    ...(s.dir === "desc" ? { dir: "desc" as const } : {}),
  }),
  component: Works,
});

/**
 * U-02 制作物（一覧）。探して開くだけの入口。先頭に制作物の状況（数字・滞っている制作物・内訳。管理する人の全体像。
 * ホームを入口（制作・校正）に分けたとき、ここへ移した。利用者決定 2026-10-19）。ホームにピン留めした制作物は「ピン留め」のチップで絞る。行（題名のリンク）を押すとエディタ（最新版）が開く。
 * 入れ子にせずに 1 つの表で並べ、主管担当・制作担当は絞り込み（`owner`・`production`）と並べ替え（`sort`・`dir`）で使う
 * （利用者決定 2026-10-16。既定は校正の締切が近い順）。絞り込み・並べ替えは M3 のチップ＋メニュー（M3 Chips）と、表の見出し（同じ `sort`）。
 * 表（共通の ui/DataTable。M3 に表の部品が無いので native `<table>`。利用者決定 2026-10-18「制作物一覧も表がいいかも」。§75）。
 * スマホ（compact）も表で、列を 題名 + 校正の締切 に絞る（状態・版・FB は題名の下）。
 * 制作物の登録は管理者が一括で行う（§36。利用者決定 2026-10-15）ので、FAB は「版を提出」に譲り、1 件ずつの登録は
 * 登録の権限（Nogiku の組織権限 works:create と approvers:assign）のある人にだけ、アプリバーの操作として出す（ダイアログは `?new=1`）。
 * 検索語は `q` で渡る（検索バーは一旦外している）。見出し「制作物一覧」は共通アプリバーに差し込む（M3 App bars）。
 */
function Works() {
  const search = Route.useSearch();
  const { q, new: creating } = search;
  const sort = search.sort ?? "accepting";
  const navigate = useNavigate();
  const me = useQuery(api.me.me, {});
  const teams = useQuery(api.teams.list, {});
  const [lifecycle, setLifecycle] = useState<string>("");
  const cls = useWindowClass();
  const compact = cls === "compact";
  const twoColumns = cls === "expanded" || cls === "large";
  // 「制作物を登録」はレールの FAB にある（compact にはレールが無い）
  const canRegister = !compact;
  // 登録は works:create に加えて、校了者を決める権限（approvers:assign）も要る
  const canCreate = me?.canCreateWorks === true && me.canAssignApprovers;
  const dir: WorkSortDir = search.dir ?? "asc";
  const setSearch = (patch: {
    owner?: string;
    production?: string;
    genre?: WorkGenre | undefined;
    pinned?: true | undefined;
    sort?: WorkSortKey;
    dir?: "desc" | undefined;
  }) =>
    void navigate({
      to: "/works",
      search: (s) => {
        const next: Record<string, unknown> = { ...s, ...patch };
        for (const k of Object.keys(patch))
          if (!next[k] || (k === "sort" && next[k] === "accepting")) delete next[k];
        return next as typeof s;
      },
      replace: true,
    });
  // 絞り込み（状態・ジャンル・検索）で引数が変わっても、新しい一覧が届くまで前の一覧を出す（骨組みへ戻さない）
  const works = useWorkSummaries({
    ...(q ? { text: q } : {}),
    ...(lifecycle ? { lifecycle: lifecycle as "active" } : {}),
    ...(search.genre ? { genre: search.genre } : {}),
  });
  // 制作物の状況とピン留め（ダッシュボードの制作物の節）
  const dash = useQuery(api.dashboard.works, {});
  const pinnedIds = useMemo(() => new Set((dash?.pinned ?? []).map((p) => p.workId)), [dash]);
  const hasTeams = teams !== undefined && teams.length > 0;
  const owner = hasTeams ? search.owner : undefined;
  const production = hasTeams ? search.production : undefined;
  const effectiveSort: WorkSortKey =
    !hasTeams && (sort === "owner" || sort === "production") ? "accepting" : sort;
  const shown = useMemo(() => {
    if (!works || !teams) return undefined;
    const picked: WorkRow[] = works
      .filter(
        (w) =>
          (!search.pinned || pinnedIds.has(w.id)) &&
          (!owner || workBelongsToTeam(w, teams, "owner", owner)) &&
          (!production || workBelongsToTeam(w, teams, "production", production)),
      )
      .map((w) => ({
        ...w,
        stage: workStageOf({
          lifecycle: w.lifecycle,
          accepting: w.acceptingRevisionId !== null,
          hasRevision: w.latestRevisionLabel !== null,
        }),
      }));
    return sortWorks(picked, teams, effectiveSort, dir);
  }, [works, teams, owner, production, effectiveSort, dir, search.pinned, pinnedIds]);
  // 表の見出しを押す: 同じ列なら向きを逆に、別の列なら昇順で（URL の sort・dir。並べ替えのチップと同じ値）
  const onSortColumn = (key: WorkSortKey) =>
    setSearch(
      key === effectiveSort
        ? { dir: dir === "asc" ? "desc" : undefined }
        : { sort: key, dir: undefined },
    );
  const filtered = Boolean(lifecycle || owner || production || search.genre || search.pinned);
  const setCreating = (on: boolean) =>
    void navigate({
      to: "/works",
      search: (s) => {
        const { new: _drop, ...rest } = s;
        return on ? { ...rest, new: true } : rest;
      },
      replace: !on,
    });

  return (
    <div className="works">
      <AppBarSlot slot="title">制作物</AppBarSlot>
      {canCreate ? (
        <AppBarSlot slot="actions">
          <M3eIconButton
            aria-label="制作物を登録"
            title="制作物を登録"
            onClick={() => setCreating(true)}
          >
            <M3eIcon name="note_add" />
          </M3eIconButton>
        </AppBarSlot>
      ) : null}
      {dash ? <DashboardOverview data={dash} twoColumns={twoColumns} /> : null}
      <div className="works__controls">
        {pinnedIds.size > 0 || search.pinned ? (
          <M3eFilterChipSet aria-label="ピン留めで絞り込み" className="works__filters">
            <M3eFilterChip
              selected={search.pinned === true}
              onClick={() => setSearch({ pinned: search.pinned ? undefined : true })}
            >
              <M3eIcon slot="icon" name="push_pin" />
              ピン留め
            </M3eFilterChip>
          </M3eFilterChipSet>
        ) : null}
        <M3eFilterChipSet aria-label="状態で絞り込み" className="works__filters">
          {(["active", "on_hold", "finalized"] as const).map((k) => (
            <M3eFilterChip
              key={k}
              selected={lifecycle === k}
              onClick={() => setLifecycle((cur) => (cur === k ? "" : k))}
            >
              {lifecycleLabel[k]}
            </M3eFilterChip>
          ))}
        </M3eFilterChipSet>
        {hasTeams ? (
          // 状態のチップとは別のまとまり。M3E の filter chip set は 1 つしか選べないか（radiogroup）、multi にすると
          // 持てない属性（aria-allowed-attr）が付くので、ただの group にする（チップはメニューを開くボタン）
          <div role="group" aria-label="担当で絞り込み" className="works__filters works__teams">
            {(["owner", "production"] as const).map((axis) => (
              <TeamFilterChip
                key={axis}
                axis={axis}
                teams={teams}
                value={axis === "owner" ? owner : production}
                onChange={(id) => setSearch({ [axis]: id })}
              />
            ))}
          </div>
        ) : null}
        {/* 大ジャンル（Notion の制作物 DB の select）で絞る。利用者決定 2026-10-17 */}
        <MenuChip
          id="works-genre-menu"
          className="works__genre"
          label={search.genre ? workGenreLabels[search.genre] : "大ジャンル"}
          ariaLabel={`大ジャンルで絞り込み: ${search.genre ? workGenreLabels[search.genre] : "指定なし"}（変える）`}
          active={search.genre !== undefined}
        >
          <M3eMenuItemGroup aria-label="大ジャンル">
            <M3eMenuItemRadio
              checked={!search.genre}
              onClick={() => setSearch({ genre: undefined })}
            >
              指定しない
            </M3eMenuItemRadio>
            {workGenres.map((g) => (
              <M3eMenuItemRadio
                key={g}
                checked={search.genre === g}
                onClick={() => setSearch({ genre: g })}
              >
                {workGenreLabels[g]}
              </M3eMenuItemRadio>
            ))}
          </M3eMenuItemGroup>
        </MenuChip>
        <MenuChip
          id="works-sort-menu"
          className="works__sort"
          icon="sort"
          label={sortLabel[effectiveSort]}
          ariaLabel={`並べ替え: ${sortLabel[effectiveSort]}（変える）`}
          active={false}
        >
          <M3eMenuItemGroup aria-label="並べ替え">
            {SORT_KEYS.filter((k) => hasTeams || (k !== "owner" && k !== "production")).map((k) => (
              <M3eMenuItemRadio
                key={k}
                checked={effectiveSort === k}
                onClick={() => setSearch({ sort: k, dir: undefined })}
              >
                {sortLabel[k]}
              </M3eMenuItemRadio>
            ))}
          </M3eMenuItemGroup>
        </MenuChip>
      </div>
      {shown === undefined || teams === undefined ? (
        <Loading label="制作物を読み込んでいます" />
      ) : shown.length === 0 ? (
        <div className="empty">
          {q
            ? `「${q}」に一致する制作物はありません`
            : filtered
              ? "条件に合う制作物はありません"
              : canRegister
                ? "制作物がありません。「制作物を登録」から登録できます。"
                : "制作物がありません"}
        </div>
      ) : (
        <WorksTable
          works={shown}
          teams={teams}
          sort={effectiveSort}
          dir={dir}
          resetKey={[
            q,
            lifecycle,
            search.genre,
            search.pinned,
            owner,
            production,
            effectiveSort,
            dir,
          ].join("|")}
          compact={compact}
          canDuplicate={canCreate === true}
          onSort={onSortColumn}
          onOpen={(workId) => {
            // 開く画面が works.get を待つあいだも題名を出せるように、行の値を渡しておく（§65）
            const w = shown.find((x) => x.id === workId);
            if (w) rememberWorkHint(workId, { title: w.title, mediaType: w.mediaType });
            void navigate({ to: "/works/$workId", params: { workId } });
          }}
        />
      )}
      <NewWorkDialog open={creating === true && canCreate} onClose={() => setCreating(false)} />
    </div>
  );
}

/**
 * 主管担当・制作担当での絞り込み: チップを押すとメニューで局・担当を選ぶ（M3 Chips: 絞り込みのチップからメニューを開ける）。
 * 選んでいる間はチップを選択中にし、名前をチップに出す。局を選ぶと、その局の担当の制作物も出る（domain の workBelongsToTeam）
 */
function TeamFilterChip({
  axis,
  teams,
  value,
  onChange,
}: {
  axis: TeamAxis;
  teams: readonly Team[];
  value: string | undefined;
  onChange: (teamId: string | undefined) => void;
}) {
  const picked = value ? teams.find((t) => t.id === value) : undefined;
  const short = axis === "owner" ? "主管" : "制作";
  return (
    <MenuChip
      id={`works-${axis}-menu`}
      className={`works__team works__team--${axis}`}
      label={picked ? `${short}: ${picked.name}` : axisLabel[axis]}
      ariaLabel={`${axisLabel[axis]}で絞り込み: ${picked ? picked.name : "指定なし"}（変える）`}
      active={picked !== undefined}
    >
      <M3eMenuItemGroup aria-label={axisLabel[axis]}>
        <M3eMenuItemRadio checked={!picked} onClick={() => onChange(undefined)}>
          指定しない
        </M3eMenuItemRadio>
        {sortTeams(teams).map((t) => (
          <M3eMenuItemRadio key={t.id} checked={picked?.id === t.id} onClick={() => onChange(t.id)}>
            {t.kind === "bureau"
              ? `${t.name}（局全体）`
              : `${teams.find((b) => b.id === t.parentId)?.name ?? ""} › ${t.name}`}
          </M3eMenuItemRadio>
        ))}
      </M3eMenuItemGroup>
    </MenuChip>
  );
}

/**
 * メニューを開くチップ（並べ替え・担当での絞り込み）。末尾に ▾ を付け、チップ全体でメニューを開く（M3 Chips）。
 * M3E の filter chip は押すと選択が反転するので、押した後に `active`（絞り込み中か）へ戻す。
 * 読み上げでは「メニューを開くボタン」にする（M3E は radio にするが、radio には aria-expanded を付けられない）
 */
function MenuChip({
  id,
  className,
  icon,
  label,
  ariaLabel,
  active,
  children,
}: {
  id: string;
  className: string;
  icon?: string;
  label: string;
  ariaLabel: string;
  active: boolean;
  children: ReactNode;
}) {
  const ref = useRef<M3eFilterChipElement>(null);
  useEffect(() => {
    const chip = ref.current;
    if (!chip) return;
    const fix = () => {
      if (chip.getAttribute("role") !== "button") chip.setAttribute("role", "button");
      if (chip.hasAttribute("aria-checked")) chip.removeAttribute("aria-checked");
    };
    fix();
    const mo = new MutationObserver(fix);
    mo.observe(chip, { attributes: true, attributeFilter: ["role", "aria-checked"] });
    return () => mo.disconnect();
  }, []);
  useEffect(() => {
    if (ref.current) ref.current.selected = active;
  }, [active]);
  return (
    <>
      <M3eFilterChip
        ref={ref}
        className={className}
        selected={active}
        aria-label={ariaLabel}
        onClick={() =>
          requestAnimationFrame(() => {
            if (ref.current) ref.current.selected = active;
          })
        }
      >
        {icon ? <M3eIcon slot="icon" name={icon} /> : null}
        {label}
        <M3eIcon slot="trailing-icon" name="arrow_drop_down" />
        <M3eMenuTrigger htmlFor={id} />
      </M3eFilterChip>
      <M3eMenu id={id}>{children}</M3eMenu>
    </>
  );
}
