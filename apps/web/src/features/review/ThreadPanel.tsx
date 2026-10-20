import { api } from "@mf100/convex/api";
import type { Id } from "@mf100/convex/dataModel";
import { formatFigmaPlace, formatVideoSpan, type WebAnchorState } from "@mf100/domain";
import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { webViewportLabel } from "@/features/annotation/webBridge";
import { buildTimeline, type TimelineItem } from "./timeline";
import { formatJstShort, formatJstTime } from "@/lib/format";
import { resolutionLabel } from "@/lib/labels";
import { scrollBehavior } from "@/lib/motion";
import { useAction } from "@/lib/useAction";
import { useWindowClass } from "@/lib/useMedia";
import { ActionSheet, type ActionSheetItem } from "@/ui/ActionSheet";
import { M3eDialog } from "@/ui/LazyDialog";
import { ReactionChips, ReactionMenu, type ReactionView } from "@/ui/Reactions";
import { UserAvatar } from "@/ui/UserAvatar";
import { UserPicker } from "@/ui/UserPicker";
import { M3eAvatar } from "@m3e/react/avatar";
import { M3eButton } from "@m3e/react/button";
import { M3eFormField } from "@m3e/react/form-field";
import { M3eIcon } from "@m3e/react/icon";
import { M3eIconButton } from "@m3e/react/icon-button";
import { M3eMenu, M3eMenuItem, M3eMenuTrigger } from "@m3e/react/menu";
import { CommentAttachments } from "./CommentAttachments";
import { CommentBody, plainToMarkdown } from "./CommentBody";
import { ReplyComposer } from "./ReplyComposer";
import { RichCommentField } from "./RichCommentField";
import { ThreadMeta } from "./ThreadMeta";
import { isClosed, type Thread } from "./thread";
import "./ThreadPanel.css";

type Mode = null | "rejected" | "deferred" | "assign" | "edit";

/** 採否の確定ボタン（動詞）と理由欄の見出し */
const decisionAction = { rejected: "不採用にする", deferred: "次版へ持ち越す" } as const;
const decisionLabel = { rejected: "不採用の", deferred: "持ち越しの" } as const;

type ThreadEvent = NonNullable<FunctionReturnType<typeof api.comments.events>>["events"][number];

/**
 * スレッドのパネル（Slack のスレッド式。Drive のコメントのように、コメントを開いて話す）。
 * 上に元のコメント（本文・添付・リアクション・状態・操作）、下に返信の流れ（日付の区切り・「ここから未読」・同じ人の続けての返信は
 * まとめる）、一番下に返信欄（書式・添付）を固定する。長いやり取りはパネルの中でスクロールし、返信欄は見えたまま。
 * 開いたら（開いている間に新しい返信が来たときも）既読にする。
 * 一覧のカードは開かずに選ぶだけで、採否・担当・訂正・削除・リアクション・返信はここから行う。
 *
 * - pane: 引き出し（補助ペイン）の中。広いときは一覧の隣の 2 列目、狭いときは一覧に重ねて戻るボタンで閉じる（CSS の container query）
 * - sheet: スマホのボトムシートの中。シートいっぱいの高さにして戻るボタンで一覧へ戻る
 */
