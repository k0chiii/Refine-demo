import {
  createContext,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type TextareaHTMLAttributes,
} from "react";
import { UserAvatar } from "@/ui/UserAvatar";
import { M3eActionList, M3eListAction } from "@/ui/m3e";

export interface MentionUser {
  id: string;
  name: string;
  email?: string | null;
}

/** いま開いている制作物でメンションできる人（Editor が api.comments.mentionCandidates から渡す） */
const MentionContext = createContext<readonly MentionUser[]>([]);
export const MentionProvider = MentionContext.Provider;
export const useMentionCandidates = () => useContext(MentionContext);

/** カーソルの直前が「@よみ」なら、その開始位置と検索語を返す */
export function mentionQueryAt(
  text: string,
  caret: number,
): { start: number; query: string } | null {
  const before = text.slice(0, caret);
  const m = /(^|[\s　(（「])@([^\s　@]{0,20})$/.exec(before);
  if (!m) return null;
  return { start: caret - m[2]!.length - 1, query: m[2]! };
}

/** 本文に「@名前」が残っている人だけを返す（消した人には通知しない） */
export function activeMentions(
  body: string,
  ids: readonly string[],
  users: readonly MentionUser[],
): string[] {
  return [...new Set(ids)].filter((id) => {
    const u = users.find((x) => x.id === id);
    return u ? body.includes(`@${u.name}`) : false;
  });
}

/** 本文の「@名前」を強調して描く（メンションされた人の名前だけ） */
export function renderWithMentions(
  body: string,
  users: readonly MentionUser[] | undefined,
): ReactNode {
  if (!users?.length) return body;
  const names = [...new Set(users.map((u) => u.name))].sort((a, b) => b.length - a.length);
  const escaped = names.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const re = new RegExp(`@(?:${escaped.join("|")})`, "g");
  const out: ReactNode[] = [];
  let last = 0;
  for (const m of body.matchAll(re)) {
    if (m.index > last) out.push(body.slice(last, m.index));
    out.push(
      <span key={m.index} className="mention">
        {m[0]}
      </span>,
    );
    last = m.index + m[0].length;
  }
  if (last < body.length) out.push(body.slice(last));
  return out;
}

/**
 * メンションできる入力欄。「@」に続けて名前を打つと、その制作物を見られる人の候補が下に出る（M3E list）。
 * ↑↓で選び Enter / Tab で確定、Esc で候補だけ閉じる。選んだ人の ID は onMentions で親に返す。
 * 候補を押してもフォーカスは入力欄に残す。
 */
export function MentionTextarea({
  value,
  onValue,
  mentions,
  onMentions,
  onKeyDown,
  className,
  ref: outerRef,
  ...rest
}: Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "value" | "onChange"> & {
  value: string;
  onValue: (v: string) => void;
  mentions: readonly string[];
  onMentions: (ids: string[]) => void;
  ref?: React.Ref<HTMLTextAreaElement>;
}) {
  const users = useMentionCandidates();
  const ref = useRef<HTMLTextAreaElement | null>(null);
  const setRef = (el: HTMLTextAreaElement | null) => {
    ref.current = el;
    if (typeof outerRef === "function") outerRef(el);
    else if (outerRef) (outerRef as React.RefObject<HTMLTextAreaElement | null>).current = el;
  };
  const [q, setQ] = useState<{ start: number; query: string } | null>(null);
  const [index, setIndex] = useState(0);
  const hits = useMemo(() => {
    if (!q) return [];
    const k = q.query.toLowerCase();
    return users
      .filter(
        (u) =>
          !k || u.name.toLowerCase().includes(k) || (u.email ?? "").toLowerCase().startsWith(k),
      )
      .slice(0, 6);
  }, [q, users]);
  const sync = (el: HTMLTextAreaElement) => {
    const next = mentionQueryAt(el.value, el.selectionStart ?? el.value.length);
    setQ(next);
    setIndex(0);
  };
  const pick = (u: MentionUser) => {
    const el = ref.current;
    if (!el || !q) return;
    const caret = el.selectionStart ?? value.length;
    const insert = `@${u.name} `;
    const next = value.slice(0, q.start) + insert + value.slice(caret);
    onValue(next);
    onMentions([...new Set([...mentions, u.id])]);
    setQ(null);
    requestAnimationFrame(() => {
      el.focus();
      const pos = q.start + insert.length;
      el.setSelectionRange(pos, pos);
    });
  };
  const open = q !== null && hits.length > 0;
  return (
    <span className="mention-wrap">
      <textarea
        ref={setRef}
        {...rest}
        className={className}
        value={value}
        aria-autocomplete="list"
        onChange={(e) => {
          onValue(e.target.value);
          sync(e.target);
        }}
        onSelect={(e) => sync(e.currentTarget)}
        onBlur={() => setQ(null)}
        onKeyDown={(e) => {
          if (open) {
            if (e.key === "ArrowDown" || e.key === "ArrowUp") {
              e.preventDefault();
              setIndex((i) => (i + (e.key === "ArrowDown" ? 1 : -1) + hits.length) % hits.length);
              return;
            }
            if ((e.key === "Enter" || e.key === "Tab") && !e.nativeEvent.isComposing) {
              e.preventDefault();
              pick(hits[index]!);
              return;
            }
            if (e.key === "Escape") {
              e.preventDefault();
              e.stopPropagation();
              setQ(null);
              return;
            }
          }
          onKeyDown?.(e);
        }}
      />
      {/* 候補の数を読み上げる（textarea は combobox にできないため、候補の出入りは live region で伝える） */}
      <span className="sr-only" aria-live="polite">
        {open ? `メンションの候補 ${hits.length} 人。上下で選び Enter で確定` : ""}
      </span>
      {open ? (
        <M3eActionList className="mention-list" aria-label="メンションする人">
          {hits.map((u, i) => (
            <M3eListAction
              key={u.id}
              className={`mention-list__item ${i === index ? "mention-list__item--active" : ""}`}
              onMouseDown={(e: { preventDefault: () => void }) => e.preventDefault()}
              onClick={() => pick(u)}
            >
              <span slot="leading">
                <UserAvatar seed={u.email ?? u.id} size={24} />
              </span>
              {u.name}
            </M3eListAction>
          ))}
        </M3eActionList>
      ) : null}
    </span>
  );
}
