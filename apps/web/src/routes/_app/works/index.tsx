import { api } from "@mf100/convex/api";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "convex/react";
import { useState } from "react";
import { formatJstDate } from "@/lib/format";
import { lifecycleLabel, mediaLabel } from "@/lib/labels";
import { StatusChip, type ChipTone } from "@/ui/Chip";
import { M3eButton, M3eFilterChip, M3eFilterChipSet, M3eIcon, M3eSearchBar } from "@/ui/m3e";
import { PageHeader } from "@/ui/PageHeader";

export const Route = createFileRoute("/_app/works/")({ component: Works });

export const lifecycleTone: Record<string, ChipTone> = {
  draft: "neutral",
  active: "primary",
  on_hold: "warning",
  finalized: "success",
  cancelled: "neutral",
};

/** U-02 制作物一覧。権限のない作品は一覧にも出ない（サーバー側で絞る）。検索は search bar、状態はフィルターチップ。 */
function Works() {
  const [text, setText] = useState("");
  const [lifecycle, setLifecycle] = useState<string>("");
  const works = useQuery(api.works.listMine, {
    ...(text ? { text } : {}),
    ...(lifecycle ? { lifecycle: lifecycle as "active" } : {}),
  });
  return (
    <>
      <PageHeader title="制作物">
        <Link to="/works/new" className="nav-link">
          <M3eButton variant="filled">
            <M3eIcon slot="icon" name="add" />
            制作物を登録
          </M3eButton>
        </Link>
      </PageHeader>
      <div className="row" style={{ marginBottom: 16 }}>
        <M3eSearchBar className="search" clearable onClear={() => setText("")}>
          <M3eIcon slot="leading" name="search" />
          <input
            slot="input"
            placeholder="名称・旧ID・担当・用途で検索"
            value={text}
            onChange={(e) => setText(e.target.value)}
            aria-label="検索"
          />
        </M3eSearchBar>
        <M3eFilterChipSet aria-label="状態で絞り込み">
          {(["active", "on_hold", "finalized"] as const).map((k) => (
            <M3eFilterChip
              key={k}
              selected={lifecycle === k}
              onClick={() => setLifecycle((cur) => (cur === k ? "" : k))}
            >
              {lifecycleLabel[k]}
            </M3eFilterChip>
          ))}
          {([] as Array<[string, string]>).map(([k, v]) => (
            <M3eFilterChip
              key={k}
              selected={lifecycle === k}
              onClick={() => setLifecycle((cur) => (cur === k ? "" : k))}
            >
              {v}
            </M3eFilterChip>
          ))}
        </M3eFilterChipSet>
      </div>
      {works === undefined ? (
        <p className="muted">読み込み中…</p>
      ) : works.length === 0 ? (
        <div className="empty">
          <M3eIcon name="folder_off" />
          閲覧できる制作物がありません。
        </div>
      ) : (
        <div className="table-wrap" tabIndex={0}>
          <table className="table">
            <thead>
              <tr>
                <th>名称</th>
                <th>状態</th>
                <th>現在版</th>
                <th>受付締切</th>
              </tr>
            </thead>
            <tbody>
              {works.map((w) => (
                <tr key={w.id} className={w.lifecycle === "finalized" ? "row--done" : ""}>
                  <td>
                    <Link to="/works/$workId" params={{ workId: w.id }}>
                      {w.title}
                    </Link>
                    {w.confidentiality === "restricted" ? (
                      <M3eIcon name="lock" className="ml" title="非公開" style={{ fontSize: 16 }} />
                    ) : null}
                    <div className="small muted">
                      {w.category}・{mediaLabel[w.mediaType]}
                    </div>
                  </td>
                  <td>
                    <StatusChip tone={lifecycleTone[w.lifecycle] ?? "neutral"}>
                      {lifecycleLabel[w.lifecycle]}
                    </StatusChip>
                  </td>
                  <td>{w.latestRevisionLabel ?? "未提出"}</td>
                  <td className="small">
                    {w.acceptingDeadlineAt ? formatJstDate(w.acceptingDeadlineAt) : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