export function ThreadPanel({
  thread: t,
  index,
  placeState,
  meId,
  canDecide,
  canReply,
  canEdit,
  revisionId,
  confidentiality,
  pending,
  now,
  variant,
  onBack,
  onSelect,
  onResolve,
  onDecide,
  onReply,
  onAssign,
  onEdit,
  onDelete,
  onDeleteReply,
}: {
  thread: Thread;
  /** 紙面のピンと同じ番号 */
  index?: number;
  placeState?: WebAnchorState | undefined;
  meId: string | null;
  canDecide: boolean;
  canReply: boolean;
  canEdit: boolean;
  revisionId: string;
  confidentiality?: "normal" | "restricted" | undefined;
  pending?: boolean;
  now: number;
  variant: "pane" | "sheet";
  onBack: () => void;
  /** 紙面のピン（位置）を表示する */
  onSelect: () => void;
  onResolve: () => Promise<void>;
  onDecide: (action: "rejected" | "deferred", reason: string) => Promise<void>;
  onReply: (body: string, mentions: string[], fileIds: string[]) => Promise<boolean | undefined>;
  onAssign: (ids: string[]) => Promise<void>;
  onEdit: (body: string) => Promise<void>;
  onDelete: () => Promise<void>;
  onDeleteReply: (replyEventId: string) => Promise<void>;
}) {
  const [mode, setMode] = useState<Mode>(null);
  const [text, setText] = useState("");
  const [ids, setIds] = useState<string[]>([]);
  const closed = isClosed(t);
  const compact = useWindowClass() === "compact";
  const rootRef = useRef<HTMLElement>(null);
  useSheetFill(rootRef, variant === "sheet");
  // 開いたらフォーカスをパネルへ移し、閉じたら開いたときのボタン（カードの下の行など）へ戻す（フォーカスを body に落とさない。§35 A-04）。
  // 入力欄には移さない（スマホでキーボードが勝手に出ないように）
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    rootRef.current?.focus({ preventScroll: true });
    return () => {
      const now = document.activeElement;
      if ((!now || now === document.body) && opener?.isConnected)
        opener.focus({ preventScroll: true });
    };
  }, []);

  const openMode = (m: Mode, initial = "") => {
    setMode(m);
    setText(initial);
    setIds(t.assigneeId ? [t.assigneeId] : []);
  };
  const submit = async () => {
    if (mode === "rejected" || mode === "deferred") await onDecide(mode, text);
    else if (mode === "assign") await onAssign(ids);
    else if (mode === "edit") await onEdit(text);
    setMode(null);
    setText("");
  };
  // 訂正の入力欄に読み込む本文（Markdown）。平文のコメントは記号を打ち消して Markdown にする
  const editInitial = t.bodyFormat === "markdown" ? t.body : plainToMarkdown(t.body);
  const menuId = `tm-${t.id}`;
  const hasMenu = canDecide || canEdit || t.can.delete;
  const [confirmDelete, setConfirmDelete] = useState(false);
  const doDelete = useAction(async () => {
    await onDelete();
    setConfirmDelete(false);
  });
  const toggleReaction = useMutation(api.comments.toggleReaction);
  const [sheetOpen, setSheetOpen] = useState(false);
  const actions: ActionSheetItem[] = [
    ...(canDecide && !closed
      ? [
          { icon: "block", label: "不採用にする", onSelect: () => openMode("rejected") },
          { icon: "move_down", label: "次版へ持ち越す", onSelect: () => openMode("deferred") },
        ]
      : []),
    ...(canDecide
      ? [{ icon: "person_pin", label: "担当者を指定", onSelect: () => openMode("assign") }]
      : []),
    ...(canEdit && t.authorId === meId
      ? [{ icon: "edit", label: "訂正", onSelect: () => openMode("edit", editInitial) }]
      : []),
    ...(t.can.delete
      ? [{ icon: "delete", label: "削除", onSelect: () => setConfirmDelete(true) }]
      : []),
  ];

  const data = useQuery(api.comments.events, { threadId: t.id as Id<"commentThreads"> });
  const replyCount = data?.events.filter((e) => e.eventType === "replied").length ?? t.replyCount;

  // 開いた時点の「前に読んだ時刻」を覚える（開くとすぐ既読にするので、その後の値では未読の線が引けない）。
  // 履歴が届いてから決める（届く前に既読にすると、読んだ時刻が新しくなった値を覚えてしまう）
  const opened = useRef<{ threadId: string; readAt: number | null } | null>(null);
  if (data && opened.current?.threadId !== t.id)
    opened.current = { threadId: t.id, readAt: data.readAt };
  const readAtOnOpen = opened.current?.threadId === t.id ? opened.current.readAt : null;
  const markRead = useMutation(api.comments.markRead);
  // 開いたとき・開いている間に新しい返信が来たとき（unread になったとき）に既読にする。読み済みなら呼ばない
  const loaded = data !== undefined;
  useEffect(() => {
    if (!loaded || !t.unread) return;
    void markRead({ threadId: t.id as Id<"commentThreads"> }).catch(() => undefined);
  }, [loaded, t.id, t.unread, replyCount]);

  const timeline = useMemo(() => {
    if (!data) return [];
    // 返信は人の投稿として並べる。採否・担当・訂正は 1 行の記録（誰とも続けてまとめず、未読の線の根拠にもしない）
    const rows = data.events
      .filter((e) => e.eventType !== "created")
      .map((e) => ({
        id: e.id || `${e.eventType}-${e.createdAt}`,
        author: {
          id: e.eventType === "replied" ? e.actorId : `event:${e.createdAt}:${e.eventType}`,
        },
        createdAt: e.createdAt,
        mine: e.eventType !== "replied" || e.actorId === meId,
        event: e,
      }));
    return buildTimeline(rows, { readAt: readAtOnOpen, now });
  }, [data, readAtOnOpen, now, meId]);

  // 開いたとき: 未読の線があればそこへ、無ければ一番下へ。その後に返信が増えたら（一番下を見ていれば）一番下へ
  const scrollRef = useRef<HTMLDivElement>(null);
  const unreadRef = useRef<HTMLDivElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const scrolledFor = useRef<string | null>(null);
  const atBottom = useRef(true);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !loaded) return;
    if (scrolledFor.current !== t.id) {
      scrolledFor.current = t.id;
      if (unreadRef.current) el.scrollTop = Math.max(0, unreadRef.current.offsetTop - 8);
      else el.scrollTop = el.scrollHeight;
      atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
      return;
    }
    if (atBottom.current) el.scrollTo({ top: el.scrollHeight, behavior: scrollBehavior() });
  }, [loaded, t.id, timeline.length]);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onScroll = () => {
      atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, []);

  const locationLabel = (() => {
    if (!index || !t.anchor) return null;
    const a = t.anchor;
    const aria =
      a.type === "video_time"
        ? `コメント ${index} の時刻 ${formatVideoSpan(a)} を再生位置にする`
        : a.type === "web_element"
          ? `コメント ${index} の要素を表示（${webViewportLabel(a)} で付けたコメント）`
          : a.type === "figma_node"
            ? `コメント ${index} のフレームを表示`
            : `コメント ${index} の位置を表示`;
    const label =
      a.type === "video_time"
        ? `${index}・${formatVideoSpan(a)}`
        : a.type === "web_element"
          ? `${index}・${webViewportLabel(a)}`
          : a.type === "figma_node"
            ? `${index}・${formatFigmaPlace(a)}`
            : String(index);
    return { aria, label };
  })();

  return (
    <section
      ref={rootRef}
      className={`thread-panel thread-panel--${variant} ${closed ? "thread--closed" : ""}`}
      aria-label={`コメント${index ? ` ${index}` : ""}のスレッド`}
      data-thread-panel={t.id}
      tabIndex={-1}
    >
      <header className="thread-panel__bar">
        <M3eIconButton
          aria-label="コメントの一覧へ戻る"
          className="thread-panel__back"
          onClick={onBack}
        >
          <M3eIcon name="arrow_back" className="icon--mirror" />
        </M3eIconButton>
        <M3eIconButton
          aria-label="スレッドを閉じる"
          className="thread-panel__close"
          onClick={onBack}
        >
          <M3eIcon name="close" />
        </M3eIconButton>
        {locationLabel ? (
          <M3eButton
            variant="text"
            className="thread__index"
            aria-label={locationLabel.aria}
            onClick={onSelect}
          >
            <M3eIcon slot="icon" name="location_on" />
            {locationLabel.label}
          </M3eButton>
        ) : (
          <span className="thread-panel__title">コメント{index ? ` ${index}` : ""}</span>
        )}
        <span className="spacer" />
        {canDecide && !closed ? (
          <M3eIconButton
            aria-label="解決済みにする"
            size="extra-small"
            className="thread__resolve"
            disabled={pending === true}
            onClick={() => void onResolve()}
          >
            <M3eIcon name="check" />
          </M3eIconButton>
        ) : null}
        {hasMenu ? (
          <M3eIconButton
            aria-label="その他の操作"
            size="extra-small"
            className="thread__more"
            onClick={() => {
              if (compact) setSheetOpen(true);
            }}
          >
            <M3eIcon name="more_vert" />
            {compact ? null : <M3eMenuTrigger htmlFor={menuId} />}
          </M3eIconButton>
        ) : null}
      </header>

      <div className="thread-panel__scroll" ref={scrollRef}>
        <div className="thread-panel__root">
          <div className="thread__head">
            {t.origin ? (
              <M3eAvatar className="thread__bot" aria-hidden="true">
                <M3eIcon name="smart_toy" />
              </M3eAvatar>
            ) : (
              <UserAvatar seed={t.author?.email ?? t.authorId} userId={t.authorId} size={32} />
            )}
            <div className="thread__who">
              <span className="thread__name">{t.author?.name}</span>
              <span className="thread__time">{formatJstShort(t.createdAt)}</span>
            </div>
          </div>
          {t.anchor?.type === "text_range" ? (
            <blockquote className="thread__quote">「{t.anchor.quote}」</blockquote>
          ) : null}
          {t.anchor?.type === "web_element" && t.anchor.selector.textQuote ? (
            <blockquote className="thread__quote">
              「{t.anchor.selector.textQuote.exact}」
            </blockquote>
          ) : null}
          <CommentBody
            className="thread__body"
            body={t.body}
            format={t.bodyFormat}
            mentionUsers={t.mentionUsers}
          />
          {t.files.length > 0 ? (
            <CommentAttachments files={t.files} confidentiality={confidentiality} />
          ) : null}
          <ThreadMeta thread={t} placeState={placeState} />
          <ReactionRow
            id={`tr-${t.id}`}
            reactions={t.reactions}
            canReact={canReply}
            onToggle={(emoji) => toggleReaction({ threadId: t.id as Id<"commentThreads">, emoji })}
          />
          {mode === "rejected" || mode === "deferred" || mode === "edit" ? (
            <div className="thread__form">
              {mode === "edit" ? (
                <RichCommentField
                  id={`${t.id}-edit`}
                  ariaLabel="本文の訂正"
                  placeholder="本文の訂正"
                  autoFocus
                  toolbar
                  value={text}
                  onValue={setText}
                  onEscape={() => setMode(null)}
                  onSubmit={() => {
                    if (text.trim()) void submit();
                  }}
                />
              ) : (
                <M3eFormField variant="outlined" hideSubscript="always" className="thread__field">
                  <label slot="label" htmlFor={`${t.id}-${mode}`}>
                    {`${decisionLabel[mode]}理由（必須）`}
                  </label>
                  <textarea
                    id={`${t.id}-${mode}`}
                    autoFocus
                    rows={3}
                    className="thread__input"
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Escape") setMode(null);
                      if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && text.trim())
                        void submit();
                    }}
                  />
                </M3eFormField>
              )}
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
            <div className="thread__form">
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

        {timeline.length > 0 ? (
          <div className="thread-panel__replies">
            {dayGroups(timeline).map((g) => (
              <div key={g.key} className="cth-day-group">
                {g.label ? (
                  <div className="cth-day" aria-hidden="true">
                    <span className="cth-day__label">{g.label}</span>
                  </div>
                ) : null}
                {g.items.map((item) =>
                  item.type === "unread" ? (
                    <div key={item.key} ref={unreadRef} className="cth-unread" aria-hidden="true">
                      <span className="cth-unread__label">ここから未読</span>
                    </div>
                  ) : item.type === "post" ? (
                    <TimelineRow
                      key={item.key}
                      event={item.post.event}
                      threadId={t.id}
                      continued={item.continued}
                      canReact={canReply}
                      confidentiality={confidentiality}
                      compact={compact}
                      onDeleteReply={onDeleteReply}
                    />
                  ) : null,
                )}
              </div>
            ))}
          </div>
        ) : null}
        <div ref={endRef} />
      </div>

      {canReply ? (
        <div className="thread-panel__composer">
          <ReplyComposer
            revisionId={revisionId}
            id={t.id}
            draftKey={t.id}
            {...(pending === true ? { pending: true } : {})}
            onSubmit={onReply}
          />
        </div>
      ) : null}

      <M3eDialog open={confirmDelete} onClosed={() => setConfirmDelete(false)} closeLabel="閉じる">
        <span slot="header">コメントを削除しますか？</span>
        <div className="dialog-body" tabIndex={0}>
          <p>本文は見えなくなります。元に戻せません</p>
          {replyCount ? <p>返信 {replyCount} 件もまとめて削除します</p> : null}
        </div>
        <div slot="actions" className="row">
          <span className="spacer" />
          <M3eButton variant="text" onClick={() => setConfirmDelete(false)}>
            キャンセル
          </M3eButton>
          <M3eButton
            variant="text"
            className="thread__confirm-delete"
            disabled={doDelete.pending}
            onClick={() => void doDelete.run()}
          >
            削除
          </M3eButton>
        </div>
      </M3eDialog>
      {hasMenu && compact ? (
        <ActionSheet
          open={sheetOpen}
          onClose={() => setSheetOpen(false)}
          title="コメントの操作"
          items={actions}
        />
      ) : null}
      {hasMenu && !compact ? (
        <M3eMenu id={menuId} positionX="before">
          {canDecide && !closed ? (
            <M3eMenuItem onClick={() => openMode("rejected")}>
              <M3eIcon slot="icon" name="block" />
              不採用にする
            </M3eMenuItem>
          ) : null}
          {canDecide && !closed ? (
            <M3eMenuItem onClick={() => openMode("deferred")}>
              <M3eIcon slot="icon" name="move_down" />
              次版へ持ち越す
            </M3eMenuItem>
          ) : null}
          {canDecide ? (
            <M3eMenuItem onClick={() => openMode("assign")}>
              <M3eIcon slot="icon" name="person_pin" />
              担当者を指定
            </M3eMenuItem>
          ) : null}
          {canEdit && t.authorId === meId ? (
            <M3eMenuItem onClick={() => openMode("edit", editInitial)}>
              <M3eIcon slot="icon" name="edit" />
              訂正
            </M3eMenuItem>
          ) : null}
          {t.can.delete ? (
            <M3eMenuItem onClick={() => setConfirmDelete(true)}>
              <M3eIcon slot="icon" name="delete" />
              削除
            </M3eMenuItem>
          ) : null}
        </M3eMenu>
      ) : null}
    </section>
  );
}

