import { useAuthActions } from "@convex-dev/auth/react";
import { api } from "@mf100/convex/api";
import { createFileRoute, Link, Outlet, useNavigate, useRouterState } from "@tanstack/react-router";
import { useConvexAuth, useQuery } from "convex/react";
import { useEffect } from "react";
import { M3eAppBar, M3eButton, M3eIcon, M3eNavItem, M3eNavRail } from "@/ui/m3e";

export const Route = createFileRoute("/_app")({ component: AppLayout });

/**
 * 認証ガード＋共通レイアウト（UniQ の _cmsProtected と同じ 2 段階: 認可確定まで子を描かない → 不可なら /signin）。
 */
function AppLayout() {
  const { isAuthenticated, isLoading } = useConvexAuth();
  const me = useQuery(api.me.me, isAuthenticated ? {} : "skip");
  const navigate = useNavigate();
  const { signOut } = useAuthActions();
  const path = useRouterState({ select: (s) => s.location.pathname });

  useEffect(() => {
    if (isLoading) return;
    if (!isAuthenticated || me === null) void navigate({ to: "/signin", replace: true });
  }, [isLoading, isAuthenticated, me, navigate]);

  if (isLoading || !isAuthenticated || !me) return null;

  const items = [
    { to: "/queue", icon: "fact_check", label: "校正待ち" },
    { to: "/works", icon: "folder_open", label: "制作物" },
    ...(me.isSystemAdmin ? [{ to: "/admin", icon: "admin_panel_settings", label: "管理" }] : []),
  ];

  return (
    <div className="shell">
      <M3eNavRail className="shell__rail" aria-label="主要ナビゲーション">
        {items.map((it) => (
          <Link key={it.to} to={it.to} style={{ textDecoration: "none", color: "inherit" }}>
            <M3eNavItem selected={path === it.to || path.startsWith(`${it.to}/`)}>
              <M3eIcon slot="icon">{it.icon}</M3eIcon>
              {it.label}
            </M3eNavItem>
          </Link>
        ))}
      </M3eNavRail>
      <div className="shell__main">
        <M3eAppBar size="small">
          <span slot="title">MF100 校正システム</span>
          <span slot="subtitle" className="small">
            {me.name}
            {me.isSystemAdmin ? "（システム管理者）" : ""}
            {me.mock ? "・モック" : ""}
          </span>
          <M3eButton
            slot="trailing-icon"
            variant="text"
            onClick={() => signOut().then(() => navigate({ to: "/signin" }))}
          >
            <M3eIcon slot="icon">logout</M3eIcon>サインアウト
          </M3eButton>
        </M3eAppBar>
        <main className="shell__content">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
