import { api } from "@mf100/convex/api";
import type { Id } from "@mf100/convex/dataModel";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery } from "convex/react";
import { useState } from "react";
import { formatJst } from "@/lib/format";
import { lifecycleLabel } from "@/lib/labels";
import { useAction } from "@/lib/useAction";
import { AclPanel } from "@/features/work/AclPanel";
import { downloadWorkCsvTemplate, ImportWorksDialog } from "@/features/work/ImportWorksDialog";
import { ExportStatsDialog } from "@/features/work/ExportStatsDialog";
import { NewWorkDialog } from "@/features/work/NewWorkDialog";
import {
  M3eActionList,
  M3eButton,
  M3eDialog,
  M3eIcon,
  M3eLinearProgressIndicator,
  M3eList,
  M3eListAction,
  M3eListItem,
  M3eSearchBar,
  M3eSwitch,
} from "@/ui/m3e";
import { UserAvatar } from "@/ui/UserAvatar";
import { AppBarSlot } from "@/ui/AppBarSlot";
import { PaneTabs } from "@/ui/PaneTabs";
import { ProfilesAdmin } from "@/features/social/ProfilesAdmin";
import { TeamsAdmin } from "@/features/team/TeamsAdmin";

type Tab = "works" | "teams" | "users" | "sns" | "audit";

export const Route = createFileRoute("/_app/admin")({
  component: Admin,
  validateSearch: (s: Record<string, unknown>): { view?: Tab } =>
    s.view === "teams" || s.view === "users" || s.view === "sns" || s.view === "audit"
      ? { view: s.view }
      : {},
});

/**
 * U-08 管理: 制作物（一括登録・1 件ずつの登録・制作物ごとの閲覧権限の入口）、担当（局 › 担当）、ユーザー（システム管理者の付与）、
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
  const [aclFor, setAclFor] = useState<{ id: string; title: string } | null>(null);
  const [importing, setImporting] = useState(false);
  const [creating, setCreating] = useState(false);
  const [exporting, setExporting] = useState(false);
  const toggle = useAction(async (userId: string, value: boolean) => {
    await setAdmin({ userId: userId as Id<"users">, value });
  });
  if (!me) return null;
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
        items={[
          { id: "works", label: "制作物" },
          { id: "teams", label: "担当" },
          { id: "users", label: "ユーザー" },
          { id: "sns", label: "SNS アカウント" },
          { id: "audit", label: "監査ログ" },
        ]}
      />
      {tab === "works" ? (
        <section className="stack">
          {me.canCreateWorks ? (
            <div className="row admin-works__actions">
              <M3eButton variant="filled" onClick={() => setImporting(true)}>
                <M3eIcon slot="icon" name="upload_file" />
                CSV で一括登録
              </M3eButton>
              <M3eButton variant="outlined" onClick={() => setCreating(true)}>
                <M3eIcon slot="icon" name="note_add" />1 件ずつ登録
              </M3eButton>
              <M3eButton variant="text" onClick={downloadWorkCsvTemplate}>
                <M3eIcon slot="icon" name="download" />
                雛形を書き出す
              </M3eButton>
            </div>
          ) : null}
          <div className="row">
            <M3eButton variant="outlined" onClick={() => setExporting(true)}>
              <M3eIcon slot="icon" name="query_stats" />
              集計を書き出す
            </M3eButton>
          </div>
          <p className="muted small">制作物ごとに、個人へ閲覧・校正・編集・管理の権限を付けます</p>
          {works === undefined ? (
            <M3eLinearProgressIndicator mode="indeterminate" aria-label="制作物を読み込み中" />
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
              <M3eLinearProgressIndicator mode="indeterminate" aria-label="ユーザーを読み込み中" />
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
                        {u.isSystemAdmin ? "・システム管理者" : ""}
                      </span>
                      <M3eSwitch
                        slot="trailing"
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
                    </M3eListItem>
                  ))}
              </M3eList>
            )}
          </div>
        </section>
      ) : tab === "teams" ? (
        <TeamsAdmin />
      ) : tab === "sns" ? (
        <ProfilesAdmin />
      ) : (
        <section className="stack">
          <p className="muted small">直近 100 件の操作</p>
          {/* 記録を読むだけのリスト（M3 Lists: non-interactive）。新しい順で届く */}
          {audit === undefined ? (
            <M3eLinearProgressIndicator mode="indeterminate" aria-label="監査ログを読み込み中" />
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
      {me.canCreateWorks ? (
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
    </>
  );
}
