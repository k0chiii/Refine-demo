import { api } from "@mf100/convex/api";
import type { Id } from "@mf100/convex/dataModel";
import { useNavigate } from "@tanstack/react-router";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import { useEffect, useRef } from "react";
import { formatJstShort } from "@/lib/format";
import { setAppBadge } from "@/lib/pwa";
import { PushSetting } from "./PushSetting";
import { useAction } from "@/lib/useAction";
import {
  M3eActionList,
  M3eBottomSheet,
  M3eButton,
  M3eIcon,
  M3eIconButton,
  M3eListAction,
  M3eMenu,
  M3eMenuItem,
  M3eMenuTrigger,
} from "@/ui/m3e";

const icon: Record<string, string> = {
  revision_submitted: "upload_file",
  review_assigned: "assignment_ind",
  comment_posted: "chat",
  comment_decided: "rule",
  comment_assigned: "person_pin",
  check_requested: "fact_check",
  check_completed: "task_alt",
  deadline_approaching: "alarm",
  work_finalized: "verified",
  work_reopened: "lock_open",
  revision_voided: "block",
  auto_proofread_done: "smart_toy",
  rule_proposed: "spellcheck",
  rule_proposal_decided: "rule",
  mentioned: "alternate_email",
  feedback_posted: "forum",
  feedback_mentioned: "alternate_email",
};

function useUnread() {
  return useQuery(api.notifications.unreadCount, {}) ?? 0;
}

/** 通知の一覧と操作（パネルとシートで共用） */
function useNotifications() {
  const navigate = useNavigate();
  const list = useQuery(api.notifications.list, { limit: 20 });
  const markRead = useMutation(api.notifications.markRead);
  const markAllRead = useMutation(api.notifications.markAllRead);
  const doMarkAll = useAction(async () => {
    await markAllRead({});
  });
  const openOne = useAction(async (n: NonNullable<typeof list>[number]) => {
    if (n.readAt === undefined) await markRead({ notificationId: n.id as Id<"notifications"> });
    // フィードバック（表現の議論）の通知: threadId はフィードバックのスレッド
    if ((n.kind === "feedback_posted" || n.kind === "feedback_mentioned") && n.threadId)
      // /feedback/$threadId は画面側で追加中のルート。型付きのルート一覧に載るまでは文字列のパスで渡す
      void navigate({
        to: `/feedback/${encodeURIComponent(n.threadId)}`,
      } as unknown as Parameters<typeof navigate>[0]);
    else if (n.revisionId)
      void navigate({
        to: "/revisions/$revisionId",
        params: { revisionId: n.revisionId },
        search: n.threadId ? { thread: n.threadId } : {},
      });
    else if (n.workId) void navigate({ to: "/works/$workId", params: { workId: n.workId } });
    else if (n.kind === "rule_proposed" || n.kind === "rule_proposal_decided")
      void navigate({ to: "/notation", search: { view: "proposals" } });
  });
  const unread = (list ?? []).filter((n) => n.readAt === undefined).length;
  return { list, unread, doMarkAll, openOne };
}

/**
 * 未読数のバッジ（M3 Badges: 大バッジは高さ 16、1 桁 16×16、2 桁以上は左右 4、角 8、最大 4 文字）。
 * 置き場所は親が決める（アイコンの枠の内側・上端後端）。
 */
function Badge({ unread }: { unread: number }) {
  if (unread <= 0) return null;
  return (
    <span className="badge" aria-label={`未読 ${unread} 件`}>
      {unread > 999 ? "999+" : unread}
    </span>
  );
}

/** 下部ナビゲーションバー用: アイコン（24）とその枠に錨したバッジ。 */
function Icon({ slot }: { slot?: string }) {
  const unread = useUnread();
  return (
    <span slot={slot} className="nav-icon">
      <M3eIcon name="notifications" className={unread > 0 ? "icon--filled" : ""} />
      <Badge unread={unread} />
    </span>
  );
}

/**
 * アプリバー用のベル。アイコンボタン（容器 40・タッチ 48・アイコン 24）の**外**にバッジを置く。
 * M3E のアイコンボタンは中身を容器で切り取るため、中に置くとバッジが欠ける。
 * medium 以上はメニュー（menuId）、compact はボトムシートを開く（onOpen）。どちらもアカウントの隣。
 */
function Bell({ menuId, onOpen }: { menuId?: string; onOpen?: () => void }) {
  const unread = useUnread();
  return (
    <span slot="trailing" className="bell">
      <M3eIconButton
        aria-label={unread > 0 ? `通知（未読 ${unread} 件）` : "通知"}
        {...(onOpen ? { onClick: onOpen } : {})}
      >
        <M3eIcon name="notifications" className={unread > 0 ? "icon--filled" : ""} />
        {menuId ? <M3eMenuTrigger htmlFor={menuId} /> : null}
      </M3eIconButton>
      <Badge unread={unread} />
    </span>
  );
}

