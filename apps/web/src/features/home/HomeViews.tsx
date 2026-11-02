import { api } from "@mf100/convex/api";
import { groupCheckEntries, type CheckKind, type CheckProgress } from "@mf100/domain";
import { useNavigate } from "@tanstack/react-router";
import { useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { useMemo } from "react";
import { DashboardOverview } from "@/features/home/DashboardOverview";
import { Empty, Group, WorkspaceRow, deadlineLine } from "@/features/workspace/parts";
import { useWindowClass } from "@/lib/useMedia";
import { rememberWorkHint } from "@/lib/workHint";
import { Loading } from "@/ui/Loading";

/**
 * ホームの見え方ごとの中身（ロール名は出さない。decisions 38A）。
 * - 共同: 制作物の状況（数字・滞っている制作物・内訳。制作物の一覧の先頭と同じもの）
 * - 確認: 自分が校了する版と専門確認（校正の入口の「校了する」「確認する」と同じ材料）
 */

export function CollaborationHome() {
  const dash = useQuery(api.dashboard.works, {});
  const cls = useWindowClass();
  if (dash === undefined) return <Loading label="制作物の状況を読み込んでいます" />;
  if (dash.overview.total === 0)
    return (
      <Empty icon="groups">
        <span className="title-medium">進行中の制作物はありません</span>
      </Empty>
    );
  return <DashboardOverview data={dash} twoColumns={cls === "expanded" || cls === "large"} flat />;
}

type CheckData = FunctionReturnType<typeof api.dashboard.check>;
type CheckItem = CheckData["done"][number];
interface Entry {
  key: string;
  kind: CheckKind;
  state: CheckProgress;
  deadlineAt: number | null;
  title: string;
  item: CheckItem;
}

const kindIcon: Record<CheckKind, string> = {
  review: "rate_review",
  check: "fact_check",
  finalize: "task_alt",
};

export function VerifiedHome() {
  const data = useQuery(api.dashboard.check, {});
  const navigate = useNavigate();
  const groups = useMemo(() => {
    if (!data) return null;
    const entries: Entry[] = [...data.mine.checks, ...data.mine.finalize].flatMap((item) =>
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
    const g = groupCheckEntries(entries);
    const todo = [...g.todo, ...g.doing];
    return {
      finalize: todo.filter((e) => e.kind === "finalize"),
      check: todo.filter((e) => e.kind === "check"),
    };
  }, [data]);
  if (!groups) return <Loading label="確認するものを読み込んでいます" />;
  const open = (e: Entry) => {
    rememberWorkHint(e.item.workId, { title: e.title });
    void navigate({
      to: "/works/$workId",
      params: { workId: e.item.workId },
      search: e.kind === "check" ? { tab: "info" } : {},
    });
  };
  if (groups.finalize.length === 0 && groups.check.length === 0)
    return (
      <Empty icon="verified">
        <span className="title-medium">確認するものはありません</span>
      </Empty>
    );
  const row = (e: Entry, chip: string) => (
    <WorkspaceRow
      key={e.key}
      icon={kindIcon[e.kind]}
      title={e.title}
      suffix={e.item.revisionLabel}
      lines={[
        e.kind === "finalize"
          ? e.item.progress
            ? `校了 ${e.item.progress.done}/${e.item.progress.total} 人が宣言済み`
            : null
          : e.item.note,
        deadlineLine("校正期日", e.deadlineAt),
      ]}
      {...(e.item.reviewUrgent === true ? { reviewUrgent: true } : {})}
      chip={chip}
      chipIcon={kindIcon[e.kind]}
      onOpen={() => open(e)}
    />
  );
  return (
    <>
      {groups.finalize.length > 0 ? (
        <Group title="校了する" count={groups.finalize.length}>
          {groups.finalize.map((e) => row(e, "校了する"))}
        </Group>
      ) : null}
      {groups.check.length > 0 ? (
        <Group title="確認する" count={groups.check.length}>
          {groups.check.map((e) => row(e, "確認する"))}
        </Group>
      ) : null}
    </>
  );
}
