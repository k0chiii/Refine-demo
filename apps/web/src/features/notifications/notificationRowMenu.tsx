import type { Id } from "@mf100/convex/dataModel";
import { useRef, useState, type PointerEvent as ReactPointerEvent, type MouseEvent } from "react";
import { ActionSheet, type ActionSheetItem } from "@/ui/ActionSheet";

type Row = {
  id: string;
  readAt?: number;
};

/** 通知の行を長押し（スマホ）・右クリック（PC）で操作メニューを開く */
export function useNotificationRowMenu(handlers: {
  markRead: (id: Id<"notifications">) => void;
  markUnread: (id: Id<"notifications">) => void;
}) {
  const [target, setTarget] = useState<Row | null>(null);
  const [open, setOpen] = useState(false);
  const longPress = useRef<number | undefined>(undefined);
  const suppressClick = useRef(false);

  const close = () => {
    setOpen(false);
    setTarget(null);
  };

  const openFor = (n: Row) => {
    suppressClick.current = true;
    setTarget(n);
    setOpen(true);
  };

  const clearPress = () => {
    if (longPress.current !== undefined) {
      window.clearTimeout(longPress.current);
      longPress.current = undefined;
    }
  };

  const rowHandlers = (n: Row) => ({
    onContextMenu: (e: MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      openFor(n);
    },
    onPointerDown: (e: ReactPointerEvent) => {
      if (e.button !== 0) return;
      clearPress();
      longPress.current = window.setTimeout(() => openFor(n), 500);
    },
    onPointerUp: clearPress,
    onPointerLeave: clearPress,
    onPointerCancel: clearPress,
    onClickCapture: (e: MouseEvent) => {
      if (!suppressClick.current) return;
      suppressClick.current = false;
      e.preventDefault();
      e.stopPropagation();
    },
  });

  const items: ActionSheetItem[] = !target
    ? []
    : target.readAt === undefined
      ? [
          {
            dataAction: "mark-read",
            icon: "done",
            label: "既読にする",
            onSelect: () => handlers.markRead(target.id as Id<"notifications">),
          },
        ]
      : [
          {
            dataAction: "mark-unread",
            icon: "mark_chat_unread",
            label: "未読にする",
            onSelect: () => handlers.markUnread(target.id as Id<"notifications">),
          },
        ];

  const menu = (
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

  return { rowHandlers, menu };
}
