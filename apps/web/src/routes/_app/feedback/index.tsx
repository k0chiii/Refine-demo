import { createFileRoute, useNavigate } from "@tanstack/react-router";
import {
  FeedbackListPane,
  validateFeedbackListSearch,
  type FeedbackListSearch,
} from "@/features/feedback/FeedbackListPane";
import { NewThreadDialog } from "@/features/feedback/NewThreadDialog";
import { useWindowClass } from "@/lib/useMedia";
import { AppBarSlot } from "@/ui/AppBarSlot";
import { M3eIcon, M3eIconButton } from "@/ui/m3e";

export const Route = createFileRoute("/_app/feedback/")({
  validateSearch: (s: Record<string, unknown>): FeedbackListSearch & { new?: boolean } => ({
    ...validateFeedbackListSearch(s),
    ...(s.new === true || s.new === "true" ? { new: true } : {}),
  }),
  component: FeedbackList,
});

/**
 * フィードバック（FB。制作の相談・話し合い。解決はしない。利用者決定 2026-10-15）の受信箱。
 * 制作物ごとの相談は制作物の中（エディタの「FB」）で読み書きでき、ここは全部の制作物の相談をまとめて見る場所。
 * 広い画面（840 以上）は一覧・詳細（M3 list-detail。左に一覧、右に開いたスレッド）、狭い画面は一覧だけ。
 */
function FeedbackList() {
  const search = Route.useSearch();
  const navigate = useNavigate();
  const wc = useWindowClass();
  const wide = wc === "expanded" || wc === "large";
  const setCreating = (on: boolean) =>
    void navigate({
      to: "/feedback",
      search: (s) => {
        const { new: _drop, ...rest } = s;
        return on ? { ...rest, new: true } : rest;
      },
      replace: !on,
    });
  const list = (
    <FeedbackListPane search={search} {...(wide ? { onCreate: () => setCreating(true) } : {})} />
  );
  return (
    <>
      <AppBarSlot slot="title">フィードバック</AppBarSlot>
      {wide ? null : (
        <AppBarSlot slot="actions">
          <M3eIconButton aria-label="スレッドを立てる" onClick={() => setCreating(true)}>
            <M3eIcon name="add_comment" />
          </M3eIconButton>
        </AppBarSlot>
      )}
      {wide ? (
        <div className="fb-layout">
          <div className="fb-layout__list">{list}</div>
          <div className="fb-layout__detail fb-layout__detail--empty">
            <M3eIcon name="forum" />
            <span className="title-medium">スレッドを選ぶと、ここに開きます</span>
            <span className="muted">
              制作物ごとの相談は、制作物を開いて「FB」からも読み書きできます
            </span>
          </div>
        </div>
      ) : (
        list
      )}
      <NewThreadDialog
        open={search.new === true}
        onClose={() => setCreating(false)}
        {...(search.work ? { workId: search.work } : {})}
      />
    </>
  );
}
