import { createFileRoute } from "@tanstack/react-router";
import {
  NotificationsPage,
  type NotificationsSearch,
} from "@/features/notifications/NotificationsPage";

export const Route = createFileRoute("/_app/notifications")({
  validateSearch: (s: Record<string, unknown>): NotificationsSearch => ({
    ...(s.unread === true || s.unread === "true" || s.unread === "1" ? { unread: true } : {}),
    ...(typeof s.work === "string" && s.work !== "" ? { work: s.work } : {}),
    ...(typeof s.kind === "string" && s.kind !== "" ? { kind: s.kind } : {}),
  }),
  component: Page,
});

function Page() {
  const search = Route.useSearch();
  return <NotificationsPage search={search} />;
}
