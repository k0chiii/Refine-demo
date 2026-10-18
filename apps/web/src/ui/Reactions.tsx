import { REACTIONS } from "@mf100/domain";
import { M3eFilterChip, M3eFilterChipSet } from "@m3e/react/chips";
import { M3eIcon } from "@m3e/react/icon";
import { M3eMenu, M3eMenuItem } from "@m3e/react/menu";
import { M3eTooltip } from "@m3e/react/tooltip";

/**
 * リアクション（絵文字）の共通部品。FB の投稿とレビューのコメント・返信が同じ見た目・同じ操作を使う。
 * 絵文字は決まったものだけ（domain の REACTIONS）。自分が付けたものは選択中のチップ（色で示す）。
 * 付けた人の名前は、マウスを乗せる・長押しで出る M3E tooltip に。
 */

export interface ReactionView {
  emoji: string;
  count: number;
  mine: boolean;
  /** 付けた人（付けた順） */
  users?: ReadonlyArray<{ id: string; name: string }>;
}

/** リアクションの名前（読み上げ） */
export const reactionNames: Record<string, string> = {
  "👍": "いいね",
  "🙏": "ありがとう",
  "👀": "見ました",
  "🎉": "おめでとう",
  "💡": "ひらめき",
  "❤️": "好き",
};

/** マウスを乗せたときに出す、すぐ付けられるリアクション（Slack の操作バーと同じ） */
export const QUICK_REACTIONS = ["👍", "🙏", "👀"] as const;

/**
 * M3E の複数選択のチップの組は role="group" に aria-orientation を付ける（group には付けられない属性。axe の aria-allowed-attr）。
 * 最初の描画が済んだら外す（向きは vertical を変えたときにしか付け直されない）。
 */
const dropGroupOrientation = (el: HTMLElement | null) => {
  const set = el as (HTMLElement & { updateComplete?: Promise<unknown> }) | null;
  void set?.updateComplete?.then(() => set.removeAttribute("aria-orientation"));
};

/**
 * 付いているリアクションのチップ。押すと付け外し（`onToggle`）。`disabled` のときは見るだけ。
 * `idPrefix` は同じ画面に複数あるときの区別（tooltip の対象）
 */
export function ReactionChips({
  reactions,
  onToggle,
  idPrefix,
  disabled = false,
  className,
}: {
  reactions: readonly ReactionView[];
  onToggle: (emoji: string) => void;
  idPrefix: string;
  disabled?: boolean;
  className?: string;
}) {
  if (reactions.length === 0) return null;
  return (
    <>
      {/* 自分が付けたものは色（選択の面）で示す。チェックの印は出さない（Slack と同じ。利用者指示 2026-10-15） */}
      <M3eFilterChipSet
        multi
        hideSelectionIndicator
        aria-label="リアクション"
        className={className ?? "reaction-set"}
        ref={dropGroupOrientation}
      >
        {reactions.map((r, i) => (
          <M3eFilterChip
            key={r.emoji}
            id={`${idPrefix}-${i}`}
            selected={r.mine}
            disabled={disabled}
            aria-label={`${r.emoji} ${reactionNames[r.emoji] ?? ""} ${r.count} 人${r.mine ? "（自分も）" : ""}`}
            onClick={(e: Event) => {
              // カードの中に置くときは、カードを選ぶ操作にしない
              e.stopPropagation();
              onToggle(r.emoji);
            }}
          >
            {r.emoji} {r.count}
          </M3eFilterChip>
        ))}
      </M3eFilterChipSet>
      {reactions.map((r, i) =>
        r.users && r.users.length > 0 ? (
          <M3eTooltip key={r.emoji} htmlFor={`${idPrefix}-${i}`} touchGestures="auto">
            {r.users.map((u) => u.name).join("、")}
          </M3eTooltip>
        ) : null,
      )}
    </>
  );
}

/** 付けるリアクションを選ぶメニュー（`M3eMenuTrigger htmlFor={id}` のボタンから開く）。自分が付けたものにはチェックを付ける */
export function ReactionMenu({
  id,
  reactions,
  onPick,
  className,
}: {
  id: string;
  reactions: readonly ReactionView[];
  onPick: (emoji: string) => void;
  className?: string;
}) {
  return (
    <M3eMenu id={id} className={className ?? "reaction-menu"} onClick={(e) => e.stopPropagation()}>
      {REACTIONS.map((e) => {
        // 自分が付けたものに印（M3 Menus: 選択は色以外でも示す）
        const mine = reactions.some((r) => r.emoji === e && r.mine);
        return (
          // 名前は出さず絵文字だけ（利用者指示 2026-10-17）。読み上げには名前を残す
          <M3eMenuItem
            key={e}
            aria-label={`${e} ${reactionNames[e] ?? ""}${mine ? "（付けています）" : ""}`}
            onClick={() => onPick(e)}
          >
            {mine ? <M3eIcon slot="icon" name="check" /> : null}
            {e}
          </M3eMenuItem>
        );
      })}
    </M3eMenu>
  );
}
