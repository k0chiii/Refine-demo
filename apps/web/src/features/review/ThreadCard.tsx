import { api } from "@mf100/convex/api";
import type { Id } from "@mf100/convex/dataModel";
import { useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { useState } from "react";
import { useWindowClass } from "@/lib/useMedia";
import { ActionSheet, type ActionSheetItem } from "@/ui/ActionSheet";
import { formatJstShort } from "@/lib/format";
import { resolutionLabel, severityLabel } from "@/lib/labels";
import { StatusText } from "@/ui/Chip";
import { TextArea } from "@/ui/Field";
import {
  M3eButton,
  M3eCard,
  M3eIcon,
  M3eIconButton,
  M3eMenu,
  M3eMenuItem,
  M3eMenuTrigger,
} from "@/ui/m3e";
import { UserAvatar } from "@/ui/UserAvatar";
import { UserPicker } from "@/ui/UserPicker";

export type Thread = FunctionReturnType<typeof api.revisions.get>["threads"][number];
export const closedResolutions = ["rejected", "resolved", "deferred"];
export const isClosed = (t: { resolution: string }) => closedResolutions.includes(t.resolution);

type Mode = null | "reply" | "rejected" | "deferred" | "assign" | "edit";

/**
 * コメント 1 件（Google ドキュメント式）。
 * アバター・名前・日時・本文だけを見せ、操作は「✓ 解決」と「⋮」（不採用・持越・担当者・訂正）に絞る。
 * 開いているときだけ返信欄と履歴を出す。
 */
export function ThreadCard({
  thread: t,
  active,
  meId,
  canDecide,
  canReply,
  canEdit,
  onSelect,
  onResolve,
  onDecide,
  onReply,
  onAssign,
  onEdit,
  pending,
  className,
}: {
  thread: Thread;
  active: boolean;
  meId: string | null;
  canDecide: boolean;
  canReply: boolean;
  canEdit: boolean;
  onSelect: () => void;
  onResolve: () => Promise<void>;
  onDecide: (action: "rejected" | "deferred", reason: string) => Promise<void>;
  onReply: (body: string) => Promise<void>;
  onAssign: (ids: string[]) => Promise<void>;
  onEdit: (body: string) => Promise<void>;
  pending?: boolean;
  className?: string;
}) {
  const [mode, setMode] = useState<Mode>(null);
  const [text, setText] = useState("");
  const [ids, setIds] = useState<string[]>([]);
  const closed = isClosed(t);
  const open = (m: Mode, initial = "") => {
    setMode(m);
    setText(initial);
    setIds(t.assigneeId ? [t.assigneeId] : []);
    onSelect();
  };
  const stop = (e: { stopPropagation: () => void }) => e.stopPropagation();
  const submit = async () => {
    if (mode === "reply") await onReply(text);
    else if (mode === "rejected" || mode === "deferred") await onDecide(mode, text);
    else if (mode === "assign") await onAssign(ids);
    else if (mode === "edit") await onEdit(text);
    setMode(null);
    setText("");
  };
  const menuId = `tm-${t.id}`;
  const hasMenu = canDecide || canEdit;
  // compact の補助的な選択はボトムシート（M3 Breakpoints: compact は Bottom sheet、medium 以上は Menu）
  const compact = useWindowClass() === "compact";
  const [sheetOpen, setSheetOpen] = useState(false);
  const actions: ActionSheetItem[] = [
    ...(canDecide && !closed
      ? [
          { icon: "block", label: "不採用（理由を書く）", onSelect: () => open("rejected") },
          { icon: "move_down", label: "次版へ持越", onSelect: () => open("deferred") },
        ]
      : []),
    ...(canDecide ? [{ icon: "person_pin", label: "担当者", onSelect: () => open("assign") }] : []),
    ...(canEdit && t.authorId === meId
      ? [{ icon: "edit", label: "訂正", onSelect: () => open("edit", t.body) }]
      : []),
  ];

  return (
    <>
      <M3eCard
        variant="elevated"
        className={`thread ${active ? "thread--active" : ""} ${closed ? "thread--closed" : ""} ${className ?? ""}`}
        aria-label={`コメント ${t.author?.name ?? ""}`}
        onClick={onSelect}
      >
        <div slot="content" className="thread__content">
          <div className="thread__head">
            <UserAvatar seed={t.author?.email ?? t.authorId} size={28} />
            <div className="thread__who">
              <span className="thread__name">{t.author?.name}</span>
              <span className="thread__time">{formatJstShort(t.createdAt)}</span>
            </div>
            <span className="spacer" />
            {canDecide && !closed ? (
              <M3eIconButton
                aria-label="解決（反映済にする）"
                className="thread__resolve"
                disabled={pending === true}
                onClick={(e) => {
                  stop(e);
                  void onResolve();
                }}
              >
                <M3eIcon name="check" />
              </M3eIconButton>
            ) : null}
            {hasMenu ? (
              <M3eIconButton
                aria-label="その他の操作"
                className="thread__more"
                {...(compact
                  ? {
                      onClick: (e: Event) => {
                        stop(e);
                        setSheetOpen(true);
                      },
                    }
                  : {})}
              >
                <M3eIcon name="more_vert" />
                {compact ? null : <M3eMenuTrigger htmlFor={menuId} />}
              </M3eIconButton>
            ) : null}
          </div>
          {t.anchor?.type === "text_range" ? (
            <blockquote className="thread__quote">「{t.anchor.quote}」</blockquote>
          ) : null}
          <div className="thread__body">{t.body}</div>
          {closed || t.severity === "critical" || t.carriedFromThreadId || t.assignee ? (
            <div className="thread__meta">
              {closed ? (
                <StatusText tone={t.resolution === "resolved" ? "success" : "neutral"}>
                  {resolutionLabel[t.resolution]}
                </StatusText>
              ) : null}
              {t.severity === "critical" ? (
                <StatusText tone="error">{severityLabel[t.severity]}</StatusText>
              ) : null}
              {t.carriedFromThreadId ? <span className="meta">前版から持越</span> : null}
              {t.assignee ? <span className="meta">担当 {t.assignee.name}</span> : null}
            </div>
          ) : null}
          {active ? <ThreadEvents threadId={t.id} /> : null}
          {active && mode === null && canReply ? (
            <button type="button" className="thread__reply-open" onClick={() => open("reply")}>
              返信…
            </button>
          ) : null}
          {mode === "reply" || mode === "rejected" || mode === "deferred" || mode === "edit" ? (
            <div className="thread__form" onClick={stop}>
              <TextArea
                autoFocus
                aria-label={
                  mode === "reply"
                    ? "返信"
                    : mode === "edit"
                      ? "本文の訂正"
                      : `${resolutionLabel[mode]} の理由`
                }
                placeholder={
                  mode === "reply"
                    ? "返信"
                    : mode === "edit"
                      ? "本文の訂正（原文は履歴に残ります）"
                      : `${resolutionLabel[mode]} の理由（必須）`
                }
                value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Escape") setMode(null);
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && text.trim()) void submit();
                }}
              />
              <div className="row">
                <span className="spacer" />
                <M3eButton variant="text" onClick={() => setMode(null)}>
                  取消
                </M3eButton>
                <M3eButton
                  variant="filled"
                  disabled={pending === true || !text.trim()}
                  onClick={() => void submit()}
                >
                  {mode === "reply" ? "返信" : mode === "edit" ? "保存" : resolutionLabel[mode]}
                </M3eButton>
              </div>
            </div>
          ) : null}
          {mode === "assign" ? (
            <div className="thread__form" onClick={stop}>
              <UserPicker
                label="対応担当者（空にすると解除）"
                single
                value={ids}
                onChange={setIds}
              />
              <div className="row">
                <span className="spacer" />
                <M3eButton variant="text" onClick={() => setMode(null)}>
                  取消
                </M3eButton>
                <M3eButton
                  variant="filled"
                  disabled={pending === true}
                  onClick={() => void submit()}
                >
                  記録
                </M3eButton>
              </div>
            </div>
          ) : null}
        </div>
      </M3eCard>
      {hasMenu && compact ? (
        <ActionSheet
          open={sheetOpen}
          onClose={() => setSheetOpen(false)}
          title="コメントの操作"
          items={actions}
        />
      ) : null}
      {hasMenu && !compact ? (
        <M3eMenu id={menuId} positionX="before" onClick={stop}>
          {canDecide && !closed ? (
            <M3eMenuItem onClick={() => open("rejected")}>
              <M3eIcon slot="icon" name="block" />
              不採用（理由を書く）
            </M3eMenuItem>
          ) : null}
          {canDecide && !closed ? (
            <M3eMenuItem onClick={() => open("deferred")}>
              <M3eIcon slot="icon" name="move_down" />
              次版へ持越
            </M3eMenuItem>
          ) : null}
          {canDecide ? (
            <M3eMenuItem onClick={() => open("assign")}>
              <M3eIcon slot="icon" name="person_pin" />
              担当者
            </M3eMenuItem>
          ) : null}
          {canEdit && t.authorId === meId ? (
            <M3eMenuItem onClick={() => open("edit", t.body)}>
              <M3eIcon slot="icon" name="edit" />
              訂正
            </M3eMenuItem>
          ) : null}
        </M3eMenu>
      ) : null}
    </>
  );
}

