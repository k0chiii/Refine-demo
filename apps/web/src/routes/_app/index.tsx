import { api } from "@mf100/convex/api";
import type { Id } from "@mf100/convex/dataModel";
import {
  dashboardWidgetColumn,
  limitDashboardItems,
  moveDashboardWidgetAmong,
  updateDashboardWidget,
  type DashboardLimit,
  type DashboardWidgetId,
  type DashboardWidgetPref,
} from "@mf100/domain";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { Fragment, useState, type ReactNode } from "react";
import { HomeEditDialog } from "@/features/home/HomeEditDialog";
import { submitRouteIcon, useSubmitLauncher } from "@/features/home/SubmitPicker";
import { widgetInfo } from "@/features/home/widgets";
import {
  formatDeadline,
  formatDeadlineUntil,
  formatJstDate,
  formatJstShort,
  remaining,
} from "@/lib/format";
import { useAction } from "@/lib/useAction";
import { useWindowClass } from "@/lib/useMedia";
import { ActionSheet, type ActionSheetItem } from "@/ui/ActionSheet";
import { AppBarSlot } from "@/ui/AppBarSlot";
import { Loading } from "@/ui/Loading";
import { M3eButton } from "@m3e/react/button";
import { M3eDivider } from "@m3e/react/divider";
import { M3eHeading } from "@m3e/react/heading";
import { M3eIcon } from "@m3e/react/icon";
import { M3eIconButton } from "@m3e/react/icon-button";
import { M3eActionList, M3eList, M3eListAction, M3eListItem } from "@m3e/react/list";
import {
  M3eMenu,
  M3eMenuItem,
  M3eMenuItemGroup,
  M3eMenuItemRadio,
  M3eMenuTrigger,
} from "@m3e/react/menu";

export const Route = createFileRoute("/_app/")({ component: Dashboard });

type Data = FunctionReturnType<typeof api.dashboard.get>;
type Item = Data["upcoming"][number];

const deadlineLine = (i: Item) =>
  i.deadlineAt ? `締切 ${formatDeadlineUntil(i.deadlineAt)}（${remaining(i.deadlineAt)}）` : "";

/** 節ごとの行（並び替えは application。ここは表示だけ） */
const itemsOf = (d: Data, id: DashboardWidgetId): Item[] => {
  switch (id) {
    case "submit":
    case "review":
    case "respond":
    case "checks":
    case "finalize":
    case "assign":
      return d.mine[id];
    case "deadlines":
      return d.upcoming;
    case "mentions":
      return d.mentions;
    case "pinned":
      return d.pinned;
    case "recent":
      return d.recent;
    case "backlog":
      return [
        ...d.backlog.overdue,
        ...d.backlog.unassigned,
        ...d.backlog.stale,
        ...d.backlog.dueSoon,
      ];
  }
};

/** 行の 2 行目 */
const supporting: Record<Exclude<DashboardWidgetId, "backlog">, (i: Item) => string> = {
  submit: (i) =>
    [
      i.note ?? (i.revisionLabel ? `最新 ${i.revisionLabel}` : "まだ版がありません"),
      i.deadlineAt ? `納期 ${formatDeadlineUntil(i.deadlineAt)}` : null,
    ]
      .filter(Boolean)
      .join("・"),
  review: deadlineLine,
  respond: (i) => `未対応 ${i.count}・${deadlineLine(i)}`,
  checks: (i) => `${i.note ?? ""}・${deadlineLine(i)}`,
  finalize: () => "未対応なし・専門確認済み",
  assign: () => "校正者がいません",
  deadlines: (i) =>
    `${i.deadlineKind === "delivery" ? "納期" : "校正の締切"} ${formatDeadlineUntil(i.deadlineAt ?? 0)}（${remaining(i.deadlineAt ?? 0)}）`,
  mentions: (i) => `${i.note ?? ""}・${i.at ? formatJstShort(i.at) : ""}`,
  pinned: (i) =>
    [
      i.revisionLabel ?? "まだ版がありません",
      i.deadlineAt
        ? `${i.deadlineKind === "delivery" ? "納期" : "締切"} ${formatDeadlineUntil(i.deadlineAt)}`
        : null,
    ]
      .filter(Boolean)
      .join("・"),
  recent: (i) =>
    `${i.revisionLabel ?? "まだ版がありません"}・${i.at ? formatJstShort(i.at) : ""} に開いた`,
};

