import { useAuthActions } from "@convex-dev/auth/react";
import { api } from "@mf100/convex/api";
import { createFileRoute, Link, Outlet, useNavigate, useRouterState } from "@tanstack/react-router";
import { useConvexAuth, useQuery } from "convex/react";
import { useEffect } from "react";
import {
  M3eAppBar,
  M3eAvatar,
  M3eBadge,
  M3eIcon,
  M3eIconButton,
  M3eMenu,
  M3eMenuItem,
  M3eMenuTrigger,
  M3eNavBar,
  M3eNavItem,
  M3eNavRail,
} from "@/ui/m3e";

export const Route = createFileRoute("/_app")({ component: AppLayout });

/**
 * 認証ガード＋共通レイアウト。広い画面は navigation rail、狭い画面は navigation bar。
 * 右上はアカウント（アバター → 氏名・メール・サインアウトのメニュー）。
 */
function AppLayout() {
  const { isAuthenticated, isLoading } = useConvexAuth();
  const me = useQuery(api.me.me, isAuthenticated ? {} : "skip");
  const unread = useQuery(api.notifications.unreadCount, isAuthenticated && me ? {} : "skip") ?? 0;
  const navigate = useNavigate();
  const { signOut } = useAuthActions();
  const path = useRouterState({ select: (s) => s.location.pathname });

  useEffect(() => {
    if (isLoading) return;
    if (!isAuthenticated || me === null) void navigate({ to: "/signin", replace: true });
  }, [isLoading, isAuthenticated, me, navigate]);

  if (isLoading || !isAuthenticated || !me) return null;

  const items = [
    { to: "/queue", icon: "fact_check", label: "校正待ち", count: 0 },
    { to: "/works", icon: "folder", label: "制作物", count: 0 },
    { to: "/notifications", icon: "notifications", label: "通知", count: unread },
    ...(me.isSystemAdmin
      ? [{ to: "/admin", icon: "admin_panel_settings", label: "管理", count: 0 }]
      : []),
  ];
  const selected = (to: string) => path === to || path.startsWith(`${to}/`);
  const navItems = () =>
    items.map((it) => (
      <Link key={it.to} to={it.to} className="nav-link">
        <M3eNavItem selected={selected(it.to)}>
          <span slot="icon" className="nav-icon">
            <M3eIcon name={it.icon} className={selected(it.to) ? "icon--filled" : ""} />
            {it.count > 0 ? (
              <M3eBadge size="large" className="nav-icon__badge" aria-label={`未読 ${it.count} 件`}>
                {it.count > 99 ? "99+" : it.count}
              </M3eBadge>
            ) : null}
          </span>
          {it.label}
        </M3eNavItem>
      </Link>
    ));

  return (
    <div className="shell">
      <M3eNavRail className="shell__rail" aria-label="主要ナビゲーション">
        {navItems()}
      </M3eNavRail>
      <div className="shell__main">
        <M3eAppBar size="small">
          <span slot="title">MF100 校正</span>
          <M3eIconButton slot="trailing-icon" aria-label={`アカウント: ${me.name}`}>
            <M3eAvatar className="account-avatar">
              <M3eIcon name="person" className="icon--filled" />
            </M3eAvatar>
            <M3eMenuTrigger htmlFor="account-menu" />
          </M3eIconButton>
        </M3eAppBar>
        <M3eMenu id="account-menu" positionX="before">
          <div className="account-menu__header">
            <M3eAvatar className="account-avatar account-avatar--large">
              <M3eIcon name="person" className="icon--filled" />
            </M3eAvatar>
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
      <M3eNavBar className="shell__bar" aria-label="主要ナビゲーション（モバイル）">
        {navItems()}
      </M3eNavBar>
    </div>
  );
}
