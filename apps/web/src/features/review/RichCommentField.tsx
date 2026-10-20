import { lazy, Suspense, type CSSProperties, type ReactNode, type Ref } from "react";
import { Loading } from "@/ui/Loading";
import { FieldOutline } from "./FieldOutline";

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
  /** 空のときの案内 */
  placeholder?: string;
  id?: string;
  /** 開いたときにフォーカスして末尾へ */
  autoFocus?: boolean;
  /** 最小の高さ（行数）。既定は 2 行 */
  rows?: number;
  /** 下の操作の行（左）に並べる、ファイルを添付するボタン */
  attach?: ReactNode;
  /** 本文と下の操作の行のあいだに並べる、これから添える添付 */
  attachments?: ReactNode;
  /** 下の操作の行（右・送る前）に置く、投稿以外の操作 */
  extra?: ReactNode;
  /** やめる。文字（cancelLabel）があれば右の文字のボタン、無ければ左の閉じるアイコン。省くと出さない */
  onCancel?: () => void;
  cancelLabel?: string;
  /** 送る。text なら文字のボタン（label が文字）、無ければ送信アイコン（label は読み上げの名前） */
  send: {
    label: string;
    text?: boolean;
    /** 送れる内容がある（アイコンを主色で塗る） */
    ready: boolean;
    disabled: boolean;
    onSend: () => void;
  };
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
        <div
          className="rt rt--composer rt--loading"
          style={{ "--rt-rows": props.rows ?? 2 } as CSSProperties}
        >
          <FieldOutline />
          <Loading label="入力欄を読み込んでいます" size="small" />
        </div>
      }
    >
      <RichCommentEditor {...props} />
    </Suspense>
  );
}
