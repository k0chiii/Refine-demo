import { api } from "@mf100/convex/api";
import type { Id } from "@mf100/convex/dataModel";
import { useMutation, useQuery } from "convex/react";
import { useState } from "react";
import { formatJstShort } from "@/lib/format";
import { permissionLabel } from "@/lib/labels";
import { useAction } from "@/lib/useAction";
import { Field, Select } from "@/ui/Field";
import { Loading } from "@/ui/Loading";
import { M3eButton } from "@m3e/react/button";
import { M3eDivider } from "@m3e/react/divider";
import { M3eExpansionPanel } from "@m3e/react/expansion-panel";
import { M3eIcon } from "@m3e/react/icon";
import { M3eIconButton } from "@m3e/react/icon-button";
import { M3eList, M3eListItem } from "@m3e/react/list";
import {
  M3eMenu,
  M3eMenuItem,
  M3eMenuItemGroup,
  M3eMenuItemRadio,
  M3eMenuTrigger,
} from "@m3e/react/menu";
import { UserAvatar } from "@/ui/UserAvatar";
import { UserPicker } from "@/ui/UserPicker";

/**
 * U-08 作品ごとの閲覧許可（Nogiku ユーザー単位）。エディタの「情報」に置く。追加・外すと履歴（F-14 / A-19）。
 * 許可は M3 のリスト（アバター・名前・権限）。権限の変更と外すのは行の末尾の ⋮ のメニュー（M3 Menus: 1 つを選ぶ項目と操作）。
 * 変更履歴は読むだけのリスト（M3 に表は無い。§49）。
 * readOnly は管理者以外（主管・校了者。サーバーの audit.view）に有効な許可の一覧だけを見せる。付与・変更・外すは出さない。
 */
export function AclPanel({ workId, readOnly = false }: { workId: string; readOnly?: boolean }) {
  const grants = useQuery(api.acl.list, { workId });
  const grant = useMutation(api.acl.grant);
  const revoke = useMutation(api.acl.revoke);
  const [userIds, setUserIds] = useState<string[]>([]);
  const [permission, setPermission] = useState<"review" | "edit" | "manage">("review");
  const [history, setHistory] = useState(false);
  const doGrant = useAction(async () => {
    if (userIds.length === 0) return;
    await grant({
      workId: workId as Id<"works">,
      userIds: userIds as Id<"users">[],
      permission,
    });
    setUserIds([]);
  });
  const doRevoke = useAction(async (id: string) => {
    await revoke({ workId: workId as Id<"works">, userId: id as Id<"users"> });
  });
  const change = useAction(async (id: string, p: "review" | "edit" | "manage") => {
    await grant({
      workId: workId as Id<"works">,
      userIds: [id as Id<"users">],
      permission: p,
    });
  });
  if (grants === undefined) return <Loading size="small" label="権限を読み込んでいます" />;
  const active = grants.filter((g) => g.revokedAt === undefined);
  return (
    <div className="acl">
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
                  {readOnly ? null : (
                    <M3eIconButton slot="trailing" aria-label={`${name} の権限を変える・外す`}>
                      <M3eIcon name="more_vert" />
                      <M3eMenuTrigger htmlFor={menuId} />
                    </M3eIconButton>
                  )}
                  {readOnly ? null : (
                    <M3eMenu id={menuId} positionX="before">
                      <M3eMenuItemGroup aria-label="権限">
                        {(["review", "edit", "manage"] as const).map((v) => (
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
                  )}
                </M3eListItem>
              );
            })}
        </M3eList>
      )}
      {readOnly ? null : (
        <div className="acl__add">
          <UserPicker
            label="ユーザーを追加"
            groups
            value={userIds}
            onChange={setUserIds}
            exclude={active.map((g) => g.principalId)}
          />
          <Field label="権限">
            <Select
              value={permission}
              onChange={(e) => setPermission(e.target.value as "review" | "edit" | "manage")}
            >
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
              disabled={userIds.length === 0 || doGrant.pending}
              onClick={() => void doGrant.run()}
            >
              追加
            </M3eButton>
          </div>
        </div>
      )}
      {!readOnly && (grants.length > active.length || history) ? (
        <M3eExpansionPanel
          className="expansion"
          open={history}
          onOpened={() => setHistory(true)}
          onClosed={() => setHistory(false)}
        >
          <span slot="header">変更履歴</span>
          <M3eList className="list" aria-label="権限の変更履歴">
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
