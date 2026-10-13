import { api } from "@mf100/convex/api";
import type { Id } from "@mf100/convex/dataModel";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery } from "convex/react";
import { useState } from "react";
import { formatJst } from "@/lib/format";
import { permissionLabel } from "@/lib/labels";
import { useAction } from "@/lib/useAction";
import { Card } from "@/ui/Card";
import { StatusText } from "@/ui/Chip";
import { Field, Select } from "@/ui/Field";
import { M3eButton } from "@/ui/m3e";
import { PageHeader } from "@/ui/PageHeader";
import { UserPicker } from "@/ui/UserPicker";

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
  const grant = useMutation(api.acl.grant);
  const revoke = useMutation(api.acl.revoke);
  const [principal, setPrincipal] = useState<string[]>([]);
  const [permission, setPermission] = useState<"view" | "review" | "edit" | "manage">("review");
  const doGrant = useAction(async () => {
    if (!principal[0]) return;
    await grant({
      workId: workId as Id<"works">,
      principalType: "user",
      principalId: principal[0],
      permission,
    });
    setPrincipal([]);
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
      <PageHeader
        title="閲覧権限"
        meta={
          <Link to="/works/$workId" params={{ workId }}>
            {work?.title ?? "（作品が見つかりません）"}
          </Link>
        }
      />
      <div className="grid-2">
        <Card title="許可を追加">
          <UserPicker
            label="ユーザー"
            single
            value={principal}
            onChange={setPrincipal}
            exclude={active.map((g) => g.principalId)}
          />
          <Field label="権限レベル">
            <Select value={permission} onChange={(e) => setPermission(e.target.value as "view")}>
              {Object.entries(permissionLabel).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </Select>
          </Field>
          <div className="row">
            <span className="spacer" />
            <M3eButton
              variant="filled"
              disabled={principal.length === 0 || doGrant.pending}
              onClick={() => void doGrant.run()}
            >
              付与
            </M3eButton>
          </div>
        </Card>
        <Card title={`有効な許可（${active.length}）`}>
          {active.length === 0 ? (
            <p className="muted small" style={{ margin: 0 }}>
              個人の許可はありません。
            </p>
          ) : (
            <div className="table-wrap" tabIndex={0}>
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
                      <td>{permissionLabel[g.permission]}</td>
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
            </div>
          )}
        </Card>
      </div>
      <h2 className="section-title">変更履歴</h2>
      <div className="table-wrap" tabIndex={0}>
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
                    <StatusText tone="success">有効</StatusText>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
