import { createRootRoute, Outlet } from "@tanstack/react-router";
import { AppConvexProvider } from "@/integrations/convex";

/** テーマ（<m3e-theme>）は index.html の <body> 直下にある（src/theme.ts 参照）。 */
export const Route = createRootRoute({
  component: () => (
    <AppConvexProvider>
      <Outlet />
    </AppConvexProvider>
  ),
});
