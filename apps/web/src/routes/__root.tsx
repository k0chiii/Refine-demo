import { createRootRoute, Outlet } from "@tanstack/react-router";
import { AppConvexProvider } from "@/integrations/convex";
import { M3eTheme } from "@/ui/m3e";

export const Route = createRootRoute({
  component: () => (
    <AppConvexProvider>
      {/* Material 3 Expressive: 動的カラー・表現的モーション。業務画面なので強いフォーカス表示を有効化する。 */}
      <M3eTheme color="#1b5fb4" variant="expressive" scheme="auto" motion="expressive" strongFocus>
        <Outlet />
      </M3eTheme>
    </AppConvexProvider>
  ),
});