const backlogGroups: Array<[keyof Data["backlog"], string, (i: Item) => string]> = [
  [
    "overdue",
    "期限超過",
    (i) => `締切 ${formatDeadline(i.deadlineAt ?? 0)}${i.count ? `・未対応 ${i.count}` : ""}`,
  ],
  ["unassigned", "校正者が未割り当て", (i) => `締切 ${formatDeadlineUntil(i.deadlineAt ?? 0)}`],
  ["stale", "14 日間更新なし", (i) => `最終更新 ${formatJstDate(i.deadlineAt ?? 0)}`],
  [
    "dueSoon",
    "納期が近い",
    (i) => `納期 ${formatDeadline(i.deadlineAt ?? 0)}（${remaining(i.deadlineAt ?? 0)}）`,
  ],
];

const roleLabels: Record<keyof Data["roles"], string> = {
  creator: "制作者",
  reviewer: "校正者",
  checker: "専門確認",
  approver: "校了権限者",
  manager: "主管",
};

const limitLabel = (l: DashboardLimit) => (l === null ? "すべて" : `${l} 件`);

/**
 * U-00 ダッシュボード（自分だけのダッシュボード。§36 W-26。利用者決定 2026-10-15）。
 * - 持っている役割から節を自動で組み（application の dashboardLayoutPolicy）、空の節は出さない。全部が空なら理由を出す（要件 U-01）
 * - 節の見出しの ⋮（compact はボトムシート）で上へ・下へ・隠す・表示件数。アプリバーの「ホームを編集」で全部の節をまとめて直す。
 *   並べ替えはドラッグを使わず上下の操作（WCAG 2.5.7）。設定はアカウントに保存（PC とスマホで共通）
 * - compact は 1 列のリスト（M3 Cards: compact ではリスト）。expanded 以上は M3 Canonical layouts › Supporting pane:
 *   左が「やること」（残り全部）、右が補助の固定幅のペイン（360、1200 以上は 412）
 * - 主目的（やること）の見出しを最も強く、補助の見出しは控えめに（M3 Usability。§35 A-16）
 */
