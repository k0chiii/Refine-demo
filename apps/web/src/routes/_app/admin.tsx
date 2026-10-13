import { api } from "@mf100/convex/api";
import type { Id } from "@mf100/convex/dataModel";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery } from "convex/react";
import { useState } from "react";
import { lifecycleTone } from "./works/index";
import { formatJst } from "@/lib/format";
import { lifecycleLabel } from "@/lib/labels";
import { useAction } from "@/lib/useAction";
import { Card } from "@/ui/Card";
import { StatusChip } from "@/ui/Chip";
import { M3eButton, M3eIcon, M3eSearchBar } from "@/ui/m3e";
import { PageHeader } from "@/ui/PageHeader";

export const Route = createFileRoute("/_app/admin")({ component: Admin });

/** U-08 管理: 作品ごとの ACL 入口、ユーザー（システム管理者の付与）、監査ログ（F-13）。 */
function Admin() {
  const me = useQuery(api.me.me, {});
  const [text, setText] = useState("");
  const users = useQuery(api.acl.searchUsers, me?.isSystemAdmin ? { text } : "skip");
  const audit = useQuery(api.admin.auditLog, me?.isSystemAdmin ? { limit: 100 } : "skip");
  const works = useQuery(api.acl.adminWorks, me?.isSystemAdmin ? {} : "skip");
  const setAdmin = useMutation(api.admin.setSystemAdmin);
  const toggle = useAction(async (userId: string, value: boolean) => {
    await setAdmin({ userId: userId as Id<"users">, value });
  });
  if (!me) return null;
  if (!me.isSystemAdmin)
    return (
      <div className="alert">
        <M3eIcon name="block" />
        管理画面は校正システム管理者のみ利用できます。
      </div>
    );
  return (
    <>
      <PageHeader title="管理" />
      <div className="stack">
        <Card title="作品ごとの閲覧権限（個人 ACL）">
          <div className="table-wrap" tabIndex={0}>
            <table className="table">
              <thead>
                <tr>
                  <th>名称</th>
                  <th>状態</th>
                  <th>許可</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {(works ?? []).map((w) => (
                  <tr key={w.id}>
                    <td>
                      {w.title}
                      {w.confidentiality === "restricted" ? (
                        <M3eIcon
                          name="lock"
                          className="ml"
                          title="非公開"
                          style={{ fontSize: 16 }}
                        />
                      ) : null}
                    </td>
                    <td>
                      <StatusChip tone={lifecycleTone[w.lifecycle] ?? "neutral"}>
                        {lifecycleLabel[w.lifecycle] ?? w.lifecycle}
                      </StatusChip>
                    </td>
                    <td>{w.activeGrantCount} 件</td>
                    <td>
                      <Link to="/works/$workId/acl" params={{ workId: w.id }} className="nav-link">
                        <M3eButton variant="text">
                          <M3eIcon slot="icon" name="manage_accounts" />
                          編集
                        </M3eButton>
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
        <div className="grid-2">
          <Card title="ユーザー">
            <M3eSearchBar className="search" clearable onClear={() => setText("")}>
              <M3eIcon slot="leading" name="search" />
              <input
                slot="input"
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="名前・メールで検索"
                aria-label="ユーザー検索"
              />
            </M3eSearchBar>
            <div className="table-wrap" tabIndex={0}>
              <table className="table">
                <thead>
                  <tr>
                    <th>名前</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {(users ?? []).map((u) => (
                    <tr key={u.id}>
                      <td>
                        {u.name}
                        <div className="small muted">{u.email}</div>
                      </td>
                      <td>
                        <M3eButton
                          variant={u.isSystemAdmin ? "outlined" : "text"}
                          disabled={toggle.pending}
                          onClick={() => void toggle.run(u.id, !u.isSystemAdmin)}
                        >
                          <M3eIcon
                            slot="icon"
                            name={u.isSystemAdmin ? "remove_moderator" : "add_moderator"}
                          />
                          {u.isSystemAdmin ? "管理者を解除" : "管理者にする"}
                        </M3eButton>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
          <Card title="監査ログ">
            <div className="table-wrap" tabIndex={0}>
              <table className="table">
                <thead>
                  <tr>
                    <th>時刻</th>
                    <th>操作</th>
                    <th>対象</th>
                  </tr>
                </thead>
                <tbody>
                  {(audit ?? []).map((e) => (
                    <tr key={e._id}>
                      <td className="small">{formatJst(e.at)}</td>
                      <td>
                        <StatusChip>{e.operation}</StatusChip>
                      </td>
                      <td className="small muted">{e.entityType}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      </div>
    </>
  );
}
