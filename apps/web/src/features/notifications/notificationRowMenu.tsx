import type { Id } from "@mf100/convex/dataModel";
import { useRef, useState, type KeyboardEvent, type MouseEvent, type PointerEvent } from "react";
import { ActionSheet, type ActionSheetItem } from "@/ui/ActionSheet";
import { M3eIcon } from "@m3e/react/icon";
import { M3eIconButton } from "@m3e/react/icon-button";
import { M3eMenu, M3eMenuItem, M3eMenuTrigger } from "@m3e/react/menu";

export type NotificationRow = {
  id: string;
  readAt?: number | undefined;
  title: string;
};

type Handlers = {
  markRead: (id: Id<"notifications">) => void;
  markUnread: (id: Id<"notifications">) => void;
};

/** Slack と同じ 1 項目（未読→既読にする / 既読→未読にする） */
export function notificationActionItems(n: NotificationRow, h: Handlers): ActionSheetItem[] {
  if (n.readAt === undefined) {
    return [
      {
        dataAction: "mark-read",
        icon: "done",
        label: "既読にする",
        onSelect: () => h.markRead(n.id as Id<"notifications">),
      },
    ];
  }
  return [
    {
      dataAction: "mark-unread",
      icon: "mark_chat_unread",
      label: "未読にする",
      onSelect: () => h.markUnread(n.id as Id<"notifications">),
    },
  ];
}

function openContextMenuTrigger(menuId: string) {
  document.getElementById(`${menuId}-trigger`)?.click();
}

/** PC: 行ホバーで ⋮、右クリック / Shift+F10 / メニューキーで同じメニューを開く（既読化・遷移はしない） */
export function useNotificationRowContextOpen(menuId: string) {
  return {
    onContextMenu: (e: MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      openContextMenuTrigger(menuId);
    },
    onKeyDown: (e: KeyboardEvent) => {
      if ((e.key === "F10" && e.shiftKey) || e.key === "ContextMenu") {
        e.preventDefault();
        e.stopPropagation();
        openContextMenuTrigger(menuId);
      }
    },
  };
}

/** 通知行の ⋮（medium 以上の通知パネル用）。メニュー本体は親が兄弟要素として描く */
export function NotificationRowMoreTrigger({ n, menuId }: { n: NotificationRow; menuId: string }) {
  return (
    <M3eIconButton
      id={`${menuId}-trigger`}
      slot="trailing"
      className="notif-row__more"
      aria-label={`${n.title} の操作`}
      title="操作"
      onClick={(e) => e.stopPropagation()}
    >
      <M3eIcon name="more_vert" />
      <M3eMenuTrigger htmlFor={menuId} />
    </M3eIconButton>
  );
}

/** PC 用コンテキストメニュー（#notif-menu の外に置く） */
export function NotificationRowContextMenu({
  menuId,
  items,
}: {
  menuId: string;
  items: ActionSheetItem[];
}) {
  return (
    <M3eMenu id={menuId} positionX="before" className="notif-row-menu">
      {items.map((it) => (
        <M3eMenuItem
          key={it.dataAction ?? it.icon}
          data-action={it.dataAction}
          onClick={(e) => {
            e.stopPropagation();
            it.onSelect();
          }}
        >
          <M3eIcon slot="icon" name={it.icon} />
          {it.label}
        </M3eMenuItem>
      ))}
    </M3eMenu>
  );
}

/** スマホ: 長押しでボトムシート（Slack のアクションシート） */
export function useNotificationLongPressSheet(handlers: Handlers) {
  const [target, setTarget] = useState<NotificationRow | null>(null);
  const [open, setOpen] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  const suppressClick = useRef(false);

  const close = () => {
    setOpen(false);
    setTarget(null);
  };

  const openFor = (n: NotificationRow) => {
    suppressClick.current = true;
    setTarget(n);
    setOpen(true);
  };

  const clearTimer = () => {
    if (timer.current !== undefined) {
      window.clearTimeout(timer.current);
      timer.current = undefined;
    }
  };

  const sheetHandlers = (n: NotificationRow) => ({
    onPointerDown: (e: PointerEvent) => {
      if (e.button !== 0) return;
      clearTimer();
      timer.current = window.setTimeout(() => openFor(n), 500);
    },
    onPointerUp: clearTimer,
    onPointerLeave: clearTimer,
    onPointerCancel: clearTimer,
    onClickCapture: (e: MouseEvent) => {
      if (!suppressClick.current) return;
      suppressClick.current = false;
      e.preventDefault();
      e.stopPropagation();
    },
  });

  const items = target ? notificationActionItems(target, handlers) : [];

  const sheet = (
    <ActionSheet
      open={open}
      onClose={close}
      title="通知"
      items={items.map((item) => ({
        ...item,
        onSelect: () => {
          item.onSelect();
          close();
        },
      }))}
    />
  );

  return { sheetHandlers, sheet };
}