function Dashboard() {
  const data = useQuery(api.dashboard.get, {});
  const navigate = useNavigate();
  const cls = useWindowClass();
  const twoColumns = cls === "expanded" || cls === "large";
  const save = useMutation(api.home.saveLayout);
  const markRead = useMutation(api.notifications.markRead);
  const launcher = useSubmitLauncher();
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [menuFor, setMenuFor] = useState<DashboardWidgetId | null>(null);
  const [editing, setEditing] = useState(false);
  const saveLayout = useAction(async (widgets: DashboardWidgetPref[]) => {
    await save({ widgets: widgets.map(({ id, visible, limit }) => ({ id, visible, limit })) });
  });
  const openMention = useAction(async (i: Item) => {
    if (i.unread && i.notificationId)
      await markRead({ notificationId: i.notificationId as Id<"notifications"> });
    if (i.revisionId)
      void navigate({
        to: "/revisions/$revisionId",
        params: { revisionId: i.revisionId },
        search: i.threadId ? { thread: i.threadId } : {},
      });
    else void navigate({ to: "/works/$workId", params: { workId: i.workId } });
  });

  const editButton = (
    <AppBarSlot slot="actions">
      <M3eIconButton
        aria-label="ホームを編集"
        title="ホームを編集"
        disabled={data === undefined}
        onClick={() => setEditing(true)}
      >
        <M3eIcon name="dashboard_customize" />
      </M3eIconButton>
    </AppBarSlot>
  );
  if (data === undefined)
    return (
      <>
        <AppBarSlot slot="title">ホーム</AppBarSlot>
        {editButton}
        <Loading label="ホームを読み込んでいます" />
      </>
    );

  const layout = data.layout;
  const shown = layout.filter((w) => w.visible && itemsOf(data, w.id).length > 0);
  const shownIds = new Set(shown.map((w) => w.id));
  const peerOf = (id: DashboardWidgetId) => (w: DashboardWidgetPref) =>
    shownIds.has(w.id) &&
    (!twoColumns || dashboardWidgetColumn[w.id] === dashboardWidgetColumn[id]);
  const neighbors = (id: DashboardWidgetId) => {
    const peers = shown.filter(peerOf(id));
    const i = peers.findIndex((w) => w.id === id);
    return { first: i <= 0, last: i === peers.length - 1 };
  };
  const move = (id: DashboardWidgetId, dir: -1 | 1) =>
    void saveLayout.run(moveDashboardWidgetAmong(layout, id, dir, peerOf(id)));
  const patch = (
    id: DashboardWidgetId,
    p: Partial<Pick<DashboardWidgetPref, "visible" | "limit">>,
  ) => void saveLayout.run(updateDashboardWidget(layout, id, p));
  const open = (i: Item) => void navigate({ to: "/works/$workId", params: { workId: i.workId } });

  const rows = (id: DashboardWidgetId, items: Item[], sub: (i: Item) => string, label: string) => {
    if (id === "submit")
      // 行の中に操作のボタンを入れるので、行そのものは押せないリストにする（入れ子の操作を作らない）
      return (
        <M3eList className="list" aria-label={label}>
          {items.map((i) => (
            <M3eListItem key={i.workId} className="list__item">
              <M3eIcon slot="leading" name={submitRouteIcon[i.route ?? "upload"]} />
              <span className="list__headline">{i.workTitle}</span>
              <span slot="supporting-text">{sub(i)}</span>
              <M3eButton
                slot="trailing"
                variant="filled"
                aria-label={`${i.workTitle} の版を提出`}
                onClick={() => launcher.start({ workId: i.workId, route: i.route ?? "upload" })}
              >
                版を提出
              </M3eButton>
            </M3eListItem>
          ))}
        </M3eList>
      );
    return (
      <M3eActionList className="list" aria-label={label}>
        {items.map((i) => (
          <M3eListAction
            key={`${i.workId}-${i.revisionId}-${i.notificationId ?? ""}-${i.note ?? ""}-${i.deadlineKind ?? ""}`}
            className={`list__item ${i.unread ? "list__item--unread" : ""}`}
            onClick={() => (id === "mentions" ? void openMention.run(i) : open(i))}
          >
            {id === "mentions" && i.unread ? (
              <span slot="leading" className="dash__unread" aria-label="未読" role="img" />
            ) : null}
            <span className="list__headline">
              {i.workTitle}
              {i.revisionLabel && id !== "pinned" && id !== "recent" ? (
                <span className="muted">　{i.revisionLabel}</span>
              ) : null}
            </span>
            <span slot="supporting-text">{sub(i)}</span>
          </M3eListAction>
        ))}
      </M3eActionList>
    );
  };

  // 「すべて表示」はその場だけ広げる（保存はしない）。キーは節（滞っている制作物は内訳ごと）
  const more = (id: string, total: number, limit: DashboardLimit) =>
    limit !== null && total > limit ? (
      <M3eButton
        variant="text"
        className="dash__more"
        onClick={() =>
          setExpanded((s) => {
            const n = new Set(s);
            if (n.has(id)) n.delete(id);
            else n.add(id);
            return n;
          })
        }
      >
        {expanded.has(id) ? "閉じる" : `すべて表示（${total} 件）`}
      </M3eButton>
    ) : null;
  const cut = <T,>(id: string, items: T[], limit: DashboardLimit) =>
    expanded.has(id) ? items : limitDashboardItems(items, limit);

  const section = (w: DashboardWidgetPref): ReactNode => {
    const info = widgetInfo[w.id];
    const all = itemsOf(data, w.id);
    const todo = dashboardWidgetColumn[w.id] === "todo";
    const { first, last } = neighbors(w.id);
    const menuId = `dash-menu-${w.id}`;
    const body =
      w.id === "backlog" ? (
        backlogGroups
          .filter(([k]) => data.backlog[k].length > 0)
          .map(([k, title, sub]) => (
            <div key={k} className="dash__group">
              <h3 className="dash__subtitle">
                {title}
                <span className="dash__count">{data.backlog[k].length}</span>
              </h3>
              {rows(w.id, cut(`backlog-${k}`, data.backlog[k], w.limit), sub, title)}
              {more(`backlog-${k}`, data.backlog[k].length, w.limit)}
            </div>
          ))
      ) : (
        <>
          {rows(w.id, cut(w.id, all, w.limit), supporting[w.id], info.title)}
          {more(w.id, all.length, w.limit)}
        </>
      );
    return (
      <section
        key={w.id}
        className={`dash__section ${todo ? "dash__section--todo" : "dash__section--side"}`}
      >
        <div className="dash__head">
          {todo ? (
            <M3eHeading variant="title" size="large" level={2} emphasized className="dash__title">
              {info.title}
            </M3eHeading>
          ) : (
            <M3eHeading
              variant="title"
              size="small"
              level={2}
              className="dash__title dash__title--side"
            >
              {info.title}
            </M3eHeading>
          )}
          <span className="dash__count" aria-label={`${all.length} 件`}>
            {all.length}
          </span>
          <span className="spacer" />
          <M3eIconButton
            aria-label={`「${info.title}」の表示を変える`}
            {...(cls === "compact" ? { onClick: () => setMenuFor(w.id) } : {})}
          >
            <M3eIcon name="more_vert" />
            {cls === "compact" ? null : <M3eMenuTrigger htmlFor={menuId} />}
          </M3eIconButton>
        </div>
        {cls === "compact" ? null : (
          <M3eMenu id={menuId} positionX="before">
            <M3eMenuItem disabled={first} onClick={() => move(w.id, -1)}>
              <M3eIcon slot="icon" name="arrow_upward" />
              上へ
            </M3eMenuItem>
            <M3eMenuItem disabled={last} onClick={() => move(w.id, 1)}>
              <M3eIcon slot="icon" name="arrow_downward" />
              下へ
            </M3eMenuItem>
            <M3eMenuItem onClick={() => patch(w.id, { visible: false })}>
              <M3eIcon slot="icon" name="visibility_off" />
              隠す
            </M3eMenuItem>
            <M3eDivider />
            <M3eMenuItemGroup aria-label="表示件数">
              {([3, 5, null] as const).map((l) => (
                <M3eMenuItemRadio
                  key={String(l)}
                  checked={w.limit === l}
                  onClick={() => patch(w.id, { limit: l })}
                >
                  {limitLabel(l)}表示
                </M3eMenuItemRadio>
              ))}
            </M3eMenuItemGroup>
          </M3eMenu>
        )}
        {body}
      </section>
    );
  };

  const sheetItems = (id: DashboardWidgetId): ActionSheetItem[] => {
    const w = layout.find((x) => x.id === id);
    if (!w) return [];
    const { first, last } = neighbors(id);
    return [
      { icon: "arrow_upward", label: "上へ", disabled: first, onSelect: () => move(id, -1) },
      { icon: "arrow_downward", label: "下へ", disabled: last, onSelect: () => move(id, 1) },
      { icon: "visibility_off", label: "隠す", onSelect: () => patch(id, { visible: false }) },
      ...([3, 5, null] as const).map((l) => ({
        icon: "format_list_numbered",
        label: `${limitLabel(l)}表示`,
        selected: w.limit === l,
        onSelect: () => patch(id, { limit: l }),
      })),
    ];
  };

  const hiddenWithItems = layout.filter((w) => !w.visible && itemsOf(data, w.id).length > 0);
  const roles = (Object.keys(roleLabels) as Array<keyof Data["roles"]>).filter(
    (r) => data.roles[r] > 0,
  );
  const empty = (
    <div className="empty dash__empty">
      <M3eIcon name="task_alt" />
      <span className="title-medium">いまやることはありません</span>
      <span>
        {roles.length > 0
          ? `あなたの役割: ${roles.map((r) => `${roleLabels[r]} ${data.roles[r]} 件`).join("・")}。どれも、いま手を付けるものはありません。`
          : "あなたが担当している進行中の制作物はありません。制作物の担当になると、ここにやることが出ます。"}
      </span>
      <span>
        {data.nextDeadline
          ? `次の締切: ${data.nextDeadline.workTitle} の${data.nextDeadline.deadlineKind === "delivery" ? "納期" : "校正の締切"} ${formatDeadlineUntil(data.nextDeadline.deadlineAt ?? 0)}`
          : "近い締切はありません"}
      </span>
      {hiddenWithItems.length > 0 ? (
        <M3eButton variant="text" onClick={() => setEditing(true)}>
          隠した節を表示する（{hiddenWithItems.map((w) => widgetInfo[w.id].title).join("・")}）
        </M3eButton>
      ) : null}
    </div>
  );

  const todo = shown.filter((w) => dashboardWidgetColumn[w.id] === "todo");
  const hiddenTodo = hiddenWithItems.filter((w) => dashboardWidgetColumn[w.id] === "todo");
  const side = shown.filter((w) => dashboardWidgetColumn[w.id] === "side");
  return (
    <div>
      <AppBarSlot slot="title">ホーム</AppBarSlot>
      {editButton}
      {shown.length === 0 ? (
        empty
      ) : twoColumns ? (
        <div className="dash dash--columns">
          <div className="dash__column" role="region" aria-label="やること">
            {todo.length ? (
              todo.map(section)
            ) : (
              <div className="dash__none">
                {hiddenTodo.length ? (
                  <>
                    <p className="muted">
                      表示している「やること」の節に、いま手を付けるものはありません。
                    </p>
                    <M3eButton variant="text" onClick={() => setEditing(true)}>
                      隠した節を表示する（{hiddenTodo.map((w) => widgetInfo[w.id].title).join("・")}
                      ）
                    </M3eButton>
                  </>
                ) : (
                  <p className="muted">いまやることはありません</p>
                )}
              </div>
            )}
          </div>
          {/* 補助のペイン（M3 Supporting pane。読み上げでは complementary） */}
          <aside className="dash__column dash__column--side" aria-label="予定と記録">
            {side.map(section)}
          </aside>
        </div>
      ) : (
        <div className="dash">
          {shown.map((w, i) => (
            <Fragment key={w.id}>
              {i > 0 ? <M3eDivider className="dash__divider" /> : null}
              {section(w)}
            </Fragment>
          ))}
        </div>
      )}
      {cls === "compact" ? (
        <ActionSheet
          open={menuFor !== null}
          onClose={() => setMenuFor(null)}
          title={menuFor ? `「${widgetInfo[menuFor].title}」の表示` : ""}
          items={menuFor ? sheetItems(menuFor) : []}
        />
      ) : null}
      <HomeEditDialog
        open={editing}
        onClose={() => setEditing(false)}
        layout={layout}
        customized={data.customized}
        counts={Object.fromEntries(layout.map((w) => [w.id, itemsOf(data, w.id).length]))}
      />
      {launcher.element}
    </div>
  );
}
