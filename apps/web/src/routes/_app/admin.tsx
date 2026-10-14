import { api } from "@mf100/convex/api";
import type { Id } from "@mf100/convex/dataModel";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery } from "convex/react";
import { useState } from "react";
import { formatJst } from "@/lib/format";
import { lifecycleLabel } from "@/lib/labels";
import { useAction } from "@/lib/useAction";
import { AclPanel } from "@/features/work/AclPanel";
import { M3eButton, M3eChip, M3eDialog, M3eIcon, M3eSearchBar } from "@/ui/m3e";
import { DataTable, EditableSwitch } from "@/ui/DataTable";
import { AppBarSlot } from "@/ui/AppBarSlot";

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
  const title = <AppBarSlot slot="title">管理</AppBarSlot>;
  if (!me.isSystemAdmin)
    return (
      <>
        {title}
        <div className="alert">管理画面は校正システム管理者のみ利用できます。</div>
      </>
    );
  return (
    <>
      {title}
      <div className="stack">
        <section>
          <h2 className="section-title">作品ごとの閲覧権限（個人 ACL）</h2>
          <DataTable
            label="作品ごとの閲覧権限"
            rows={works ?? []}
            rowKey={(w) => w.id}
            empty={works === undefined ? "読み込み中…" : "作品がありません"}
            columns={[
              {
                key: "title",
                header: "名称",
                rowHeader: true,
                sort: (a, b) => a.title.localeCompare(b.title, "ja"),
                cell: (w) => (
                  <>
                    {w.title}
                    {w.confidentiality === "restricted" ? (
                      <M3eIcon name="lock" className="ml list__lock" title="非公開" />
                    ) : null}
                  </>
                ),
              },
              {
                key: "state",
                header: "状態",
                width: "140px",
                sort: (a, b) => a.lifecycle.localeCompare(b.lifecycle),
                cell: (w) => (
                  <M3eChip className={w.lifecycle === "finalized" ? "chip--success" : ""}>
                    {lifecycleLabel[w.lifecycle] ?? w.lifecycle}
                  </M3eChip>
                ),
              },
              {
                key: "grants",
                header: "許可",
                numeric: true,
                width: "96px",
                sort: (a, b) => a.activeGrantCount - b.activeGrantCount,
                cell: (w) => `${w.activeGrantCount} 件`,
              },
              {
                key: "acl",
                header: <span className="sr-only">操作</span>,
                width: "160px",
                cell: (w) => (
                  <M3eButton variant="text" onClick={() => setAclFor(w)}>
                    <M3eIcon slot="icon" name="lock_person" />
                    閲覧権限
                  </M3eButton>
                ),
              },
            ]}
          />
        </section>
        <div className="grid-2">
          <section>
            <h2 className="section-title">ユーザー</h2>
            <div className="stack">
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
              <DataTable
                label="ユーザー"
                rows={users ?? []}
                rowKey={(u) => u.id}
                columns={[
                  {
                    key: "name",
                    header: "名前",
                    rowHeader: true,
                    sort: (a, b) => a.name.localeCompare(b.name, "ja"),
                    cell: (u) => (
                      <>
                        {u.name}
                        <div className="small muted">{u.email}</div>
                      </>
                    ),
                  },
                  {
                    key: "admin",
                    header: "システム管理者",
                    width: "152px",
                    cell: (u) => (
                      <EditableSwitch
                        label={`${u.name} をシステム管理者にする`}
                        checked={u.isSystemAdmin}
                        disabled={u.id === me.id}
                        onSave={async (on) => {
                          await toggle.run(u.id, on);
                        }}
                      />
                    ),
                  },
                ]}
              />
            </div>
          </section>
          <section>
            <h2 className="section-title">監査ログ</h2>
            <DataTable
              label="監査ログ"
              rows={audit ?? []}
              rowKey={(e) => e._id}
              columns={[
                {
                  key: "at",
                  header: "時刻",
                  width: "176px",
                  sort: (a, b) => a.at - b.at,
                  cell: (e) => <span className="small">{formatJst(e.at)}</span>,
                },
                {
                  key: "op",
                  header: "操作",
                  sort: (a, b) => a.operation.localeCompare(b.operation),
                  cell: (e) => <span className="mono">{e.operation}</span>,
                },
                {
                  key: "entity",
                  header: "対象",
                  sort: (a, b) => a.entityType.localeCompare(b.entityType),
                  cell: (e) => <span className="small muted">{e.entityType}</span>,
                },
              ]}
            />
          </section>
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
