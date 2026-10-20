import { lazy, Suspense, type CSSProperties, type Ref } from "react";
import { Loading } from "@/ui/Loading";

/**
 * コメント・返信・訂正の入力欄（Slack 式の書式つき入力。TipTap）。
 * 本体（TipTap・ProseMirror。約 500KB / 160KB 圧縮後）は初めて入力欄を出すまで読み込まない（校正画面の最初の読み込みを増やさない。
 * docs/UI_M3E.md §60 の遅延読み込みと同じ考え方）。読み込み中は Loading を出す。
 * 値は Markdown の文字列。「@」のメンションは本文に「@名前」と書かれ、選んだ人の ID は onMentions で返す。
 */
export interface RichCommentHandle {
  focus(): void;
  blur(): void;
}

export interface RichCommentFieldProps {
  /** 本文（Markdown）。外から変わったとき（投稿後に空にする・訂正の初期値）は入力欄の中身を置き換える */
  value: string;
  onValue: (markdown: string) => void;
  /** 本文の中に残っているメンション（選んだ人の ID）。消した人は外れる */
  onMentions?: (ids: string[]) => void;
  /** ⌘/Ctrl + Enter */
  onSubmit?: () => void;
  /** Esc（メンションの候補を出している間は呼ばない） */
  onEscape?: () => void;
  onFocus?: () => void;
  /** 読み上げの名前 */
  ariaLabel: string;
  placeholder?: string;
  id?: string;
  /** 開いたときにフォーカスして末尾へ */
  autoFocus?: boolean;
  /** 書式のツールバーを出す */
  toolbar?: boolean;
  /** 最小の高さ（行数）。既定は 3 行 */
  rows?: number;
  className?: string;
  ref?: Ref<RichCommentHandle>;
}

const load = () => import("./RichCommentEditor");
const RichCommentEditor = lazy(() => load().then((m) => ({ default: m.RichCommentEditor })));

/** 入力欄の本体を先に読み込む（校正画面が落ち着いたあと。最初の読み込みは増やさない） */
export function preloadRichComment(): void {
  void load();
}

export function RichCommentField(props: RichCommentFieldProps) {
  return (
    <Suspense
      fallback={
        <div className="rt rt--loading" style={{ "--rt-rows": props.rows ?? 3 } as CSSProperties}>
          <Loading label="入力欄を読み込んでいます" size="small" />
        </div>
      }
    >
      <RichCommentEditor {...props} />
    </Suspense>
  );
}
