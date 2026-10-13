import { api } from "@mf100/convex/api";
import { createFileRoute, Outlet, useNavigate, useRouterState } from "@tanstack/react-router";
import { useQuery } from "convex/react";
import { useState } from "react";
import { formatJstDate } from "@/lib/format";
import { lifecycleLabel } from "@/lib/labels";
import {
  M3eActionList,
  M3eFilterChip,
  M3eFilterChipSet,
  M3eHeading,
  M3eIcon,
  M3eIconButton,
  M3eListAction,
} from "@/ui/m3e";

export const Route = createFileRoute("/_app/works")({
  validateSearch: (s: Record<string, unknown>): { q?: string } =>
    typeof s.q === "string" && s.q ? { q: s.q } : {},
  component: WorksLayout,
});

/**
 * U-02 制作物（M3 の list-detail）。左に一覧、右に選んだ制作物の中身（子ルート）。
 * 狭い画面では一覧と中身を別画面として切り替える（Gmail のモバイルと同じ）。
 * 検索語はアプリバーの検索から `q` で渡る。
 */
function WorksLayout() {
  const { q } = Route.useSearch();
  const path = useRouterState({ select: (s) => s.location.pathname });
  const navigate = useNavigate();
  const [lifecycle, setLifecycle] = useState<string>("");
  const works = useQuery(api.works.listMine, {
    ...(q ? { text: q } : {}),
    ...(lifecycle ? { lifecycle: lifecycle as "active" } : {}),
  });
  const child = path !== "/works" && path !== "/works/";
  const selectedId = /^\/works\/([^/]+)/.exec(path)?.[1] ?? null;

  return (
    <div className={`list-detail ${child ? "list-detail--child" : ""}`}>
      <aside className="list-detail__list" aria-label="制作物一覧">
        <div className="list-detail__head">
          <M3eHeading variant="headline" size="small" level={1} emphasized>
            制作物
          </M3eHeading>
          <span className="spacer" />
          <M3eIconButton
            aria-label="制作物を登録"
            onClick={() => void navigate({ to: "/works/new" })}
          >
            <M3eIcon name="add" />
          </M3eIconButton>
        </div>
        <M3eFilterChipSet aria-label="状態で絞り込み" className="list-detail__filters">
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
            {q ? `「${q}」に一致する制作物はありません。` : "制作物がありません。"}
          </div>
        ) : (
          <M3eActionList className="list" aria-label="制作物">
            {works.map((w) => (
              <M3eListAction
                key={w.id}
                className={`list__item ${w.id === selectedId ? "list__item--selected" : ""} ${w.lifecycle === "finalized" || w.lifecycle === "cancelled" ? "list__item--done" : ""}`}
                aria-current={w.id === selectedId ? "page" : undefined}
                onClick={() =>
                  void navigate({
                    to: "/works/$workId",
                    params: { workId: w.id },
                    search: (s) => s,
                  })
                }
              >
                <span className="list__headline">
                  {w.title}
                  {w.confidentiality === "restricted" ? (
                    <M3eIcon name="lock" className="ml list__lock" title="非公開" />
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
      </aside>
      <section className="list-detail__detail">
        <Outlet />
      </section>
    </div>
  );
}
