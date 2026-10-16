import { api } from "@mf100/convex/api";
import type { Id } from "@mf100/convex/dataModel";
import { useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { useState } from "react";
import { MentionTextarea, renderWithMentions } from "./mentions";
import { useWindowClass } from "@/lib/useMedia";
import { ActionSheet, type ActionSheetItem } from "@/ui/ActionSheet";
import { formatJstShort } from "@/lib/format";
import { resolutionLabel, severityLabel } from "@/lib/labels";
import {
  M3eAvatar,
  M3eButton,
  M3eCard,
  M3eFormField,
  M3eIcon,
  M3eIconButton,
  M3eMenu,
  M3eMenuItem,
  M3eMenuTrigger,
} from "@/ui/m3e";
import { StatusText } from "@/ui/Chip";
import { UserAvatar } from "@/ui/UserAvatar";
import { UserPicker } from "@/ui/UserPicker";

export type Thread = FunctionReturnType<typeof api.revisions.get>["threads"][number];
export const closedResolutions = ["rejected", "resolved", "deferred"];
export const isClosed = (t: { resolution: string }) => closedResolutions.includes(t.resolution);

type Mode = null | "reply" | "rejected" | "deferred" | "assign" | "edit";

/** 採否の確定ボタン（動詞）と理由欄の見出し */
const decisionAction = { rejected: "不採用にする", deferred: "次版へ持ち越す" } as const;
const decisionLabel = { rejected: "不採用の", deferred: "持ち越しの" } as const;

/**
 * コメント 1 件（Google ドキュメント式）。
 * アバター・名前・日時・本文だけを見せ、操作は「✓ 解決」と「⋮」（不採用・持ち越し・担当者・訂正）に絞る。
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
  index,
}: {
  /** 紙面のピンと同じ番号（ピンの名前「コメント N」と対応させる） */
  index?: number;
  thread: Thread;
  active: boolean;
  meId: string | null;
  canDecide: boolean;
  canReply: boolean;
  canEdit: boolean;
  onSelect: () => void;
  onResolve: () => Promise<void>;
  onDecide: (action: "rejected" | "deferred", reason: string) => Promise<void>;
  onReply: (body: string, mentions: string[]) => Promise<void>;
  onAssign: (ids: string[]) => Promise<void>;
  onEdit: (body: string) => Promise<void>;
  pending?: boolean;
  className?: string;
}) {
  const [mode, setMode] = useState<Mode>(null);
  const [text, setText] = useState("");
  const [ids, setIds] = useState<string[]>([]);
  const [mentions, setMentions] = useState<string[]>([]);
  const closed = isClosed(t);
  const open = (m: Mode, initial = "") => {
    setMode(m);
    setText(initial);
    setIds(t.assigneeId ? [t.assigneeId] : []);
    onSelect();
  };
  const stop = (e: { stopPropagation: () => void }) => e.stopPropagation();
  const submit = async () => {
    if (mode === "reply") await onReply(text, mentions);
    else if (mode === "rejected" || mode === "deferred") await onDecide(mode, text);
    else if (mode === "assign") await onAssign(ids);
    else if (mode === "edit") await onEdit(text);
    setMode(null);
    setText("");
    setMentions([]);
  };
  const menuId = `tm-${t.id}`;
  const hasMenu = canDecide || canEdit;
  // compact の補助的な選択はボトムシート（M3 Breakpoints: compact は Bottom sheet、medium 以上は Menu）
  const compact = useWindowClass() === "compact";
  const [sheetOpen, setSheetOpen] = useState(false);
  const actions: ActionSheetItem[] = [
    ...(canDecide && !closed
      ? [
          { icon: "block", label: "不採用にする", onSelect: () => open("rejected") },
          { icon: "move_down", label: "次版へ持ち越す", onSelect: () => open("deferred") },
        ]
      : []),
    ...(canDecide
      ? [{ icon: "person_pin", label: "担当者を指定", onSelect: () => open("assign") }]
      : []),
    ...(canEdit && t.authorId === meId
      ? [{ icon: "edit", label: "訂正", onSelect: () => open("edit", t.body) }]
      : []),
  ];

  return (
    <>
      <M3eCard
        variant={active ? "elevated" : "outlined"}
        className={`thread ${active ? "thread--active" : ""} ${closed ? "thread--closed" : ""} ${className ?? ""}`}
        aria-label={`コメント${index ? ` ${index}` : ""} ${t.author?.name ?? ""}`}
        onClick={onSelect}
      >
        <div slot="content" className="thread__content">
          <div className="thread__head">
            {t.origin ? (
              <M3eAvatar className="thread__bot" aria-hidden="true">
                <M3eIcon name="smart_toy" />
              </M3eAvatar>
            ) : (
              <UserAvatar seed={t.author?.email ?? t.authorId} size={28} />
            )}
            <div className="thread__who">
              <span className="thread__name">{t.author?.name}</span>
              <span className="thread__time">{formatJstShort(t.createdAt)}</span>
            </div>
            <span className="spacer" />
            {/* 位置のあるコメントは、紙面のピンと同じ番号のボタンから位置へ飛べる（カードを押すのはマウスだけの操作なので、
                キーボード・支援技術でも同じことができるようにする。§35 A-07） */}
            {index && t.anchor ? (
              <M3eButton
                variant="text"
                className="thread__index"
                aria-label={`コメント ${index} の位置を表示`}
                onClick={(e: Event) => {
                  stop(e);
                  onSelect();
                }}
              >
                <M3eIcon slot="icon" name="location_on" />
                {index}
              </M3eButton>
            ) : null}
            {canDecide && !closed ? (
              <M3eIconButton
                aria-label="解決済みにする"
                size="extra-small"
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
                size="extra-small"
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
          <div className="thread__body">{renderWithMentions(t.body, t.mentionUsers)}</div>
          {closed ||
          t.severity === "critical" ||
          t.carriedFromThreadId ||
          t.assignee ||
          t.origin?.needsReview ||
          t.origin?.textSource === "ocr" ? (
            <div className="thread__meta">
              {/* 状態は文字＋アイコン（M3 の chip は操作の部品なので、ただの表示には使わない。§49） */}
              {t.origin?.needsReview ? <StatusText icon="help">要確認</StatusText> : null}
              {t.origin?.textSource === "ocr" ? (
                <StatusText icon="document_scanner">画像から読み取り</StatusText>
              ) : null}
              {closed ? (
                <StatusText
                  tone={t.resolution === "resolved" ? "success" : "neutral"}
                  icon={t.resolution === "resolved" ? "check_circle" : "do_not_disturb_on"}
                >
                  {resolutionLabel[t.resolution]}
                </StatusText>
              ) : null}
              {t.severity === "critical" ? (
                <StatusText tone="error" icon="priority_high">
                  {severityLabel[t.severity]}
                </StatusText>
              ) : null}
              {t.carriedFromThreadId ? <StatusText icon="redo">前版から持ち越し</StatusText> : null}
              {t.assignee ? <StatusText icon="person">担当 {t.assignee.name}</StatusText> : null}
            </div>
          ) : null}
          {active ? <ThreadEvents threadId={t.id} /> : null}
          {/* 返信（Google ドキュメントのコメントと同じ流れ）: 開いているカードの下に M3 の outlined text field を 1 つ。
              書き始める（フォーカスする）と「キャンセル」「返信」が出る。ラベルは欄の中（浮かぶラベル） */}
          {active && canReply && (mode === null || mode === "reply") ? (
            <div className="thread__form" onClick={stop}>
              <M3eFormField variant="outlined" hideSubscript="always" className="thread__field">
                <label slot="label" htmlFor={`${t.id}-reply`}>
                  返信
                </label>
                <MentionTextarea
                  id={`${t.id}-reply`}
                  rows={mode === "reply" ? 3 : 1}
                  className="thread__input"
                  placeholder="@ でメンション"
                  value={mode === "reply" ? text : ""}
                  onValue={(v) => {
                    if (mode !== "reply") setMode("reply");
                    setText(v);
                  }}
                  mentions={mentions}
                  onMentions={setMentions}
                  onFocus={() => {
                    if (mode !== "reply") {
                      setMode("reply");
                      setText("");
                    }
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Escape") {
                      setMode(null);
                      setText("");
                      (e.currentTarget as HTMLTextAreaElement).blur();
                    }
                    if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && text.trim()) void submit();
                  }}
                />
              </M3eFormField>
              {mode === "reply" ? (
                <div className="row thread__form-actions">
                  <span className="spacer" />
                  <M3eButton
                    variant="text"
                    onClick={() => {
                      setMode(null);
                      setText("");
                    }}
                  >
                    キャンセル
                  </M3eButton>
                  <M3eButton
                    variant="filled"
                    disabled={pending === true || !text.trim()}
                    onClick={() => void submit()}
                  >
                    返信
                  </M3eButton>
                </div>
              ) : null}
            </div>
          ) : null}
          {mode === "rejected" || mode === "deferred" || mode === "edit" ? (
            <div className="thread__form" onClick={stop}>
              <M3eFormField variant="outlined" hideSubscript="always" className="thread__field">
                <label slot="label" htmlFor={`${t.id}-${mode}`}>
                  {mode === "edit" ? "本文の訂正" : `${decisionLabel[mode]}理由（必須）`}
                </label>
                <textarea
                  id={`${t.id}-${mode}`}
                  autoFocus
                  rows={3}
                  className="thread__input"
                  placeholder={mode === "edit" ? "原文は履歴に残ります" : ""}
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Escape") setMode(null);
                    if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && text.trim()) void submit();
                  }}
                />
              </M3eFormField>
              <div className="row thread__form-actions">
                <span className="spacer" />
                <M3eButton variant="text" onClick={() => setMode(null)}>
                  キャンセル
                </M3eButton>
                <M3eButton
                  variant="filled"
                  disabled={pending === true || !text.trim()}
                  onClick={() => void submit()}
                >
                  {mode === "edit" ? "訂正を保存" : decisionAction[mode]}
                </M3eButton>
              </div>
            </div>
          ) : null}
          {mode === "assign" ? (
            <div className="thread__form" onClick={stop}>
              <UserPicker
                label="対応担当者"
                hint="空にすると担当者を外します"
                single
                value={ids}
                onChange={setIds}
              />
              <div className="row">
                <span className="spacer" />
                <M3eButton variant="text" onClick={() => setMode(null)}>
                  キャンセル
                </M3eButton>
                <M3eButton
                  variant="filled"
                  disabled={pending === true}
                  onClick={() => void submit()}
                >
                  担当者を設定
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
              不採用にする
            </M3eMenuItem>
          ) : null}
          {canDecide && !closed ? (
            <M3eMenuItem onClick={() => open("deferred")}>
              <M3eIcon slot="icon" name="move_down" />
              次版へ持ち越す
            </M3eMenuItem>
          ) : null}
          {canDecide ? (
            <M3eMenuItem onClick={() => open("assign")}>
              <M3eIcon slot="icon" name="person_pin" />
              担当者を指定
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
                <div className="thread__body">
                  {renderWithMentions(p.body ?? "", e.mentionUsers)}
                </div>
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
