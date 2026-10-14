import { useAuthActions } from "@convex-dev/auth/react";
import { api } from "@mf100/convex/api";
import { createFileRoute, Link, Outlet, useNavigate, useRouterState } from "@tanstack/react-router";
import { useConvexAuth, useQuery } from "convex/react";
import { useEffect, useState } from "react";
import { NotificationsBell } from "@/features/notifications/NotificationsBell";
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
 * - compact（<600）: アプリバーはアカウントだけ。下部ナビゲーションバー 3 件（ダッシュボード・制作物・通知）。
 *   エディタ（`/works/:id`）では下部バーを隠す（詳細画面）。アプリバーはどの幅でも 1 本で、エディタが戻る・題名・操作を差し込む。
 * - medium（600–839）/ expanded（840–1199）: 折りたたみレール（96）。メニューを押すと**モーダル**の展開レールが重なる（スクリム、Esc で閉じる）。
 * - large（1200 以上）: メニューで**標準**の展開レール（220）に広がり内容を押す。状態は保存。既定は折りたたみ。
 * レールの中身は M3 の解剖図どおり: 上にメニュー、次に FAB「制作物を登録」、その下に行き先。アカウントは右上に残す。
 * 通知は独立した画面を持たず、ベル（compact では下部バーの「通知」）のパネルから対象へ飛ぶ。
 */
function AppLayout() {
  const { isAuthenticated, isLoading } = useConvexAuth();
  const me = useQuery(api.me.me, isAuthenticated ? {} : "skip");
  const navigate = useNavigate();
  const { signOut } = useAuthActions();
  const path = useRouterState({ select: (s) => s.location.pathname });
  const cls = useWindowClass();
  const [railPref, setRailPref] = useState(readRailPref);
  const [modalOpen, setModalOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);

  useEffect(() => {
    if (isLoading) return;
    if (!isAuthenticated || me === null) void navigate({ to: "/signin", replace: true });
  }, [isLoading, isAuthenticated, me, navigate]);

  // モーダルの展開レールは、行き先を選んだ時・幅が変わった時・Esc で閉じる
  useEffect(() => {
    setModalOpen(false);
    setNotifOpen(false);
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
    { to: "/", icon: "space_dashboard", label: "ダッシュボード" },
    { to: "/works", icon: "folder", label: "制作物" },
    ...(me.isSystemAdmin ? [{ to: "/admin", icon: "admin_panel_settings", label: "管理" }] : []),
  ];
  const selected = (to: string) =>
    to === "/" ? path === "/" : path === to || path.startsWith(`${to}/`);
  const navItems = () =>
    items.map((it) => (
      <Link key={it.to} to={it.to} className="nav-link">
        <M3eNavItem selected={selected(it.to)} data-to={it.to}>
          <M3eIcon slot="icon" name={it.icon} className={selected(it.to) ? "icon--filled" : ""} />
          {it.label}
        </M3eNavItem>
      </Link>
    ));
  /** M3E は押した項目を自動で選択状態にするため、経路に基づく選択へ戻す（下部バーの「通知」は経路ではない） */
  const resync = (e: { currentTarget: EventTarget | null }) => {
    const root = e.currentTarget as HTMLElement | null;
    root?.querySelectorAll<HTMLElement & { selected: boolean }>("m3e-nav-item").forEach((el) => {
      el.selected = el.dataset.to ? selected(el.dataset.to) : false;
    });
  };

  // M3 Breakpoints「置き換えられる部品」: compact/medium/expanded はモーダル展開レール、large 以上は標準展開レール
  const expandable = cls !== "compact";
  const railExpanded = cls === "large" ? railPref : modalOpen;
  const toggleRail = () => {
    if (cls === "large") {
      const next = !railPref;
      setRailPref(next);
      try {
        localStorage.setItem(RAIL_KEY, next ? "1" : "0");
      } catch {}
    } else setModalOpen((o) => !o);
  };
  const register = () => void navigate({ to: "/works", search: { new: true } });
  const modal = cls !== "large" && cls !== "compact" && modalOpen;
  // compact のエディタは詳細画面: 共通のアプリバーと下部バーを隠し、エディタ自身のトップアプリバー（戻る・題名）に譲る（M3 list-detail の compact）
  const editorRoute = /^\/works\/[^/]+/.test(path);
  const immersive = cls === "compact" && editorRoute;
  const account = (size: number, className?: string) => (
    <M3eIconButton
      slot="trailing"
      aria-label={`アカウント: ${me.name}`}
      className={className ?? ""}
    >
      <UserAvatar seed={me.email ?? me.id} size={size} />
      <M3eMenuTrigger htmlFor="account-menu" />
    </M3eIconButton>
  );

  return (
    <div
      className={`shell ${modal ? "shell--modal" : ""} ${immersive ? "shell--immersive" : ""} ${editorRoute ? "shell--editor" : ""}`}
    >
      <div className="shell__nav">
        {modal ? (
          <div className="shell__scrim" onClick={() => setModalOpen(false)} aria-hidden="true" />
        ) : null}
        <M3eNavRail
          id="app-rail"
          mode={railExpanded ? "expanded" : "compact"}
          className={`shell__rail ${modal ? "shell__rail--modal" : ""}`}
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
      <div className="shell__main">
        {/* アプリバーは 1 本。画面ごとの見出し・戻る・操作は AppBarSlot で差し込む（M3 App bars）。全体の操作（通知・アカウント）は末尾 */}
        <M3eAppBar size="small" className="shell__appbar">
          <span slot="leading" id="appbar-leading" className="appbar-slot" />
          <span slot="title" id="appbar-title" className="appbar-slot appbar-slot--title" />
          <span
            slot="subtitle"
            id="appbar-subtitle"
            className="appbar-slot appbar-slot--subtitle"
          />
          <span slot="trailing" id="appbar-actions" className="appbar-slot appbar-slot--actions" />
          {cls === "compact" ? null : <NotificationsBell.Bell menuId="notif-menu" />}
          {account(32, "shell__account")}
        </M3eAppBar>
        {cls === "compact" ? (
          <NotificationsBell.Sheet open={notifOpen} onClose={() => setNotifOpen(false)} />
        ) : (
          <NotificationsBell.Menu id="notif-menu" />
        )}
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
          <M3eMenuItem onClick={() => signOut().then(() => navigate({ to: "/signin" }))}>
            <M3eIcon slot="icon" name="logout" />
            サインアウト
          </M3eMenuItem>
        </M3eMenu>

        <main className="shell__content">
          <Outlet />
        </main>
      </div>
      {cls === "compact" && !immersive ? (
        <M3eNavBar className="shell__bar" aria-label="主要ナビゲーション" onChange={resync}>
          {navItems()}
          <M3eNavItem className="shell__bar-notif" onClick={() => setNotifOpen(true)}>
            <NotificationsBell.Icon slot="icon" />
            通知
          </M3eNavItem>
        </M3eNavBar>
      ) : null}
    </div>
  );
}
