import { useAuthActions } from "@convex-dev/auth/react";
import { api } from "@mf100/convex/api";
import {
  createFileRoute,
  Link,
  Outlet,
  useNavigate,
  useRouterState,
  useSearch,
} from "@tanstack/react-router";
import { useConvexAuth, useQuery } from "convex/react";
import { useEffect, useRef, useState } from "react";
import {
  M3eAppBar,
  M3eBadge,
  M3eIcon,
  M3eIconButton,
  M3eMenu,
  M3eMenuItem,
  M3eMenuTrigger,
  M3eNavBar,
  M3eNavItem,
  M3eNavRail,
  M3eSearchBar,
} from "@/ui/m3e";
import { UserAvatar } from "@/ui/UserAvatar";

export const Route = createFileRoute("/_app")({ component: AppLayout });

/**
 * 認証ガード＋共通レイアウト（Gmail / Google ドライブと同じ骨格）。
 * 左: navigation rail（狭い画面は下部 navigation bar）。上: 題名を置かず、検索バーと右上のアカウントだけ。
 * 検索は制作物一覧（/works?q=）に反映する。
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
        <M3eAppBar size="small" className="shell__appbar">
          <div slot="title" className="shell__search">
            <WorkSearch />
          </div>
          <M3eIconButton slot="trailing" aria-label={`アカウント: ${me.name}`}>
            <UserAvatar seed={me.email ?? me.id} size={32} />
            <M3eMenuTrigger htmlFor="account-menu" />
          </M3eIconButton>
        </M3eAppBar>
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
      <M3eNavBar className="shell__bar" aria-label="主要ナビゲーション（モバイル）">
        {navItems()}
      </M3eNavBar>
    </div>
  );
}

/** アプリバーの検索（Google ドライブ式）。入力は制作物一覧の `q` に反映し、一覧以外の画面からは一覧へ移動する。 */
function WorkSearch() {
  const navigate = useNavigate();
  const search = useSearch({ strict: false }) as { q?: string };
  const path = useRouterState({ select: (s) => s.location.pathname });
  const [text, setText] = useState(search.q ?? "");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!path.startsWith("/works")) setText("");
    else setText(search.q ?? "");
  }, [search.q, path.startsWith("/works")]);
  const apply = (q: string) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      void navigate({
        to: "/works",
        search: q ? { q } : {},
        replace: path.startsWith("/works"),
      });
    }, 250);
  };
  return (
    <M3eSearchBar
      className="search search--appbar"
      clearable
      onClear={() => {
        setText("");
        apply("");
      }}
    >
      <M3eIcon slot="leading" name="search" />
      <input
        slot="input"
        placeholder="制作物を検索"
        aria-label="制作物を検索"
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          apply(e.target.value);
        }}
      />
    </M3eSearchBar>
  );
}
