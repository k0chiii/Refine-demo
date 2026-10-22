import { api } from "@mf100/convex/api";
import type { Id } from "@mf100/convex/dataModel";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery } from "convex/react";
import { useState } from "react";
import { useWindowClass } from "@/lib/useMedia";
import { ActionSheet } from "@/ui/ActionSheet";
import { formatJst } from "@/lib/format";
import { lifecycleLabel } from "@/lib/labels";
import { useAction } from "@/lib/useAction";
import { AclPanel } from "@/features/work/AclPanel";
import { downloadWorkCsvTemplate, ImportWorksDialog } from "@/features/work/ImportWorksDialog";
import { ExportStatsDialog } from "@/features/work/ExportStatsDialog";
import { NewWorkDialog } from "@/features/work/NewWorkDialog";
import { M3eDialog } from "@/ui/LazyDialog";
import { M3eButton } from "@m3e/react/button";
import { M3eIcon } from "@m3e/react/icon";
import { M3eIconButton } from "@m3e/react/icon-button";
import { M3eMenu, M3eMenuItem, M3eMenuTrigger } from "@m3e/react/menu";
import { M3eActionList, M3eList, M3eListAction, M3eListItem } from "@m3e/react/list";
import { M3eSearchBar } from "@m3e/react/search";
import { M3eSwitch } from "@m3e/react/switch";
import { Field, TextInput } from "@/ui/Field";
import { Loading } from "@/ui/Loading";
import { UserAvatar } from "@/ui/UserAvatar";
import { AppBarSlot } from "@/ui/AppBarSlot";
import { PaneTabs } from "@/ui/PaneTabs";
import { ProfilesAdmin } from "@/features/social/ProfilesAdmin";
import { GroupsAdmin } from "@/features/team/GroupsAdmin";
import { TeamsAdmin } from "@/features/team/TeamsAdmin";

type Tab = "works" | "teams" | "groups" | "users" | "sns" | "audit";

export const Route = createFileRoute("/_app/admin")({
  component: Admin,
  validateSearch: (s: Record<string, unknown>): { view?: Tab } =>
    s.view === "teams" ||
    s.view === "groups" ||
    s.view === "users" ||
    s.view === "sns" ||
    s.view === "audit"
      ? { view: s.view }
      : {},
});

/**
 * U-08 管理: 制作物（一括登録・1 件ずつの登録・制作物ごとの閲覧権限の入口）、担当（局 › 担当）、グループ（校正者・メンションでまとめて選ぶ人）、
 * ユーザー（システム管理者の付与）、
 * 監査ログ（F-13）。
 * 制作物の登録は管理者が一括で行う（§36。利用者決定 2026-10-15）ので、制作物のタブに CSV の一括登録を置く。
 * 1 画面に詰め込まず、M3E tabs で切り替える（選んだタブは URL の view に残す）。
 */
