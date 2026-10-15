import { useAuthActions } from "@convex-dev/auth/react";
import { api } from "@mf100/convex/api";
import { createFileRoute, Outlet, useNavigate, useRouterState } from "@tanstack/react-router";
import { useConvexAuth, useQuery } from "convex/react";
import { useEffect, useState } from "react";
import { NotificationsBell } from "@/features/notifications/NotificationsBell";
import { useInstallPrompt } from "@/lib/pwa";
import { useWindowClass } from "@/lib/useMedia";
import {
  M3eAppBar,
  M3eFab,
  M3eIcon,
  M3eIconButton,
  M3eMenu,
  M3eMenuItem,
  M3eMenuTrigger,
  M3eNavBar,
  M3eNavItem,
  M3eNavRail,
} from "@/ui/m3e";
import { ActionSheet } from "@/ui/ActionSheet";
import { UserAvatar } from "@/ui/UserAvatar";

export const Route = createFileRoute("/_app")({ component: AppLayout });

const RAIL_KEY = "mf100.rail.expanded";
const readRailPref = () => {
  try {
    return localStorage.getItem(RAIL_KEY) === "1";
  } catch {
    return false;
  }
};

/**
 * 認証ガード＋共通レイアウト。M3 のウィンドウサイズクラスで骨格を切り替える（Layout › Window size classes）。
 * - compact（<600）: アプリバーは見出し・通知・アカウント。下部ナビゲーションバー（ダッシュボード・制作物・表記ルール（・管理））。
 *   エディタ（`/works/:id`）では下部バーを隠す（詳細画面）。アプリバーはどの幅でも 1 本で、エディタが戻る・題名・操作を差し込む。
 * - medium（600–839）/ expanded（840–1199）: 折りたたみレール（96）。メニューを押すと**モーダル**の展開レールが重なる（スクリム、Esc で閉じる）。
 * - large（1200 以上）: メニューで**標準**の展開レール（220）に広がり内容を押す。状態は保存。既定は折りたたみ。
 * レールの中身は M3 の解剖図どおり: 上にメニュー、次に FAB「制作物を登録」、その下に行き先。アカウントは右上に残す。
 * 通知は独立した画面を持たず、アカウントの隣のベルのパネル（compact はボトムシート）から対象へ飛ぶ。
 */
