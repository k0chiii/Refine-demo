import { api } from "@mf100/convex/api";
import type { Id } from "@mf100/convex/dataModel";
import { classifyMakeRow, isMakeTab, type MakeAction, type MakeTab } from "@mf100/domain";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { useEffect, useMemo } from "react";
import { submitRouteIcon, useSubmitLauncher } from "@/features/home/SubmitPicker";
import { Empty, Group, WorkspaceRow, deadlineText } from "@/features/workspace/parts";
import { formatJstShort } from "@/lib/format";
import { mediaLabel } from "@/lib/labels";
import { useAction } from "@/lib/useAction";
import { rememberWorkspace } from "@/lib/workspace";
import { rememberWorkHint } from "@/lib/workHint";
import { AppBarSlot } from "@/ui/AppBarSlot";
import { ChoiceGroup } from "@/ui/ChoiceGroup";
import { Loading } from "@/ui/Loading";
import { M3eButton } from "@m3e/react/button";
import { M3eIcon } from "@m3e/react/icon";

export const Route = createFileRoute("/_app/make")({
  validateSearch: (s: Record<string, unknown>): { show?: Exclude<MakeTab, "active"> } =>
    isMakeTab(s.show) && s.show !== "active" ? { show: s.show } : {},
  component: Make,
});

type Data = FunctionReturnType<typeof api.dashboard.get>;
type Overview = Data["overview"]["works"][number];

const actionLabel: Record<MakeAction, string> = {
  respond: "対応する",
  submit: "版を提出",
  view: "見る",
};
const actionIcon: Record<MakeAction, string> = {
  respond: "comment",
  submit: "upload_file",
  view: "visibility",
};

/** 進行中として出す段階（保留・校了は出さない） */
const inProgress = new Set(["unsubmitted", "reviewing", "lapsed"]);

/**
 * 制作（自分が作るもの）の入口。制作者になっている制作物を 進行中 / 下書き / 校了済み で見る（利用者決定 2026-10-19）。
 * - 進行中: 「あなたの番」（未対応のコメントに返事をする・次の版を出す）と「校正中」（校正と校了を待っている）。
 *   材料はダッシュボードの問い合わせ（dashboard.get。「返事をする」「提出する」と制作者の行）。分け方は domain の classifyMakeRow
 * - 下書き: 文章・SNS 投稿の下書き（documents.writable）。校了済み: 自分が制作者の校了した制作物（works.listMine）。どちらも開いたときだけ読む
 * - 行は 1 つの「次の操作」の印を持ち、押すとエディタが開く（返事をする・見るは、未解決のコメントが並ぶコメントの引き出しで）。
 *   版を出す行だけは提出の入口（添付は版提出ダイアログ、文章・SNS はそれぞれのエディタ）へ
 */
