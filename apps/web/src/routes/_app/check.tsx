import { api } from "@mf100/convex/api";
import {
  groupCheckEntries,
  isCheckTab,
  type CheckKind,
  type CheckProgress,
  type CheckTab,
} from "@mf100/domain";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { useEffect, useMemo } from "react";
import { Empty, Group, WorkspaceRow, deadlineText } from "@/features/workspace/parts";
import { rememberWorkspace } from "@/lib/workspace";
import { rememberWorkHint } from "@/lib/workHint";
import { AppBarSlot } from "@/ui/AppBarSlot";
import { ChoiceGroup } from "@/ui/ChoiceGroup";
import { Loading } from "@/ui/Loading";

export const Route = createFileRoute("/_app/check")({
  validateSearch: (s: Record<string, unknown>): { show?: Exclude<CheckTab, "todo"> } =>
    isCheckTab(s.show) && s.show !== "todo" ? { show: s.show } : {},
  component: Check,
});

type Data = FunctionReturnType<typeof api.dashboard.get>;
type Item = Data["done"][number];

interface Entry {
  key: string;
  kind: CheckKind;
  state: CheckProgress;
  deadlineAt: number | null;
  title: string;
  item: Item;
}

const kindIcon: Record<CheckKind, string> = {
  review: "rate_review",
  check: "fact_check",
  finalize: "task_alt",
};
const kindChip: Record<CheckKind, string> = {
  review: "校正する",
  check: "確認する",
  finalize: "校了する",
};
const kindName: Record<CheckKind, string> = {
  review: "校正",
  check: "専門確認",
  finalize: "校了",
};

const tabLabel: Record<CheckTab, string> = { todo: "未着手", doing: "確認中", done: "完了" };
const emptyText: Record<CheckTab, string> = {
  todo: "未着手の校正はありません",
  doing: "確認中の校正はありません",
  done: "完了した校正はありません",
};

/**
 * 校正（自分が確かめるもの）の入口。割り当てられた校正・専門確認・校了を 未着手 / 確認中 / 完了 で見る（利用者決定 2026-10-19）。
 * 材料はダッシュボードの問い合わせ（dashboard.get）の「校正する」（mine.review。未着手 = pending・確認中 = viewed）・「専門確認をする」
 * （mine.checks）・「校了する」（mine.finalize）と、自分の分が終わったもの（done）。分け方と締切順は domain の groupCheckEntries。
 * 「割り当てる」（校正者がいない版。割当権限のある人）は小さなまとまりで下に。行を押すとエディタが開く（既定のコメントの引き出し）
 */
function Check() {
  const { show: tab = "todo" } = Route.useSearch();
  const navigate = useNavigate();
  useEffect(() => rememberWorkspace("check"), []);
  const data = useQuery(api.dashboard.get, {});

  const setTab = (next: CheckTab) =>
    void navigate({ to: "/check", search: next === "todo" ? {} : { show: next }, replace: true });
  const open = (workId: string, title: string, search: { tab?: "info" } = {}) => {
    rememberWorkHint(workId, { title });
    void navigate({ to: "/works/$workId", params: { workId }, search });
  };

  const groups = useMemo(() => {
    if (!data) return null;
    const entries: Entry[] = [
      ...data.mine.review,
      ...data.mine.checks,
      ...data.mine.finalize,
      ...data.done,
    ].flatMap((item) =>
      item.task && item.taskState
        ? [
            {
              key: `${item.task}-${item.revisionId}-${item.note ?? ""}`,
              kind: item.task,
              state: item.taskState,
              deadlineAt: item.deadlineAt,
              title: item.workTitle,
              item,
            },
          ]
        : [],
    );
    return groupCheckEntries(entries);
  }, [data]);

  if (!data || !groups)
    return (
      <div className="hub" data-hub="check">
        <AppBarSlot slot="title">校正</AppBarSlot>
        <Loading label="校正を読み込んでいます" />
      </div>
    );

  const assign = data.mine.assign;
  const list = groups[tab];
  return (
    <div className="hub" data-hub="check">
      <AppBarSlot slot="title">校正</AppBarSlot>
      <ChoiceGroup<CheckTab>
        label="校正の表示"
        value={tab}
        onChange={setTab}
        className="hub__tabs"
        choices={(["todo", "doing", "done"] as const).map((t) => ({
          value: t,
          label: `${tabLabel[t]} ${groups[t].length}`,
        }))}
      />
      {list.length === 0 ? (
        <Empty icon={tab === "done" ? "task_alt" : "fact_check"}>
          <span className="title-medium">{emptyText[tab]}</span>
        </Empty>
      ) : (
        <Group title={tabLabel[tab]} count={list.length} label={`校正（${tabLabel[tab]}）`}>
          {list.map((e) => (
            <WorkspaceRow
              key={e.key}
              icon={kindIcon[e.kind]}
              title={e.title}
              suffix={e.item.revisionLabel}
              lines={[
                [kindName[e.kind], e.item.note, e.kind === "review" ? unresolvedText(e.item) : null]
                  .filter(Boolean)
                  .join("・"),
                deadlineText("校正の締切", e.deadlineAt),
              ]}
              chip={e.state === "done" ? "見る" : kindChip[e.kind]}
              chipIcon={e.state === "done" ? "visibility" : kindIcon[e.kind]}
              onOpen={() => open(e.item.workId, e.title)}
            />
          ))}
        </Group>
      )}
      {assign.length > 0 ? (
        <Group title="割り当てる" count={assign.length} side>
          {assign.map((i) => (
            <WorkspaceRow
              key={`assign-${i.revisionId}`}
              icon="group_add"
              title={i.workTitle}
              suffix={i.revisionLabel}
              lines={["校正者がいません", deadlineText("校正の締切", i.deadlineAt)]}
              chip="割り当てる"
              chipIcon="group_add"
              onOpen={() => open(i.workId, i.workTitle, { tab: "info" })}
            />
          ))}
        </Group>
      ) : null}
    </div>
  );
}

/** 校正の行の補足: コメント数（自分が付けたものではなく、その版の未解決の数） */
const unresolvedText = (i: Item) => (i.count > 0 ? `未解決のコメント ${i.count}` : null);
