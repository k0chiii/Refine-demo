import { api } from "@mf100/convex/api";
import type { Id } from "@mf100/convex/dataModel";
import { useMutation, useQuery } from "convex/react";
import { useState } from "react";
import { formatJstShort } from "@/lib/format";
import { permissionLabel } from "@/lib/labels";
import { useAction } from "@/lib/useAction";
import { Field, Select } from "@/ui/Field";
import { M3eButton } from "@/ui/m3e";
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
        <ul className="acl__list">
          {active.map((g) => (
            <li key={`${g.principalId}-${g.grantedAt}`}>
              <span>
                {g.principal?.name}
                <span className="muted">　{permissionLabel[g.permission]}</span>
              </span>
              <span className="spacer" />
              <M3eButton
                variant="text"
                disabled={doRevoke.pending}
                onClick={() => void doRevoke.run(g.principalId)}
              >
                剥奪
              </M3eButton>
            </li>
          ))}
        </ul>
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
        <details
          className="details"
          open={history}
          onToggle={(e) => setHistory(e.currentTarget.open)}
        >
          <summary>変更履歴</summary>
          <ul className="acl__list small">
            {grants.map((g) => (
              <li key={`${g.principalId}-${g.grantedAt}-${g.permission}`}>
                <span>
                  {g.principal?.name}・{permissionLabel[g.permission]}・{g.granter?.name}{" "}
                  {formatJstShort(g.grantedAt)}
                  {g.revokedAt ? `・剥奪 ${g.revoker?.name} ${formatJstShort(g.revokedAt)}` : ""}
                </span>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}
