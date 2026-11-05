import { api } from "@mf100/convex/api";
import type { Id } from "@mf100/convex/dataModel";
import { useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery } from "convex/react";
import { useMemo } from "react";
import { Empty, Group } from "@/features/workspace/parts";
import { formatJstShort } from "@/lib/format";
import { useAction } from "@/lib/useAction";
import { AppBarSlot } from "@/ui/AppBarSlot";
import { ChoiceGroup } from "@/ui/ChoiceGroup";
import { ControlledSelect, Field, useFieldId, useFieldLabelId } from "@/ui/Field";
import { Loading } from "@/ui/Loading";
import { M3eButton } from "@m3e/react/button";
import { M3eIcon } from "@m3e/react/icon";
import { M3eListAction } from "@m3e/react/list";
import { M3eOption } from "@m3e/react/option";
import { MarkReadButton } from "./NotificationsBell";
import {
  notificationDestination,
  notificationIcon,
  notificationKindLabel,
} from "./notificationKinds";

/** 絞り込みの select。項目名（Field）と結び付けて読み上げ名を持たせる */
function FilterSelect({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (value: string | undefined) => void;
  options: readonly (readonly [string, string])[];
}) {
  const fieldId = useFieldId(undefined);
  const labelId = useFieldLabelId();
  return (
    <ControlledSelect
      {...(fieldId ? { id: fieldId } : {})}
      {...(labelId ? { "aria-labelledby": labelId } : {})}
      className="select"
      value={value}
      onValueChange={(v) => onChange(v[0])}
    >
      <M3eOption value="">すべて</M3eOption>
      {options.map(([v, label]) => (
        <M3eOption key={v} value={v}>
          {label}
        </M3eOption>
      ))}
    </ControlledSelect>
  );
}

export interface NotificationsSearch {
  unread?: boolean;
  work?: string;
  kind?: string;
}

/** 全画面で読む件数の上限（パネルは 20）。それより古いものは「未読」に絞るか制作物で絞って探す */
const PAGE_LIMIT = 200;

/**
 * 通知の全画面（利用者指示 2026-11-05「通知を全画面でも開けるようにしたい。制作物ごとなど、いろんなフィルターで作業したい」）。
 * 未読／すべて はサーバーで（未読の索引で古い未読も出る）、制作物・種類は読んだ分の中で絞る。絞り込みは URL に残る
 */
export function NotificationsPage({ search }: { search: NotificationsSearch }) {
  const navigate = useNavigate();
  const unread = search.unread === true;
  const list = useQuery(api.notifications.list, {
    limit: PAGE_LIMIT,
    ...(unread ? { unreadOnly: true } : {}),
  });
  const markRead = useMutation(api.notifications.markRead);
  const markAllRead = useMutation(api.notifications.markAllRead);
  const doMarkAll = useAction(async () => {
    await markAllRead({});
  });
  const doMarkRead = useAction(async (id: Id<"notifications">) => {
    await markRead({ notificationId: id });
  });
  const setSearch = (next: {
    unread?: boolean | undefined;
    work?: string | undefined;
    kind?: string | undefined;
  }) => {
    const clean: NotificationsSearch = {};
    if (next.unread) clean.unread = true;
    if (next.work) clean.work = next.work;
    if (next.kind) clean.kind = next.kind;
    void navigate({ to: "/notifications", search: clean, replace: true });
  };

  // 絞り込みの候補: 読んだ分に出てくる制作物（名前付き）と種類
  const works = useMemo(() => {
    const m = new Map<string, string>();
    for (const n of list ?? [])
      if (n.workId && n.workTitle && !m.has(n.workId)) m.set(n.workId, n.workTitle);
    return [...m.entries()].sort((a, b) => a[1].localeCompare(b[1], "ja"));
  }, [list]);
  const kinds = useMemo(() => {
    const seen = new Set<string>();
    for (const n of list ?? []) seen.add(n.kind);
    return [...seen].sort((a, b) =>
      (notificationKindLabel[a] ?? a).localeCompare(notificationKindLabel[b] ?? b, "ja"),
    );
  }, [list]);
  const rows = (list ?? []).filter(
    (n) => (!search.work || n.workId === search.work) && (!search.kind || n.kind === search.kind),
  );
  const unreadCount = rows.filter((n) => n.readAt === undefined).length;

  const open = async (n: NonNullable<typeof list>[number]) => {
    if (n.readAt === undefined)
      await markRead({ notificationId: n.id as Id<"notifications"> }).catch(() => undefined);
    const dest = notificationDestination(n);
    if (dest) void navigate(dest);
  };

  return (
    <div className="hub" data-hub="notifications">
      <AppBarSlot slot="title">通知</AppBarSlot>
      <AppBarSlot slot="actions">
        {unreadCount > 0 ? (
          <M3eButton
            variant="text"
            disabled={doMarkAll.pending}
            onClick={() => void doMarkAll.run()}
          >
            <M3eIcon slot="icon" name="done_all" />
            すべて既読にする
          </M3eButton>
        ) : null}
      </AppBarSlot>
      <div className="notif-page__filters">
        <ChoiceGroup<"all" | "unread">
          label="通知の絞り込み"
          value={unread ? "unread" : "all"}
          onChange={(v) =>
            setSearch({ ...search, ...(v === "unread" ? { unread: true } : { unread: undefined }) })
          }
          className="hub__tabs"
          choices={[
            { value: "all", label: "すべて" },
            { value: "unread", label: "未読" },
          ]}
        />
        <div className="notif-page__select">
          <Field label="制作物">
            <FilterSelect
              value={search.work ?? ""}
              onChange={(v) => setSearch({ ...search, work: v })}
              options={works.map(([id, title]) => [id, title])}
            />
          </Field>
        </div>
        <div className="notif-page__select">
          <Field label="種類">
            <FilterSelect
              value={search.kind ?? ""}
              onChange={(v) => setSearch({ ...search, kind: v })}
              options={kinds.map((k) => [k, notificationKindLabel[k] ?? k])}
            />
          </Field>
        </div>
      </div>
      {list === undefined ? (
        <Loading label="通知を読み込んでいます" />
      ) : rows.length === 0 ? (
        <Empty icon="notifications">
          <span className="title-medium">
            {unread ? "未読の通知はありません" : "通知はありません"}
          </span>
        </Empty>
      ) : (
        <Group
          title={unread ? "未読" : "通知"}
          count={rows.length}
          label="通知"
          className="notif-page__list"
        >
          {rows.map((n) => (
            <M3eListAction
              key={n.id}
              className={`list__item notif ${n.readAt === undefined ? "notif--unread" : ""}`}
              data-kind={n.kind}
              onClick={() => void open(n)}
            >
              <M3eIcon slot="leading" name={notificationIcon[n.kind] ?? "notifications"} />
              <span className="list__headline notif__title">
                {n.readAt === undefined ? <span className="sr-only">未読 </span> : null}
                {n.title}
              </span>
              <span slot="supporting-text">
                {n.body}
                <span className="notif__time">　{formatJstShort(n.createdAt)}</span>
              </span>
              {n.readAt === undefined ? (
                <MarkReadButton
                  slot="trailing"
                  pointerOnly
                  title={n.title}
                  onClick={() => void doMarkRead.run(n.id as Id<"notifications">)}
                />
              ) : null}
            </M3eListAction>
          ))}
        </Group>
      )}
    </div>
  );
}