function Admin() {
  const me = useQuery(api.me.me, {});
  const { view: tab = "works" } = Route.useSearch();
  const navigate = useNavigate();
  const setTab = (t: Tab) =>
    void navigate({ to: "/admin", search: t === "works" ? {} : { view: t }, replace: true });
  const [text, setText] = useState("");
  const users = useQuery(
    api.acl.searchUsers,
    me?.isSystemAdmin && tab === "users" ? { text } : "skip",
  );
  const audit = useQuery(
    api.admin.auditLog,
    me?.isSystemAdmin && tab === "audit" ? { limit: 100 } : "skip",
  );
  const works = useQuery(api.acl.adminWorks, me?.isSystemAdmin && tab === "works" ? {} : "skip");
  const setAdmin = useMutation(api.admin.setSystemAdmin);
  const setGeneration = useMutation(api.admin.setGeneration);
  // 代（Notion のユーザ DB「代」）を付ける小さなダイアログ
  const [genFor, setGenFor] = useState<{ id: string; name: string; value: string } | null>(null);
  const saveGeneration = useAction(async () => {
    if (!genFor) return;
    const n = genFor.value.trim() === "" ? null : Number(genFor.value.normalize("NFKC"));
    await setGeneration({ userId: genFor.id as Id<"users">, generation: n });
    setGenFor(null);
  });
  const [aclFor, setAclFor] = useState<{ id: string; title: string } | null>(null);
  const [importing, setImporting] = useState(false);
  const [creating, setCreating] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [moreSheet, setMoreSheet] = useState(false);
  const compact = useWindowClass() === "compact";
  const toggle = useAction(async (userId: string, value: boolean) => {
    await setAdmin({ userId: userId as Id<"users">, value });
  });
  if (!me) return null;
  const exportActions = [
    ...(me.canCreateWorks && me.canAssignApprovers
      ? [{ icon: "download", label: "雛形を書き出す", onSelect: downloadWorkCsvTemplate }]
      : []),
    { icon: "query_stats", label: "集計を書き出す", onSelect: () => setExporting(true) },
  ];
  // 登録は works:create に加えて、校了者を決める権限（approvers:assign）も要る
  const canRegister = me.canCreateWorks && me.canAssignApprovers;
  const title = <AppBarSlot slot="title">管理</AppBarSlot>;
  if (!me.isSystemAdmin)
    return (
      <>
        {title}
        <div className="alert">管理画面はシステム管理者だけが使えます</div>
      </>
    );
  return (
    <>
      {title}
      <PaneTabs
        label="管理"
        className="page-tabs"
        value={tab}
        onChange={setTab}
        scroll={compact}
        items={[
          { id: "works", label: "制作物" },
          { id: "teams", label: "担当" },
          { id: "groups", label: "グループ" },
          { id: "users", label: "ユーザー" },
          { id: "sns", label: "SNS アカウント" },
          { id: "audit", label: "監査ログ" },
        ]}
      />
      {tab === "works" ? (
        <section className="stack">
          {/* 主は 1 つ（塗り）、副は 1 つ（tonal）、書き出し 2 つは more_vert にまとめる（1 行。compact の操作はボトムシート） */}
          <div className="row admin-works__actions">
            {canRegister ? (
              <>
                <M3eButton variant="filled" onClick={() => setImporting(true)}>
                  <M3eIcon slot="icon" name="upload_file" />
                  CSV で一括登録
                </M3eButton>
                <M3eButton variant="tonal" onClick={() => setCreating(true)}>
                  <M3eIcon slot="icon" name="note_add" />1 件ずつ登録
                </M3eButton>
              </>
            ) : null}
            <M3eIconButton
              aria-label="書き出し"
              title="書き出し"
              {...(compact ? { onClick: () => setMoreSheet(true) } : {})}
            >
              <M3eIcon name="more_vert" />
              {compact ? null : <M3eMenuTrigger htmlFor="admin-works-more" />}
            </M3eIconButton>
            {compact ? (
              <ActionSheet
                open={moreSheet}
                onClose={() => setMoreSheet(false)}
                title="書き出し"
                items={exportActions}
              />
            ) : (
              <M3eMenu id="admin-works-more">
                {exportActions.map((a) => (
                  <M3eMenuItem key={a.label} onClick={a.onSelect}>
                    <M3eIcon slot="icon" name={a.icon} />
                    {a.label}
                  </M3eMenuItem>
                ))}
              </M3eMenu>
            )}
          </div>
          <p className="admin__lead">
            制作物ごとに、個人へ閲覧・校正・編集・管理の権限を付けます。通常の制作物は委員なら誰でも見られるので、閲覧の権限が要るのは非公開・取扱注意の制作物だけです（関係者と担当の所属する人には自動で付きます）
          </p>
          {works === undefined ? (
            <Loading label="制作物を読み込んでいます" />
          ) : works.length === 0 ? (
            <div className="empty">制作物がありません</div>
          ) : (
            <M3eActionList className="list" aria-label="制作物ごとの閲覧権限">
              {[...works]
                .sort((a, b) => a.title.localeCompare(b.title, "ja"))
                .map((w) => (
                  <M3eListAction
                    key={w.id}
                    className={`list__item ${w.lifecycle === "finalized" || w.lifecycle === "cancelled" ? "list__item--done" : ""}`}
                    onClick={() => setAclFor(w)}
                  >
                    <M3eIcon slot="leading" name="lock_person" />
                    <span className="list__headline">
                      {w.title}
                      {w.confidentiality === "restricted" ? (
                        <M3eIcon
                          name="lock"
                          className="ml list__lock"
                          role="img"
                          aria-label="非公開"
                          title="非公開"
                        />
                      ) : null}
                    </span>
                    <span slot="supporting-text">{lifecycleLabel[w.lifecycle] ?? w.lifecycle}</span>
                    <span slot="trailing" className="meta num">
                      個人の許可 {w.activeGrantCount}
                    </span>
                  </M3eListAction>
                ))}
            </M3eActionList>
          )}
        </section>
      ) : tab === "users" ? (
        <section>
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
            {/* 行の末尾のスイッチはその場で効く（M3 Switch: 保存の操作なしで切り替わる設定） */}
            {users === undefined ? (
              <Loading label="ユーザーを読み込んでいます" />
            ) : users.length === 0 ? (
              <div className="empty">一致するユーザーはいません</div>
            ) : (
              <M3eList className="list" aria-label="ユーザー">
                {[...users]
                  .sort((a, b) => a.name.localeCompare(b.name, "ja"))
                  .map((u) => (
                    <M3eListItem key={u.id} className="list__item">
                      <span slot="leading">
                        <UserAvatar seed={u.email ?? u.id} userId={u.id} size={40} />
                      </span>
                      <span className="list__headline">{u.name}</span>
                      <span slot="supporting-text">
                        {u.email}
                        {u.generation ? `・${u.generation} 代` : ""}
                        {u.isSystemAdmin ? "・システム管理者" : ""}
                      </span>
                      <span slot="trailing" className="row">
                        <M3eIconButton
                          aria-label={`${u.name} の代を設定`}
                          onClick={() =>
                            setGenFor({
                              id: u.id,
                              name: u.name,
                              value: u.generation ? String(u.generation) : "",
                            })
                          }
                        >
                          <M3eIcon name="badge" />
                        </M3eIconButton>
                        <span className="admin__switch-label" aria-hidden="true">
                          管理者
                        </span>
                        <M3eSwitch
                          checked={u.isSystemAdmin}
                          disabled={u.id === me.id || toggle.pending}
                          aria-label={`${u.name} をシステム管理者にする`}
                          onChange={(e: Event) =>
                            void toggle.run(
                              u.id,
                              (e.target as HTMLInputElement & { checked: boolean }).checked,
                            )
                          }
                        />
                      </span>
                    </M3eListItem>
                  ))}
              </M3eList>
            )}
          </div>
        </section>
      ) : tab === "teams" ? (
        <TeamsAdmin />
      ) : tab === "groups" ? (
        <GroupsAdmin />
      ) : tab === "sns" ? (
        <ProfilesAdmin />
      ) : (
        <section className="stack">
          <p className="admin__lead">直近 100 件の操作</p>
          {/* 記録を読むだけのリスト（M3 Lists: non-interactive）。新しい順で届く */}
          {audit === undefined ? (
            <Loading label="監査ログを読み込んでいます" />
          ) : audit.length === 0 ? (
            <div className="empty">操作の記録はありません</div>
          ) : (
            <M3eList className="list" aria-label="監査ログ">
              {audit.map((e) => (
                <M3eListItem key={e._id} className="list__item">
                  <span className="list__headline mono">{e.operation}</span>
                  <span slot="supporting-text">{e.entityType}</span>
                  <span slot="trailing" className="meta num">
                    {formatJst(e.at)}
                  </span>
                </M3eListItem>
              ))}
            </M3eList>
          )}
        </section>
      )}
      {canRegister ? (
        <>
          <ImportWorksDialog
            open={importing}
            onClose={() => setImporting(false)}
            existingLegacyIds={(works ?? []).flatMap((w) => (w.legacyId ? [w.legacyId] : []))}
          />
          <NewWorkDialog open={creating} onClose={() => setCreating(false)} />
        </>
      ) : null}
      <ExportStatsDialog open={exporting} onClose={() => setExporting(false)} />
      <M3eDialog open={aclFor !== null} onClosed={() => setAclFor(null)} closeLabel="閉じる">
        <span slot="header">閲覧権限: {aclFor?.title}</span>
        <div className="dialog-body">{aclFor ? <AclPanel workId={aclFor.id} /> : null}</div>
        <div slot="actions" className="row">
          <M3eButton variant="text" onClick={() => setAclFor(null)}>
            閉じる
          </M3eButton>
        </div>
      </M3eDialog>
      {/* 代（Notion のユーザ DB「代」）。認証には触れず、管理者が付ける（docs/NOTION_ALIGNMENT.md） */}
      <M3eDialog open={genFor !== null} onClosed={() => setGenFor(null)} closeLabel="閉じる">
        <span slot="header">{genFor?.name} の代</span>
        <div className="dialog-body">
          <Field label="代" hint="例: 100。空にすると消します">
            <TextInput
              type="number"
              min={1}
              max={999}
              inputMode="numeric"
              value={genFor?.value ?? ""}
              onChange={(e) => setGenFor((g) => (g ? { ...g, value: e.target.value } : g))}
            />
          </Field>
        </div>
        <div slot="actions" className="row">
          <M3eButton variant="text" onClick={() => setGenFor(null)}>
            キャンセル
          </M3eButton>
          <M3eButton
            variant="filled"
            disabled={saveGeneration.pending}
            onClick={() => void saveGeneration.run()}
          >
            保存
          </M3eButton>
        </div>
      </M3eDialog>
    </>
  );
}