/**
 * シートの中のパネルを、シートの高さいっぱいにする（シートの本体は自分でスクロールするので、パネルの高さを
 * 「シートの高さ − パネルの上端の位置」に合わせ、返信欄が下に固定され、返信の流れだけがスクロールするようにする）。
 * シートが開く・止まる高さに動く間も追う。
 */
function useSheetFill(ref: React.RefObject<HTMLElement | null>, enabled: boolean) {
  useLayoutEffect(() => {
    const el = ref.current;
    if (!enabled || !el) return;
    const sheet = el.closest("m3e-bottom-sheet") as HTMLElement | null;
    if (!sheet) return;
    const fit = () => {
      const s = sheet.getBoundingClientRect();
      const top = el.getBoundingClientRect().top;
      const bottomPad = parseFloat(getComputedStyle(sheet).paddingBottom) || 0;
      const h = Math.max(240, Math.round(s.bottom - top - bottomPad));
      el.style.height = `${h}px`;
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(sheet);
    window.addEventListener("resize", fit);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", fit);
      el.style.height = "";
    };
  }, [enabled]);
}

/** 並びを日付ごとの塊に分ける（日付の区切りで新しい塊。未読の線は直前の塊の末尾＝次の日付の直前に入る） */
function dayGroups<P>(items: TimelineItem<P>[]) {
  const groups: Array<{ key: string; label: string | null; items: TimelineItem<P>[] }> = [];
  for (const item of items) {
    if (item.type === "day") groups.push({ key: item.key, label: item.label, items: [] });
    else {
      if (groups.length === 0) groups.push({ key: "head", label: null, items: [] });
      groups.at(-1)!.items.push(item);
    }
  }
  return groups;
}

