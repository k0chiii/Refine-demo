import { api } from "@mf100/convex/api";
import type { Id } from "@mf100/convex/dataModel";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery } from "convex/react";
import { useState } from "react";
import { formatJst } from "@/lib/format";
import { lifecycleLabel } from "@/lib/labels";
import { useAction } from "@/lib/useAction";
import { Card } from "@/ui/Card";
import { StatusChip, StatusText } from "@/ui/Chip";
import { AclPanel } from "@/features/work/AclPanel";
import { M3eButton, M3eDialog, M3eIcon, M3eSearchBar } from "@/ui/m3e";
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
  const [aclFor, setAclFor] = useState<{ id: string; title: string } | null>(null);
  const toggle = useAction(async (userId: string, value: boolean) => {
    await setAdmin({ userId: userId as Id<"users">, value });
  });
  if (!me) return null;
  if (!me.isSystemAdmin)
    return <div className="alert">管理画面は校正システム管理者のみ利用できます。</div>;
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
                      <StatusText tone={w.lifecycle === "finalized" ? "success" : "neutral"}>
                        {lifecycleLabel[w.lifecycle] ?? w.lifecycle}
                      </StatusText>
                    </td>
                    <td>{w.activeGrantCount} 件</td>
                    <td>
                      <M3eButton variant="text" onClick={() => setAclFor(w)}>
                        閲覧権限
                      </M3eButton>
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
      <M3eDialog open={aclFor !== null} onClosed={() => setAclFor(null)} closeLabel="閉じる">
        <span slot="header">閲覧権限: {aclFor?.title}</span>
        <div className="dialog-body">{aclFor ? <AclPanel workId={aclFor.id} /> : null}</div>
        <div slot="actions" className="row">
          <M3eButton variant="text" onClick={() => setAclFor(null)}>
            閉じる
          </M3eButton>
        </div>
      </M3eDialog>
    </>
  );
}
