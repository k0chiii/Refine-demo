import { api } from "@mf100/convex/api";
import { useQuery } from "convex/react";
import { DashboardOverview } from "@/features/home/DashboardOverview";
import { useWindowClass } from "@/lib/useMedia";

type Variant = "manager" | "approver" | "member";

export function RoleHomeDashboard({ variant }: { variant: Variant }) {
  const me = useQuery(api.me.me, {});
  const dash = useQuery(api.dashboard.works, variant === "manager" ? {} : "skip");
  const cls = useWindowClass();
  const twoColumns = cls === "expanded" || cls === "large";
  if (variant === "manager" && me?.canCreateWorks && dash) {
    return (
      <div className="home-dashboard home-dashboard--manager">
        <DashboardOverview data={dash} twoColumns={twoColumns} />
      </div>
    );
  }
  if (variant === "approver" && me?.canAssignApprovers) {
    return <div className="home-dashboard home-dashboard--approver" aria-label="校了ビュー" />;
  }
  if (variant === "member") {
    return <div className="home-dashboard home-dashboard--member" aria-label="メンバービュー" />;
  }
  return null;
}