/**
 * コメント・返信のリアクションの行（FB と同じ部品）。付いているものをチップで、「付ける」ボタンから選んで付け外し。
 * 付けられる人は返信できる人と同じ（`canReact`）。それ以外の人には付いているものだけを見せる。
 */
function ReactionRow({
  id,
  reactions,
  canReact,
  onToggle,
  className,
}: {
  id: string;
  reactions: readonly ReactionView[];
  canReact: boolean;
  onToggle: (emoji: string) => Promise<unknown>;
  className?: string;
}) {
  const react = useAction(onToggle);
  if (reactions.length === 0 && !canReact) return null;
  const menuId = `${id}-menu`;
  return (
    // 付いたものが無いときは「付ける」ボタンだけ。1 行を取らず、投稿の右上に置く（監査 C-02）
    <div
      className={`thread__reactions ${reactions.length === 0 ? "thread__reactions--solo" : ""} ${className ?? ""}`}
    >
      <ReactionChips
        reactions={reactions}
        idPrefix={`${id}-chip`}
        className="thread__reaction-set"
        disabled={!canReact}
        onToggle={(emoji) => void react.run(emoji)}
      />
      {canReact ? (
        <>
          <M3eIconButton
            aria-label="リアクションを付ける"
            size="extra-small"
            className="thread__react"
          >
            <M3eIcon name="add_reaction" />
            <M3eMenuTrigger htmlFor={menuId} />
          </M3eIconButton>
          <ReactionMenu
            id={menuId}
            reactions={reactions}
            onPick={(emoji) => void react.run(emoji)}
          />
        </>
      ) : null}
    </div>
  );
}

