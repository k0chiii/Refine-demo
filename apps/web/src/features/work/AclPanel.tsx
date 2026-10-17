import { api } from "@mf100/convex/api";
import type { Id } from "@mf100/convex/dataModel";
import { useMutation, useQuery } from "convex/react";
import { useState } from "react";
import { formatJstShort } from "@/lib/format";
import { permissionLabel } from "@/lib/labels";
import { useAction } from "@/lib/useAction";
import { Field, Select } from "@/ui/Field";
import { Loading } from "@/ui/Loading";
import {
  M3eButton,
  M3eDivider,
  M3eExpansionPanel,
  M3eIcon,
  M3eIconButton,
  M3eList,
  M3eListItem,
  M3eMenu,
  M3eMenuItem,
  M3eMenuItemGroup,
  M3eMenuItemRadio,
  M3eMenuTrigger,
} from "@/ui/m3e";
import { UserAvatar } from "@/ui/UserAvatar";
import { UserPicker } from "@/ui/UserPicker";

/**
 * U-08 作品ごとの閲覧許可（Nogiku ユーザー単位）。エディタの「情報」に置く。追加・外すと履歴（F-14 / A-19）。
 * 許可は M3 のリスト（アバター・名前・権限）。権限の変更と外すのは行の末尾の ⋮ のメニュー（M3 Menus: 1 つを選ぶ項目と操作）。
 * 変更履歴は読むだけのリスト（M3 に表は無い。§49）。
 */
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
  const change = useAction(async (id: string, p: "view" | "review" | "edit" | "manage") => {
    await grant({
      workId: workId as Id<"works">,
      principalType: "user",
      principalId: id,
      permission: p,
    });
  });
  if (grants === undefined) return <Loading size="small" label="閲覧権限を読み込んでいます" />;
  const active = grants.filter((g) => g.revokedAt === undefined);
  return (
    <div className="acl">
      <p className="muted small">
        通常の制作物は委員なら誰でも見られます。ここで付けるのは、非公開・取扱注意の制作物を見られる人（関係者と担当の所属する人には自動で付きます）と、校正・編集・管理の権限です
      </p>
      {active.length === 0 ? (
        <p className="muted small">個人の許可はありません</p>
      ) : (
        <M3eList className="list" aria-label="個人の許可">
          {[...active]
            .sort((a, b) => (a.principal?.name ?? "").localeCompare(b.principal?.name ?? "", "ja"))
            .map((g) => {
              const name = g.principal?.name ?? g.principalId;
              const menuId = `acl-menu-${g.principalId}`;
              return (
                <M3eListItem key={g.principalId} className="list__item">
                  <span slot="leading">
                    <UserAvatar
                      seed={g.principal?.email ?? g.principalId}
                      userId={g.principalId}
                      size={40}
                    />
                  </span>
                  <span className="list__headline">{name}</span>
                  <span slot="supporting-text">
                    {permissionLabel[g.permission] ?? g.permission}
                  </span>
                  <M3eIconButton slot="trailing" aria-label={`${name} の権限を変える・外す`}>
                    <M3eIcon name="more_vert" />
                    <M3eMenuTrigger htmlFor={menuId} />
                  </M3eIconButton>
                  <M3eMenu id={menuId} positionX="before">
                    <M3eMenuItemGroup aria-label="権限">
                      {(["view", "review", "edit", "manage"] as const).map((v) => (
                        <M3eMenuItemRadio
                          key={v}
                          checked={g.permission === v}
                          onClick={() => void change.run(g.principalId, v)}
                        >
                          {permissionLabel[v] ?? v}
                        </M3eMenuItemRadio>
                      ))}
                    </M3eMenuItemGroup>
                    <M3eDivider />
                    <M3eMenuItem onClick={() => void doRevoke.run(g.principalId)}>
                      <M3eIcon slot="icon" name="person_remove" />
                      外す
                    </M3eMenuItem>
                  </M3eMenu>
                </M3eListItem>
              );
            })}
        </M3eList>
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
            追加
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
          <M3eList className="list" aria-label="閲覧権限の変更履歴">
            {[...grants]
              .sort((a, b) => b.grantedAt - a.grantedAt)
              .map((g) => (
                <M3eListItem
                  key={`${g.principalId}-${g.grantedAt}-${g.permission}`}
                  className={`list__item ${g.revokedAt ? "list__item--done" : ""}`}
                >
                  <span className="list__headline">
                    {g.principal?.name}・{permissionLabel[g.permission]}
                  </span>
                  <span slot="supporting-text">
                    追加 {g.granter?.name} {formatJstShort(g.grantedAt)}
                    {g.revokedAt
                      ? `・外した ${g.revoker?.name ?? ""} ${formatJstShort(g.revokedAt)}`
                      : ""}
                  </span>
                </M3eListItem>
              ))}
          </M3eList>
        </M3eExpansionPanel>
      ) : null}
    </div>
  );
}
