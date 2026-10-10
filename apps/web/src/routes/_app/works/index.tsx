import { api } from "@mf100/convex/api";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "convex/react";
import { useState } from "react";
import { formatJst } from "@/lib/format";
import { lifecycleLabel, mediaLabel } from "@/lib/labels";
import { Select, TextInput } from "@/ui/Field";
import { M3eButton, M3eIcon } from "@/ui/m3e";

export const Route = createFileRoute("/_app/works/")({ component: Works });

/** U-02 制作物一覧。権限のない作品は一覧にも出ない（サーバー側で絞る）。 */
function Works() {
  const [text, setText] = useState("");
  const [lifecycle, setLifecycle] = useState<string>("");
  const works = useQuery(api.works.listMine, {
    ...(text ? { text } : {}),
    ...(lifecycle ? { lifecycle: lifecycle as "active" } : {}),
  });
  return (
    <>
      <h1 className="page-title">
        制作物
        <span className="spacer" />
        <Link to="/works/new">
          <M3eButton variant="filled">
            <M3eIcon slot="icon">add</M3eIcon>制作物を登録
          </M3eButton>
        </Link>
      </h1>
      <div className="row" style={{ marginBottom: 12 }}>
        <TextInput
          placeholder="名称・旧ID・担当・用途で検索"
          value={text}
          onChange={(e) => setText(e.target.value)}
          style={{ minWidth: 280 }}
          aria-label="検索"
        />
        <Select
          value={lifecycle}
          onChange={(e) => setLifecycle(e.target.value)}
          aria-label="状態で絞り込み"
        >
          <option value="">すべての状態</option>
          {Object.entries(lifecycleLabel).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </Select>
      </div>
      {works === undefined ? (
        <p className="muted">読み込み中…</p>
      ) : works.length === 0 ? (
        <div className="empty">
          閲覧できる制作物がありません。関係する制作物の閲覧許可は校正システム管理者が付与します。
        </div>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>名称</th>
              <th>旧ID</th>
              <th>区分</th>
              <th>媒体</th>
              <th>状態</th>
              <th>現在版</th>
              <th>受付締切（JST）</th>
            </tr>
          </thead>
          <tbody>
            {works.map((w) => (
              <tr key={w.id}>
                <td>
                  <Link to="/works/$workId" params={{ workId: w.id }}>
                    {w.title}
                  </Link>
                  {w.confidentiality === "restricted" ? (
                    <span className="chip chip--error" style={{ marginLeft: 6 }}>
                      非公開
                    </span>
                  ) : null}
                </td>
                <td className="small muted">{w.legacyId ?? "—"}</td>
                <td>{w.category}</td>
                <td>{mediaLabel[w.mediaType]}</td>
                <td>
                  <span
                    className={`chip ${w.lifecycle === "finalized" ? "chip--ok" : w.lifecycle === "active" ? "chip--primary" : ""}`}
                  >
                    {lifecycleLabel[w.lifecycle]}
                  </span>
                </td>
                <td>{w.latestRevisionLabel ?? "未提出"}</td>
                <td className="small">
                  {w.acceptingDeadlineAt ? formatJst(w.acceptingDeadlineAt) : "受付中の版なし"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}