/**
 * medium 以上の通知パネル（F-11 最小通知 / D8）。M3 の Scaffold では「浮遊する一時的なペイン」。幅は推奨値 360。
 * 押した通知は既読にして、対象（その版のエディタ）へ飛ぶ。
 */
function Menu({ id }: { id: string }) {
  const { list, unread, doMarkAll, openOne } = useNotifications();
  return (
    <M3eMenu id={id} positionX="before" className="notif-menu">
      <div className="notif-menu__header">
        <span className="label-large">通知</span>
      </div>
      <PushSetting />
      {unread > 0 ? (
        <M3eMenuItem disabled={doMarkAll.pending} onClick={() => void doMarkAll.run()}>
          <M3eIcon slot="icon" name="done_all" />
          すべて既読にする
        </M3eMenuItem>
      ) : null}
      {!list || list.length === 0 ? (
        <p className="muted small notif-menu__empty">通知はありません</p>
      ) : (
        list.map((n) => (
          <M3eMenuItem
            key={n.id}
            className={`notif ${n.readAt === undefined ? "notif--unread" : ""}`}
            onClick={() => void openOne.run(n)}
          >
            <M3eIcon slot="icon" name={icon[n.kind] ?? "notifications"} />
            <span className="notif__body">
              <span className="notif__title">
                {n.readAt === undefined ? <span className="sr-only">未読 </span> : null}
                {n.title}
              </span>
              <span className="notif__sub">{n.body}</span>
              <span className="notif__time">{formatJstShort(n.createdAt)}</span>
            </span>
          </M3eMenuItem>
        ))
      )}
    </M3eMenu>
  );
}

/**
 * compact の通知。M3 の Scaffold では「下端にドックしたペイン」＝モーダルのボトムシート（半分 → 全部）。
 * 下部バーの「通知」から開き、外側を押す・下へ払う・通知を押すと閉じる。
 */
function Sheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { list, unread, doMarkAll, openOne } = useNotifications();
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    const el = ref.current as
      | (HTMLElement & { show?: (d?: number) => void; hide?: () => void })
      | null;
    if (!el) return;
    el.setAttribute("detents", "half full");
    if (open) {
      const id = requestAnimationFrame(() => el.show?.(0));
      return () => cancelAnimationFrame(id);
    }
    el.hide?.();
    return;
  }, [open]);
  return (
    <M3eBottomSheet
      ref={ref as never}
      modal
      hideable
      handle
      handleLabel="通知"
      className="notif-sheet"
      onClosed={onClose}
    >
      <div slot="header" className="notif-sheet__header">
        <span className="title-small">通知</span>
        <span className="spacer" />
        {unread > 0 ? (
          <M3eButton
            variant="text"
            disabled={doMarkAll.pending}
            onClick={() => void doMarkAll.run()}
          >
            すべて既読にする
          </M3eButton>
        ) : null}
      </div>
      <PushSetting />
      {!list || list.length === 0 ? (
        <p className="muted notif-sheet__empty">通知はありません</p>
      ) : (
        <M3eActionList className="list notif-list" aria-label="通知">
          {list.map((n) => (
            <M3eListAction
              key={n.id}
              className={`list__item notif ${n.readAt === undefined ? "notif--unread" : ""}`}
              onClick={() => {
                onClose();
                void openOne.run(n);
              }}
            >
              <M3eIcon slot="leading" name={icon[n.kind] ?? "notifications"} />
              <span className="list__headline notif__title">
                {n.readAt === undefined ? <span className="sr-only">未読 </span> : null}
                {n.title}
              </span>
              <span slot="supporting-text">
                {n.body}
                <span className="notif__time">　{formatJstShort(n.createdAt)}</span>
              </span>
            </M3eListAction>
          ))}
        </M3eActionList>
      )}
    </M3eBottomSheet>
  );
}

/**
 * アプリアイコンの件数を未読の通知の数に合わせる。端末の通知（Web Push）を押して開いたとき（?from_notification=）は
 * その通知を既読にして、印を URL から消す。描画はしない。シェルに 1 つだけ置く
 */
function AppBadge() {
  const { isAuthenticated } = useConvexAuth();
  const markRead = useMutation(api.notifications.markRead);
  useEffect(() => {
    if (!isAuthenticated) return;
    const url = new URL(window.location.href);
    const id = url.searchParams.get("from_notification");
    if (!id) return;
    url.searchParams.delete("from_notification");
    window.history.replaceState(window.history.state, "", url.pathname + url.search + url.hash);
    void markRead({ notificationId: id as Id<"notifications"> }).catch(() => undefined);
  }, [isAuthenticated]);
  // サインアウトの途中（認証が外れた直後）に問い合わせない
  const unread = useQuery(api.notifications.unreadCount, isAuthenticated ? {} : "skip") ?? 0;
  useEffect(() => setAppBadge(unread), [unread]);
  return null;
}

export const NotificationsBell = { Icon, Bell, Menu, Sheet, AppBadge };