/** 返信・採否・担当・訂正の履歴。返信は会話として、それ以外は 1 行で。 */
function ThreadEvents({ threadId }: { threadId: string }) {
  const data = useQuery(api.comments.events, { threadId: threadId as Id<"commentThreads"> });
  if (!data) return null;
  const rest = data.events.filter((e) => e.eventType !== "created");
  if (rest.length === 0) return null;
  return (
    <ul className="thread__events">
      {rest.map((e, i) => {
        const p = (e.payload ?? {}) as {
          to?: string;
          body?: string;
          assigneeId?: string | null;
          previousBody?: string;
        };
        if (e.eventType === "replied")
          return (
            <li key={i} className="thread__replyitem">
              <UserAvatar seed={e.actor?.email ?? e.actorId} size={24} />
              <div>
                <span className="thread__name">{e.actor?.name}</span>
                <span className="thread__time">{formatJstShort(e.createdAt)}</span>
                <div className="thread__body">{p.body}</div>
              </div>
            </li>
          );
        return (
          <li key={i} className="thread__event">
            {e.eventType === "decided"
              ? `${resolutionLabel[String(p.to ?? "")] ?? "判断"}${e.reason ? `: ${e.reason}` : ""}`
              : e.eventType === "assigned"
                ? p.assigneeId
                  ? "担当者を指定"
                  : "担当者を解除"
                : e.eventType === "edited"
                  ? `本文を訂正（原文: ${p.previousBody ?? ""}）`
                  : e.eventType === "carried_forward"
                    ? "次版へ持ち越し"
                    : e.eventType}
            <span className="thread__time">{` ・ ${e.actor?.name ?? ""}・${formatJstShort(e.createdAt)}`}</span>
          </li>
        );
      })}
    </ul>
  );
}
