import { api } from "@mf100/convex/api";
import { useNavigate } from "@tanstack/react-router";
import { useQuery } from "convex/react";
import { M3eButton, M3eFilterChip, M3eFilterChipSet, M3eIcon, M3eInputChip } from "@/ui/m3e";
import { FeedbackThreadList } from "./FeedbackThreadList";

/** フィードバックの一覧の絞り込み（URL に持つ。一覧・詳細の行き来で保つ） */
export type FeedbackListSearch = { work?: string; mine?: boolean; unread?: boolean };

export function validateFeedbackListSearch(s: Record<string, unknown>): FeedbackListSearch {
  return {
    ...(typeof s.work === "string" && s.work ? { work: s.work } : {}),
    ...(s.mine === true || s.mine === "true" ? { mine: true } : {}),
    ...(s.unread === true || s.unread === "true" ? { unread: true } : {}),
  };
}

/**
 * フィードバックの一覧ペイン（絞り込み＋スレッド）。全画面の一覧と、広い画面の一覧・詳細の左ペイン。
 * 絞り込みはフィルターチップの組（自分が関わる・未読）と、制作物から来たときの入力チップ。
 */
export function FeedbackListPane({
  search,
  selectedId,
  onCreate,
}: {
  search: FeedbackListSearch;
  selectedId?: string;
  /** 新しいスレッド（広い画面だけ。狭い画面はアプリバーのボタン） */
  onCreate?: () => void;
}) {
  const navigate = useNavigate();
  // 制作物で絞っているときの表示名（その制作物のスレッドから取る）
  const workTitle = useQuery(
    api.feedback.listThreads,
    search.work ? { workId: search.work, limit: 1 } : "skip",
  )?.[0]?.workTitle;
  const setFilter = (patch: { work?: string | undefined; mine?: boolean; unread?: boolean }) =>
    void navigate({
      to: ".",
      search: (s: FeedbackListSearch & Record<string, unknown>) => {
        const merged: Record<string, unknown> = { ...s, ...patch };
        for (const k of Object.keys(patch)) if (!merged[k]) delete merged[k];
        return merged as FeedbackListSearch;
      },
      replace: true,
    });
  return (
    <div className="fb-list-pane">
      <div className="fb-list-pane__controls">
        <M3eFilterChipSet aria-label="絞り込み">
          <M3eFilterChip
            selected={search.mine === true}
            onClick={() => setFilter({ mine: !search.mine })}
          >
            自分が関わる
          </M3eFilterChip>
          <M3eFilterChip
            selected={search.unread === true}
            onClick={() => setFilter({ unread: !search.unread })}
          >
            未読
          </M3eFilterChip>
        </M3eFilterChipSet>
        {search.work ? (
          <M3eInputChip
            removable
            removeLabel="制作物の絞り込みを外す"
            onRemove={() => setFilter({ work: undefined })}
          >
            {workTitle ?? "この制作物"}
          </M3eInputChip>
        ) : null}
        {onCreate ? (
          <>
            <span className="spacer" />
            <M3eButton variant="filled" onClick={onCreate}>
              <M3eIcon slot="icon" name="add_comment" />
              スレッドを立てる
            </M3eButton>
          </>
        ) : null}
      </div>
      <FeedbackThreadList
        {...(search.work ? { work: search.work } : {})}
        mine={search.mine === true}
        unreadOnly={search.unread === true}
        {...(selectedId ? { selectedId } : {})}
        onOpen={(id) =>
          void navigate({
            to: "/feedback/$threadId",
            params: { threadId: id },
            search: (s: FeedbackListSearch & Record<string, unknown>) => {
              const { new: _drop, ...rest } = s;
              return rest;
            },
          })
        }
      />
    </div>
  );
}