function Make() {
  const { show: tab = "active" } = Route.useSearch();
  const navigate = useNavigate();
  useEffect(() => rememberWorkspace("make"), []);
  const data = useQuery(api.dashboard.get, {});
  const me = useQuery(api.me.me, {});
  const drafts = useQuery(api.documents.writable, tab === "draft" ? {} : "skip");
  const finished = useQuery(
    api.works.listMine,
    tab === "done" ? { lifecycle: "finalized" as const } : "skip",
  );
  const launcher = useSubmitLauncher();
  const markRead = useMutation(api.notifications.markRead);

  const setTab = (next: MakeTab) =>
    void navigate({
      to: "/make",
      search: next === "active" ? {} : { show: next },
      replace: true,
    });
  const open = (workId: string, title: string, search: { tab?: "comments" } = {}) => {
    rememberWorkHint(workId, { title });
    void navigate({ to: "/works/$workId", params: { workId }, search });
  };

  const rows = useMemo(() => {
    if (!data) return null;
    const respond = new Map(data.mine.respond.map((i) => [i.workId, i.count]));
    const submit = new Map(data.mine.submit.map((i) => [i.workId, i]));
    return data.overview.works
      .filter((r) => r.isCreator && inProgress.has(r.stage))
      .map((r) => {
        const target = submit.get(r.workId);
        const c = classifyMakeRow({
          accepting: r.stage === "reviewing",
          toRespond: respond.get(r.workId) ?? 0,
          canSubmit: target !== undefined,
        });
        return { r, target, toRespond: respond.get(r.workId) ?? 0, ...c };
      });
  }, [data]);

  const openMention = useAction(async (m: Data["mentions"][number]) => {
    if (m.unread && m.notificationId)
      await markRead({ notificationId: m.notificationId as Id<"notifications"> });
    if (m.revisionId)
      void navigate({
        to: "/revisions/$revisionId",
        params: { revisionId: m.revisionId },
        search: m.threadId ? { thread: m.threadId } : {},
      });
    else open(m.workId, m.workTitle);
  });

  const tabs = (
    <ChoiceGroup<MakeTab>
      label="制作の表示"
      value={tab}
      onChange={setTab}
      className="hub__tabs"
      choices={[
        { value: "active", label: "進行中" },
        { value: "draft", label: "下書き" },
        { value: "done", label: "校了済み" },
      ]}
    />
  );

  const progressLines = (r: Overview): Array<string | false> => [
    r.reviewersTotal === 0
      ? "校正者が未割り当て"
      : `校正 ${r.reviewersDone}/${r.reviewersTotal} 人完了${r.checksPending > 0 ? `・専門確認 ${r.checksPending}` : ""}`,
    r.approvalQuorum > 0 ? `校了 ${r.approvalDeclared}/${r.approvalQuorum}人` : false,
  ];

  const activeBody = () => {
    if (!data || !rows) return <Loading label="制作を読み込んでいます" />;
    const turn = rows.filter((x) => x.group === "turn");
    const waiting = rows.filter((x) => x.group === "waiting");
    const mine = new Set(rows.map((x) => x.r.workId));
    const upcoming = data.upcoming.filter((i) => mine.has(i.workId)).slice(0, 3);
    const mentions = data.mentions.filter((m) => mine.has(m.workId)).slice(0, 3);
    if (rows.length === 0)
      return (
        <Empty icon="brush">
          <span className="title-medium">進行中の制作物はありません</span>
        </Empty>
      );
    return (
      <>
        {turn.length > 0 ? (
          <Group title="あなたの番" count={turn.length}>
            {turn.map((x) => (
              <WorkspaceRow
                key={x.r.workId}
                icon={x.target ? submitRouteIcon[x.target.route ?? "upload"] : "brush"}
                title={x.r.title}
                suffix={x.action === "respond" ? x.r.revisionLabel : null}
                lines={
                  x.action === "respond"
                    ? [
                        `未対応のコメント ${x.toRespond}`,
                        deadlineText("校正の締切", x.r.reviewDeadlineAt),
                      ]
                    : [
                        x.r.stage === "unsubmitted"
                          ? "まだ版がありません"
                          : `${x.r.revisionLabel ?? ""} は受付終了`,
                        deadlineText("納期", x.r.deliveryAt),
                      ]
                }
                chip={actionLabel[x.action]}
                chipIcon={actionIcon[x.action]}
                urgent={x.r.urgency === "overdue"}
                onOpen={() =>
                  x.action === "submit" && x.target
                    ? launcher.start({ workId: x.r.workId, route: x.target.route ?? "upload" })
                    : open(x.r.workId, x.r.title, { tab: "comments" })
                }
              />
            ))}
          </Group>
        ) : null}
        {waiting.length > 0 ? (
          <Group title="校正中" count={waiting.length}>
            {waiting.map((x) => (
              <WorkspaceRow
                key={x.r.workId}
                icon="rate_review"
                title={x.r.title}
                suffix={x.r.revisionLabel}
                lines={[
                  ...progressLines(x.r),
                  deadlineText("校正の締切", x.r.reviewDeadlineAt) ||
                    deadlineText("納期", x.r.deliveryAt),
                ]}
                chip={actionLabel[x.action]}
                chipIcon={actionIcon[x.action]}
                urgent={x.r.urgency === "overdue"}
                onOpen={() => open(x.r.workId, x.r.title, { tab: "comments" })}
              />
            ))}
          </Group>
        ) : null}
        {upcoming.length > 0 ? (
          <Group title="次の締切" side>
            {upcoming.map((i) => (
              <WorkspaceRow
                key={`${i.workId}-${i.deadlineKind}`}
                icon="schedule"
                title={i.workTitle}
                suffix={i.revisionLabel}
                lines={[
                  deadlineText(i.deadlineKind === "delivery" ? "納期" : "校正の締切", i.deadlineAt),
                ]}
                chip="見る"
                onOpen={() => open(i.workId, i.workTitle)}
              />
            ))}
          </Group>
        ) : null}
        {mentions.length > 0 ? (
          <Group title="自分宛てのコメント" side>
            {mentions.map((m) => (
              <WorkspaceRow
                key={m.notificationId ?? `${m.workId}-${m.at}`}
                icon="comment"
                title={m.workTitle}
                lines={[m.note, m.at ? formatJstShort(m.at) : null]}
                chip="見る"
                onOpen={() => void openMention.run(m)}
              />
            ))}
          </Group>
        ) : null}
      </>
    );
  };

  const draftBody = () => {
    if (drafts === undefined) return <Loading label="下書きを読み込んでいます" />;
    const list = drafts.filter((w) => w.draft);
    if (list.length === 0)
      return (
        <Empty icon="edit_document">
          <span className="title-medium">下書きはありません</span>
          <M3eButton variant="tonal" onClick={() => void navigate({ to: "/write" })}>
            <M3eIcon slot="icon" name="edit_document" />
            新しく書く
          </M3eButton>
        </Empty>
      );
    return (
      <Group title="下書き" count={list.length}>
        {list.map((w) => (
          <WorkspaceRow
            key={w.workId}
            icon={w.mediaType === "sns" ? "post_add" : "edit_document"}
            title={w.title}
            lines={[
              `${mediaLabel[w.mediaType] ?? w.mediaType}・下書き「${w.draft!.title || "無題"}」・${w.draft!.chars.toLocaleString("ja-JP")} 文字`,
              `${formatJstShort(w.draft!.updatedAt)}${w.draft!.updatedBy ? ` ${w.draft!.updatedBy.name}` : ""}`,
              deadlineText("納期", w.deadlineAt),
            ]}
            chip="続きを書く"
            chipIcon="edit"
            onOpen={() =>
              void navigate({
                to: w.mediaType === "sns" ? "/works/$workId/post" : "/works/$workId/write",
                params: { workId: w.workId },
              })
            }
          />
        ))}
      </Group>
    );
  };

  const doneBody = () => {
    if (finished === undefined || me === undefined)
      return <Loading label="校了済みを読み込んでいます" />;
    const list = finished.filter((w) => me && w.creatorIds.includes(me.id));
    if (list.length === 0)
      return (
        <Empty icon="task_alt">
          <span className="title-medium">校了した制作物はありません</span>
        </Empty>
      );
    return (
      <Group title="校了済み" count={list.length}>
        {list.map((w) => (
          <WorkspaceRow
            key={w.id}
            icon="task_alt"
            title={w.title}
            suffix={w.latestRevisionLabel}
            lines={[mediaLabel[w.mediaType] ?? w.mediaType]}
            chip="見る"
            chipIcon="visibility"
            onOpen={() => open(w.id, w.title)}
          />
        ))}
      </Group>
    );
  };

  return (
    <div className="hub" data-hub="make">
      <AppBarSlot slot="title">制作</AppBarSlot>
      {tabs}
      {tab === "active" ? activeBody() : tab === "draft" ? draftBody() : doneBody()}
      {launcher.element}
    </div>
  );
}
