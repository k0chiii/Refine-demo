import { api } from "@mf100/convex/api";
import type { Id } from "@mf100/convex/dataModel";
import { useMutation, useQuery } from "convex/react";
import { useState } from "react";
import { formatJstShort } from "@/lib/format";
import { permissionLabel } from "@/lib/labels";
import { useAction } from "@/lib/useAction";
import { describeError } from "@/lib/errors";
import { DataTable, EditableSelect } from "@/ui/DataTable";
import { Field, Select } from "@/ui/Field";
import { M3eButton, M3eExpansionPanel } from "@/ui/m3e";
import { UserPicker } from "@/ui/UserPicker";

/** U-08 作品ごとの閲覧許可（Nogiku ユーザー単位）。エディタの「情報」に置く。付与・剥奪と履歴（F-14 / A-19）。 */
export function AclPanel({ workId }: { workId: string }) {
  const grants = useQuery(api.acl.list, { workId });
  const grant = useMutation(api.acl.grant);
  const revoke = useMutation(api.acl.revoke);
  const [principal, setPrincipal] = useState<string[]>([]);
  const [permission, setPermission] = useState<"view" | "review" | "edit" | "manage">("review");
  const [history, setHistory] = useState(false);
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
  if (grants === undefined) return <p className="muted small">読み込み中…</p>;
  const active = grants.filter((g) => g.revokedAt === undefined);
  return (
    <div className="acl">
      {active.length === 0 ? (
        <p className="muted small">個人の許可はありません。</p>
      ) : (
        <DataTable
          label="個人の許可"
          rows={active}
          rowKey={(g) => g.principalId}
          columns={[
            {
              key: "who",
              header: "ユーザー",
              rowHeader: true,
              sort: (a, b) =>
                (a.principal?.name ?? "").localeCompare(b.principal?.name ?? "", "ja"),
              cell: (g) => g.principal?.name,
            },
            {
              key: "perm",
              header: "権限",
              width: "160px",
              cell: (g) => (
                <EditableSelect
                  label={`${g.principal?.name ?? ""} の権限`}
                  value={g.permission}
                  options={(["view", "review", "edit", "manage"] as const).map((v) => ({
                    value: v,
                    label: permissionLabel[v] ?? v,
                  }))}
                  onSave={async (v) => {
                    try {
                      await grant({
                        workId: workId as Id<"works">,
                        principalType: "user",
                        principalId: g.principalId,
                        permission: v as "view",
                      });
                    } catch (e) {
                      throw new Error(describeError(e).message);
                    }
                  }}
                />
              ),
            },
            {
              key: "revoke",
              header: <span className="sr-only">操作</span>,
              width: "96px",
              cell: (g) => (
                <M3eButton
                  variant="text"
                  disabled={doRevoke.pending}
                  onClick={() => void doRevoke.run(g.principalId)}
                >
                  剥奪
                </M3eButton>
              ),
            },
          ]}
        />
      )}
      <div className="acl__add">
        <UserPicker
          label="ユーザーを追加"
          single
          value={principal}
          onChange={setPrincipal}
          exclude={active.map((g) => g.principalId)}
        />
        <Field label="権限">
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
            variant="tonal"
            disabled={principal.length === 0 || doGrant.pending}
            onClick={() => void doGrant.run()}
          >
            付与
          </M3eButton>
        </div>
      </div>
      {grants.length > active.length || history ? (
        <M3eExpansionPanel
          className="expansion"
          open={history}
          onOpened={() => setHistory(true)}
          onClosed={() => setHistory(false)}
        >
          <span slot="header">変更履歴</span>
          <DataTable
            label="閲覧権限の変更履歴"
            rows={grants}
            rowKey={(g) => `${g.principalId}-${g.grantedAt}-${g.permission}`}
            columns={[
              { key: "who", header: "ユーザー", rowHeader: true, cell: (g) => g.principal?.name },
              { key: "perm", header: "権限", cell: (g) => permissionLabel[g.permission] },
              {
                key: "granted",
                header: "付与",
                sort: (a, b) => a.grantedAt - b.grantedAt,
                cell: (g) => (
                  <span className="small">
                    {g.granter?.name} {formatJstShort(g.grantedAt)}
                  </span>
                ),
              },
              {
                key: "revoked",
                header: "剥奪",
                cell: (g) =>
                  g.revokedAt ? (
                    <span className="small">
                      {g.revoker?.name} {formatJstShort(g.revokedAt)}
                    </span>
                  ) : (
                    "—"
                  ),
              },
            ]}
          />
        </M3eExpansionPanel>
      ) : null}
    </div>
  );
}
