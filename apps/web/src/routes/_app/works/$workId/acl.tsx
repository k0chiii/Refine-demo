import { api } from "@mf100/convex/api";
import type { Id } from "@mf100/convex/dataModel";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery } from "convex/react";
import { useState } from "react";
import { formatJst } from "@/lib/format";
import { permissionLabel } from "@/lib/labels";
import { useAction } from "@/lib/useAction";
import { Field, Select, TextInput } from "@/ui/Field";
import { M3eButton, M3eIcon } from "@/ui/m3e";

export const Route = createFileRoute("/_app/works/$workId/acl")({ component: Acl });

/** U-08 作品ごとの閲覧許可（Nogiku ユーザー単位）。付与・変更・剥奪と履歴（F-14 / A-19）。 */
function Acl() {
  const { workId } = Route.useParams();
  const me = useQuery(api.me.me, {});
  const work = useQuery(
    api.acl.workSummary,
    me?.isSystemAdmin ? { workId: workId as Id<"works"> } : "skip",
  );
  const grants = useQuery(api.acl.list, { workId });
  const [search, setSearch] = useState("");
  const candidates = useQuery(api.acl.searchUsers, me?.isSystemAdmin ? { text: search } : "skip");
  const grant = useMutation(api.acl.grant);
  const revoke = useMutation(api.acl.revoke);
  const [principalId, setPrincipalId] = useState("");
  const [permission, setPermission] = useState<"view" | "review" | "edit" | "manage">("review");
  const doGrant = useAction(async () => {
    await grant({
      workId: workId as Id<"works">,
      principalType: "user",
      principalId: principalId.trim(),
      permission,
    });
    setPrincipalId("");
  });
  const doRevoke = useAction(async (id: string) => {
    await revoke({ workId: workId as Id<"works">, principalType: "user", principalId: id });
  });

  if (!me || work === undefined || grants === undefined)
    return <p className="muted">読み込み中…</p>;
  if (!me.isSystemAdmin)
    return <div className="alert">閲覧権限の変更は校正システム管理者のみ行えます。</div>;
  const active = grants.filter((g) => g.revokedAt === undefined);

  return (
    <>
      <h1 className="page-title">
        閲覧権限{" "}
        <span className="muted small">
          <Link to="/works/$workId" params={{ workId }}>
            {work?.title ?? "（作品が見つかりません）"}
          </Link>
        </span>
      </h1>
      <div className="alert alert--info">
        MVP では Nogiku ユーザーを個人単位で指定します。Nogiku Access
        のグループ・役職による自動付与は後続機能です（C10 /
        D3）。管理者権限は業務上の校了権限を意味しません。
      </div>
      <div className="grid-2" style={{ marginTop: 16 }}>
        <section className="card">
          <h3>許可を追加</h3>
          <div className="stack">
            <Field label="ユーザーを検索（このシステムに一度でもログインした委員）">
              <TextInput
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="名前・メール"
              />
            </Field>
            {candidates && candidates.length > 0 ? (
              <ul className="small" style={{ margin: 0, paddingLeft: 16 }}>
                {candidates.map((u) => (
                  <li key={u.id}>
                    <button
                      type="button"
                      className="input"
                      style={{ minHeight: 28, padding: "2px 8px" }}
                      onClick={() => setPrincipalId(u.id)}
                    >
                      {u.name} <span className="muted">{u.email}</span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
            <Field label="ユーザーID" required>
              <TextInput value={principalId} onChange={(e) => setPrincipalId(e.target.value)} />
            </Field>
            <Field label="権限レベル">
              <Select value={permission} onChange={(e) => setPermission(e.target.value as "view")}>
                {Object.entries(permissionLabel).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </Select>
            </Field>
            <M3eButton
              variant="filled"
              disabled={!principalId.trim() || doGrant.pending}
              onClick={() => void doGrant.run()}
            >
              <M3eIcon slot="icon" name="person_add" />
              付与
            </M3eButton>
          </div>
        </section>
        <section className="card">
          <h3>有効な許可（{active.length}）</h3>
          {active.length === 0 ? (
            <p className="muted small">個人 ACL はありません（職責による関与者のみ閲覧可）。</p>
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>ユーザー</th>
                  <th>権限</th>
                  <th>付与</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {active.map((g) => (
                  <tr key={`${g.principalId}-${g.grantedAt}`}>
                    <td>
                      {g.principal?.name}
                      <div className="small muted">{g.principal?.email}</div>
                    </td>
                    <td>
                      <span className="chip chip--primary">{permissionLabel[g.permission]}</span>
                    </td>
                    <td className="small">
                      {g.granter?.name}
                      <br />
                      {formatJst(g.grantedAt)}
                    </td>
                    <td>
                      <M3eButton
                        variant="text"
                        disabled={doRevoke.pending}
                        onClick={() => void doRevoke.run(g.principalId)}
                      >
                        剥奪
                      </M3eButton>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </div>
      <h2 style={{ fontSize: 18, marginTop: 24 }}>変更履歴</h2>
      <table className="table">
        <thead>
          <tr>
            <th>ユーザー</th>
            <th>権限</th>
            <th>付与者 / 時刻</th>
            <th>取消者 / 時刻</th>
          </tr>
        </thead>
        <tbody>
          {grants.map((g) => (
            <tr key={`${g.principalId}-${g.grantedAt}-${g.permission}`}>
              <td>{g.principal?.name}</td>
              <td>{permissionLabel[g.permission]}</td>
              <td className="small">
                {g.granter?.name}・{formatJst(g.grantedAt)}
              </td>
              <td className="small">
                {g.revokedAt ? (
                  `${g.revoker?.name}・${formatJst(g.revokedAt)}`
                ) : (
                  <span className="chip chip--ok">有効</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