/** 返信の流れの 1 行: 返信は会話として、採否・担当・訂正は 1 行の記録として */
function TimelineRow({
  event: e,
  threadId,
  continued,
  canReact,
  confidentiality,
  compact,
  onDeleteReply,
}: {
  event: ThreadEvent;
  threadId: string;
  continued: boolean;
  canReact: boolean;
  confidentiality: "normal" | "restricted" | undefined;
  compact: boolean;
  onDeleteReply: (replyEventId: string) => Promise<void>;
}) {
  const p = (e.payload ?? {}) as {
    to?: string;
    body?: string;
    assigneeId?: string | null;
    previousBody?: string;
    previousBodyFormat?: "markdown";
    bodyFormat?: "markdown";
  };
  if (e.eventType === "replied")
    return (
      <ReplyItem
        event={e}
        threadId={threadId}
        canReact={canReact}
        confidentiality={confidentiality}
        body={p.body ?? ""}
        bodyFormat={p.bodyFormat}
        compact={compact}
        continued={continued}
        onDelete={() => onDeleteReply(e.id)}
      />
    );
  return (
    <div className="thread__event">
      {e.eventType === "decided"
        ? `${resolutionLabel[String(p.to ?? "")] ?? "判断"}${e.reason ? `: ${e.reason}` : ""}`
        : e.eventType === "assigned"
          ? p.assigneeId
            ? "担当者を指定"
            : "担当者を解除"
          : e.eventType === "edited"
            ? "本文を訂正（原文）"
            : e.eventType === "carried_forward"
              ? "次版へ持ち越し"
              : e.eventType}
      <span className="thread__time">{` ・ ${e.actor?.name ?? ""}・${formatJstShort(e.createdAt)}`}</span>
      {e.eventType === "edited" ? (
        <CommentBody
          className="thread__previous"
          body={p.previousBody ?? ""}
          format={p.previousBodyFormat}
        />
      ) : null}
    </div>
  );
}