function AppLayout() {
  const { isAuthenticated, isLoading } = useConvexAuth();
  const me = useQuery(api.me.me, isAuthenticated ? {} : "skip");
  const navigate = useNavigate();
  const install = useInstallPrompt();
  const { signOut } = useAuthActions();
  const path = useRouterState({ select: (s) => s.location.pathname });
  const cls = useWindowClass();
  const [railPref, setRailPref] = useState(readRailPref);
  const [modalOpen, setModalOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  /** large の下の階層で、一時的にレールを広げたか（画面を移ると折りたたみに戻る） */
  const [subOpen, setSubOpen] = useState(false);
  const [accountSheet, setAccountSheet] = useState(false);

  useEffect(() => {
    if (isLoading) return;
    if (!isAuthenticated || me === null) void navigate({ to: "/signin", replace: true });
  }, [isLoading, isAuthenticated, me, navigate]);

  // モーダルの展開レールは、行き先を選んだ時・幅が変わった時・Esc で閉じる
  useEffect(() => {
    setModalOpen(false);
    setNotifOpen(false);
    setSubOpen(false);
  }, [path, cls]);
  useEffect(() => {
    if (!modalOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setModalOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [modalOpen]);

  if (isLoading || !isAuthenticated || !me) return null;

  const items = [
    { to: "/", icon: "space_dashboard", label: "ダッシュボード", short: "ホーム" },
    { to: "/works", icon: "folder", label: "制作物" },
    { to: "/write", icon: "edit_document", label: "エディタ" },
    { to: "/notation", icon: "spellcheck", label: "表記ルール" },
    ...(me.isSystemAdmin ? [{ to: "/admin", icon: "admin_panel_settings", label: "管理" }] : []),
  ];
  // 文章・投稿のエディタ（/works/:id/write・/post）を開いているあいだは「エディタ」を選択中にする
  const writing = /^\/works\/[^/]+\/(write|post)$/.test(path);
  const selected = (to: string) =>
    to === "/"
      ? path === "/"
      : to === "/write"
        ? path === "/write" || writing
        : to === "/works"
          ? !writing && (path === to || path.startsWith(`${to}/`))
          : path === to || path.startsWith(`${to}/`);
  // 下部ナビ（compact）は 1 項目 75px 前後しかなく「ダッシュボード」が 2 行に折れて下に切れるので、短い名前を出す
  // 項目は M3eNavItem だけ（ボタン）にし、押したらルーターで移る。外側に <a> を重ねると 1 項目に 2 回止まり、
  // 読み上げも「リンク › ボタン」と入れ子になる。M3eNavItem の href は中に <a> を作り、同じく入れ子になる（§35 A-10）
  const navItems = (list: typeof items = items, short = false) =>
    list.map((it) => (
      <M3eNavItem
        key={it.to}
        selected={selected(it.to)}
        data-to={it.to}
        aria-label={it.label}
        title={it.label}
        onClick={() => void navigate({ to: it.to })}
      >
        <M3eIcon slot="icon" name={it.icon} className={selected(it.to) ? "icon--filled" : ""} />
        <span className="nav-label">{short && "short" in it ? it.short : it.label}</span>
      </M3eNavItem>
    ));
  /** M3E は押した項目を自動で選択状態にするため、経路に基づく選択へ戻す */
  const resync = (e: { currentTarget: EventTarget | null }) => {
    const root = e.currentTarget as HTMLElement | null;
    root?.querySelectorAll<HTMLElement & { selected: boolean }>("m3e-nav-item").forEach((el) => {
      el.selected = el.dataset.to ? selected(el.dataset.to) : false;
    });
  };

  // 下の階層（制作物を開いた画面: 校正画面・文章エディタ・SNS 投稿の編集）。戻る矢印で上へ戻れるので、
  // M3 Breakpoints「下の階層ではレールを隠してよい／large では折りたたむ」に従い紙面を広くする（§35 L-13。利用者決定 2026-10-15）
  const editorRoute = /^\/works\/[^/]+/.test(path);
  const hideRail = editorRoute && (cls === "medium" || cls === "expanded");
  // M3 Breakpoints「置き換えられる部品」: compact/medium/expanded はモーダル展開レール、large 以上は標準展開レール
  const expandable = cls !== "compact";
  const railExpanded = cls === "large" ? (editorRoute ? subOpen : railPref) : modalOpen;
  const toggleRail = () => {
    if (cls === "large" && editorRoute) setSubOpen((o) => !o);
    else if (cls === "large") {
      const next = !railPref;
      setRailPref(next);
      try {
        localStorage.setItem(RAIL_KEY, next ? "1" : "0");
      } catch {}
    } else setModalOpen((o) => !o);
  };
  const register = () => void navigate({ to: "/works", search: { new: true } });
  const modal = cls !== "large" && cls !== "compact" && modalOpen;
  // compact のエディタは詳細画面: 下部バーを隠す（M3 list-detail の compact）
  const immersive = cls === "compact" && editorRoute;
  // compact の「操作」はボトムシート、medium 以上はメニュー（M3 Breakpoints › Overview の表。§35 L-09）
  const account = (size: number, className?: string) => (
    <M3eIconButton
      slot="trailing"
      aria-label={`アカウント: ${me.name}`}
      className={className ?? ""}
      {...(cls === "compact" ? { onClick: () => setAccountSheet(true) } : {})}
    >
      <UserAvatar seed={me.email ?? me.id} size={size} />
      {cls === "compact" ? null : <M3eMenuTrigger htmlFor="account-menu" />}
    </M3eIconButton>
  );
  const accountActions = [
    ...(install
      ? [
          {
            icon: "install_desktop",
            label: "アプリとしてインストール",
            onSelect: () => void install(),
          },
        ]
      : []),
    {
      icon: "logout",
      label: "サインアウト",
      onSelect: () => void signOut().then(() => navigate({ to: "/signin" })),
    },
  ];

  return (
    <div
      className={`shell ${modal ? "shell--modal" : ""} ${immersive ? "shell--immersive" : ""} ${editorRoute ? "shell--editor" : ""} ${hideRail ? "shell--norail" : ""}`}
    >
      <div className="shell__nav" hidden={hideRail}>
        {modal ? (
          <div className="shell__scrim" onClick={() => setModalOpen(false)} aria-hidden="true" />
        ) : null}
        <M3eNavRail
          id="app-rail"
          mode={railExpanded ? "expanded" : "compact"}
          className={`shell__rail ${modal ? "shell__rail--modal" : ""} ${railExpanded ? "" : "shell__rail--collapsed"}`}
          aria-label="主要ナビゲーション"
          onChange={resync}
        >
          {expandable ? (
            <M3eIconButton
              aria-label={railExpanded ? "メニューを閉じる" : "メニューを開く"}
              aria-expanded={railExpanded}
              aria-controls="app-rail"
              onClick={toggleRail}
            >
              <M3eIcon name={railExpanded ? "menu_open" : "menu"} />
            </M3eIconButton>
          ) : null}
          <M3eFab size="small" aria-label="制作物を登録" onClick={register}>
            <M3eIcon name="add" />
            <span slot="label">制作物を登録</span>
          </M3eFab>
          {navItems()}
        </M3eNavRail>
      </div>
      {/* モーダルの展開レールを開いている間は、後ろを Tab で選べないようにする（§35 A-06） */}
      <div className="shell__main" inert={modal}>
        {/* アプリバーは 1 本。画面ごとの見出し・戻る・操作は AppBarSlot で差し込む（M3 App bars）。全体の操作（通知・アカウント）は末尾 */}
        <M3eAppBar size="small" className="shell__appbar">
          <span slot="leading" id="appbar-leading" className="appbar-slot" />
          <span
            slot="title"
            id="appbar-title"
            className="appbar-slot appbar-slot--title"
            role="heading"
            aria-level={1}
          />
          <span
            slot="subtitle"
            id="appbar-subtitle"
            className="appbar-slot appbar-slot--subtitle"
          />
          <span slot="trailing" id="appbar-actions" className="appbar-slot appbar-slot--actions" />
          {/* 通知はアカウントの隣（利用者指示 2026-10-14「アイコンの横が相場」）。compact はボトムシート。
              ただしスマホの詳細画面（制作物を開いた画面）では、Google ドキュメント・Chat などと同じくベルとアバターを出さず、
              見出し（制作物名）と画面の操作に幅を譲る（§35 L-14。利用者決定 2026-10-15） */}
          {immersive ? null : cls === "compact" ? (
            <NotificationsBell.Bell onOpen={() => setNotifOpen(true)} />
          ) : (
            <NotificationsBell.Bell menuId="notif-menu" />
          )}
          {immersive ? null : account(32, "shell__account")}
        </M3eAppBar>
        {cls === "compact" ? (
          <NotificationsBell.Sheet open={notifOpen} onClose={() => setNotifOpen(false)} />
        ) : (
          <NotificationsBell.Menu id="notif-menu" />
        )}
        {cls === "compact" ? (
          <ActionSheet
            open={accountSheet}
            onClose={() => setAccountSheet(false)}
            title={me.email ? `${me.name}（${me.email}）` : me.name}
            items={accountActions}
          />
        ) : (
          <M3eMenu id="account-menu" positionX="before">
            <div className="account-menu__header">
              <span aria-hidden="true">
                <UserAvatar seed={me.email ?? me.id} size={40} />
              </span>
              <div>
                <div className="label-large">{me.name}</div>
                {me.email ? <div className="small muted">{me.email}</div> : null}
              </div>
            </div>
            {accountActions.map((a) => (
              <M3eMenuItem key={a.label} onClick={a.onSelect}>
                <M3eIcon slot="icon" name={a.icon} />
                {a.label}
              </M3eMenuItem>
            ))}
          </M3eMenu>
        )}

        <main className="shell__content">
          <Outlet />
        </main>
      </div>
      {cls === "compact" && !immersive ? (
        <M3eNavBar className="shell__bar" aria-label="主要ナビゲーション" onChange={resync}>
          {navItems(items, true)}
        </M3eNavBar>
      ) : null}
    </div>
  );
}
