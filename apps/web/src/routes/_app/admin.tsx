import { api } from "@mf100/convex/api";
import type { Id } from "@mf100/convex/dataModel";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery } from "convex/react";
import { useState } from "react";
import { formatJst } from "@/lib/format";
import { useAction } from "@/lib/useAction";
import { TextInput } from "@/ui/Field";
import { M3eButton } from "@/ui/m3e";

export const Route = createFileRoute("/_app/admin")({ component: Admin });

/** U-08 管理: ユーザー（システム管理者の付与）と監査ログ（F-13）。 */
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
    return <div className="alert">管理画面は校正システム管理者のみ利用できます。</div>;
  return (
    <>
      <h1 className="page-title">管理</h1>
      <section className="card" style={{ marginBottom: 16 }}>
        <h3>作品ごとの閲覧権限（個人 ACL）</h3>
        <p className="small muted" style={{ margin: "0 0 8px" }}>
          管理者は閲覧者を調整できますが、作品の内容を当然には閲覧できません（§7.2）。ここでは名称・区分・状態のみ表示します。
        </p>
        <table className="table">
          <thead>
            <tr>
              <th>名称</th>
              <th>旧ID</th>
              <th>区分</th>
              <th>状態</th>
              <th>有効な許可</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {(works ?? []).map((w) => (
              <tr key={w.id}>
                <td>
                  {w.title}
                  {w.confidentiality === "restricted" ? (
                    <span className="chip chip--error" style={{ marginLeft: 6 }}>
                      非公開
                    </span>
                  ) : null}
                </td>
                <td className="small muted">{w.legacyId ?? "—"}</td>
                <td>{w.category}</td>
                <td>{w.lifecycle}</td>
                <td>{w.activeGrantCount} 件</td>
                <td>
                  <Link to="/works/$workId/acl" params={{ workId: w.id }}>
                    閲覧権限を編集
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      <div className="grid-2">
        <section className="card">
          <h3>ユーザー（ログイン済みの Nogiku 委員）</h3>
          <TextInput
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="名前・メールで検索"
            aria-label="ユーザー検索"
          />
          <table className="table" style={{ marginTop: 8 }}>
            <thead>
              <tr>
                <th>名前</th>
                <th>ユーザーID</th>
                <th>管理者</th>
              </tr>
            </thead>
            <tbody>
              {(users ?? []).map((u) => (
                <tr key={u.id}>
                  <td>
                    {u.name}
                    <div className="small muted">{u.email}</div>
                  </td>
                  <td className="small">
                    <code>{u.id}</code>
                  </td>
                  <td>
                    <M3eButton
                      variant="text"
                      disabled={toggle.pending}
                      onClick={() => void toggle.run(u.id, !u.isSystemAdmin)}
                    >
                      {u.isSystemAdmin ? "管理者を解除" : "管理者にする"}
                    </M3eButton>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
        <section className="card">
          <h3>監査ログ（最新 100 件）</h3>
          <table className="table">
            <thead>
              <tr>
                <th>時刻（JST）</th>
                <th>対象</th>
                <th>操作</th>
                <th>実行者</th>
              </tr>
            </thead>
            <tbody>
              {(audit ?? []).map((e) => (
                <tr key={e._id}>
                  <td className="small">{formatJst(e.at)}</td>
                  <td className="small">
                    {e.entityType}
                    <br />
                    <code>{e.entityId}</code>
                  </td>
                  <td>{e.operation}</td>
                  <td className="small">
                    <code>{e.actorId}</code>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </div>
    </>
  );
}