/**
 * 返信 1 件。自分の返信だけ「⋮」から削除できる（削除した返信は並べない）。
 * 同じ人が 5 分以内に続けた返信（continued）は名前・アバター・時刻を省き、左の余白に時刻（マウスを乗せたときだけ）
 */
function ReplyItem({
  event: e,
  threadId,
  canReact,
  confidentiality,
  body,
  bodyFormat,
  compact,
  continued,
  onDelete,
}: {
  event: ThreadEvent;
  threadId: string;
  canReact: boolean;
  confidentiality: "normal" | "restricted" | undefined;
  body: string;
  bodyFormat: "markdown" | undefined;
  compact: boolean;
  continued: boolean;
  onDelete: () => Promise<void>;
}) {
  const [confirm, setConfirm] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const toggleReaction = useMutation(api.comments.toggleReaction);
  const doDelete = useAction(async () => {
    await onDelete();
    setConfirm(false);
  });
  const menuId = `rm-${e.id}`;
  const deletable = e.can?.delete === true;
  return (
    <div className={`thread__replyitem cth-post ${continued ? "cth-post--continued" : ""}`}>
      {continued ? (
        <time className="cth-post__time" dateTime={new Date(e.createdAt).toISOString()}>
          {formatJstTime(e.createdAt)}
        </time>
      ) : (
        <UserAvatar seed={e.actor?.email ?? e.actorId} userId={e.actorId} size={28} />
      )}
      <div className="thread__replybody">
        {continued ? null : (
          <div className="cth-post__head">
            <span className="thread__name">{e.actor?.name}</span>
            <span className="thread__time">{formatJstShort(e.createdAt)}</span>
          </div>
        )}
        <CommentBody
          className="thread__body"
          body={body}
          format={bodyFormat}
          mentionUsers={e.mentionUsers}
        />
        {e.files.length > 0 ? (
          <CommentAttachments files={e.files} confidentiality={confidentiality} />
        ) : null}
        <ReactionRow
          id={`rr-${e.id}`}
          reactions={e.reactions}
          canReact={canReact}
          className="thread__reactions--reply"
          onToggle={(emoji) =>
            toggleReaction({
              threadId: threadId as Id<"commentThreads">,
              replyEventId: e.id,
              emoji,
            })
          }
        />
      </div>
      {deletable ? (
        <M3eIconButton
          aria-label="返信の操作"
          size="extra-small"
          className="thread__reply-more"
          onClick={() => {
            if (compact) setSheetOpen(true);
          }}
        >
          <M3eIcon name="more_vert" />
          {compact ? null : <M3eMenuTrigger htmlFor={menuId} />}
        </M3eIconButton>
      ) : null}
      {deletable && compact ? (
        <ActionSheet
          open={sheetOpen}
          onClose={() => setSheetOpen(false)}
          title="返信の操作"
          items={[{ icon: "delete", label: "削除", onSelect: () => setConfirm(true) }]}
        />
      ) : null}
      {deletable && !compact ? (
        <M3eMenu id={menuId} positionX="before">
          <M3eMenuItem onClick={() => setConfirm(true)}>
            <M3eIcon slot="icon" name="delete" />
            削除
          </M3eMenuItem>
        </M3eMenu>
      ) : null}
      <M3eDialog open={confirm} onClosed={() => setConfirm(false)} closeLabel="閉じる">
        <span slot="header">返信を削除しますか？</span>
        <div className="dialog-body" tabIndex={0}>
          <p>本文は見えなくなります。元に戻せません</p>
        </div>
        <div slot="actions" className="row">
          <span className="spacer" />
          <M3eButton variant="text" onClick={() => setConfirm(false)}>
            キャンセル
          </M3eButton>
          <M3eButton
            variant="text"
            className="thread__confirm-delete"
            disabled={doDelete.pending}
            onClick={() => void doDelete.run()}
          >
            削除
          </M3eButton>
        </div>
      </M3eDialog>
    </div>
  );
}
