import { api } from "@mf100/convex/api";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery } from "convex/react";
import { useState } from "react";
import { NewWorkDialog } from "@/features/work/NewWorkDialog";
import { formatJstDate } from "@/lib/format";
import { lifecycleLabel } from "@/lib/labels";
import { useWindowClass } from "@/lib/useMedia";
import { AppBarSlot } from "@/ui/AppBarSlot";
import { M3eActionList, M3eFilterChip, M3eFilterChipSet, M3eIcon, M3eListAction } from "@/ui/m3e";

export const Route = createFileRoute("/_app/works/")({
  validateSearch: (s: Record<string, unknown>): { q?: string; new?: boolean } => ({
    ...(typeof s.q === "string" && s.q ? { q: s.q } : {}),
    ...(s.new === true || s.new === "true" ? { new: true } : {}),
  }),
  component: Works,
});

/**
 * U-02 制作物。探して開くだけの入口。行を押すとエディタ（最新版）が開く。登録はレールの FAB「制作物を登録」が開くダイアログ（`?new=1`）。
 * 検索語は `q` で渡る（検索バーは一旦外している）。見出し「制作物」は共通アプリバーに差し込む（M3 App bars）。
 */
function Works() {
  const { q, new: creating } = Route.useSearch();
  const navigate = useNavigate();
  const [lifecycle, setLifecycle] = useState<string>("");
  // 「制作物を登録」はレールの FAB にある（compact にはレールが無い）
  const canRegister = useWindowClass() !== "compact";
  const works = useQuery(api.works.listMine, {
    ...(q ? { text: q } : {}),
    ...(lifecycle ? { lifecycle: lifecycle as "active" } : {}),
  });
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
      {works === undefined ? (
        <p className="muted">読み込み中…</p>
      ) : works.length === 0 ? (
        <div className="empty">
          {q
            ? `「${q}」に一致する制作物はありません`
            : canRegister && !lifecycle
              ? "制作物がありません。「制作物を登録」から登録できます。"
              : "制作物がありません"}
        </div>
      ) : (
        <M3eActionList className="list" aria-label="制作物">
          {works.map((w) => (
            <M3eListAction
              key={w.id}
              className={`list__item ${w.lifecycle === "finalized" || w.lifecycle === "cancelled" ? "list__item--done" : ""}`}
              onClick={() => void navigate({ to: "/works/$workId", params: { workId: w.id } })}
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
              <span slot="supporting-text">
                {w.latestRevisionLabel ?? "未提出"}
                {w.acceptingDeadlineAt ? `・締切 ${formatJstDate(w.acceptingDeadlineAt)}` : ""}
              </span>
              {w.lifecycle !== "active" ? (
                <span slot="trailing" className="meta">
                  {lifecycleLabel[w.lifecycle]}
                </span>
              ) : null}
            </M3eListAction>
          ))}
        </M3eActionList>
      )}
      <NewWorkDialog open={creating === true} onClose={() => setCreating(false)} />
    </div>
  );
}
