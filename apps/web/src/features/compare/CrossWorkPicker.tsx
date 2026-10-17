import { api } from "@mf100/convex/api";
import { useQuery } from "convex/react";
import { useEffect, useMemo, useState } from "react";
import { formatJstShort } from "@/lib/format";
import { lifecycleLabel, mediaLabel, reviewStateLabel } from "@/lib/labels";
import { Loading } from "@/ui/Loading";
import {
  M3eActionList,
  M3eButton,
  M3eDialog,
  M3eIcon,
  M3eListAction,
  M3eSearchBar,
} from "@/ui/m3e";

const mediaIcon: Record<string, string> = {
  pdf: "picture_as_pdf",
  image: "image",
  document: "article",
  sns: "share",
  video: "movie",
  web: "language",
  figma: "design_services",
};

/**
 * 「別の制作物と比べる」（利用者指示 2026-10-17）。表示中の版の左に、別の制作物の版を置いて比べる相手を選ぶ。
 * 1) 自分が見られる制作物を検索して選ぶ（制作物一覧と同じ `works.listMine`。見られない制作物は出ない）
 * 2) その制作物の版を選ぶ（無効にした版は除く。最新の版が選ばれた状態で開く）→「比べる」
 * 広い画面は M3 の基本ダイアログ、compact は全画面（`.dialog--full`。M3 Dialogs: compact の複雑な選択は全画面）。
 */
export function CrossWorkPicker({
  open,
  onClose,
  currentWorkId,
  onPick,
}: {
  open: boolean;
  onClose: () => void;
  /** 表示中の制作物（候補から除く。同じ制作物の版は引き出し「版」の「比較」で選ぶ） */
  currentWorkId: string;
  /** 選んだ版（別の制作物）で比較を始める */
  onPick: (revisionId: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [workId, setWorkId] = useState<string | null>(null);
  const [revisionId, setRevisionId] = useState<string | null>(null);
  // 開くたびに最初の段階（制作物を探す）から
  useEffect(() => {
    if (!open) return;
    setQuery("");
    setWorkId(null);
    setRevisionId(null);
  }, [open]);
  const text = query.trim();
  const works = useQuery(api.works.listMine, open ? (text ? { text } : {}) : "skip");
  const candidates = useMemo(
    () => (works ?? []).filter((w) => w.id !== currentWorkId),
    [works, currentWorkId],
  );
  const picked = useQuery(api.works.get, workId ? { workId } : "skip");
  const revisions = useMemo(
    () =>
      (picked && picked.work.id === workId ? picked.revisions : [])
        .filter((r) => r.reviewState !== "void")
        .sort((a, b) => b.submittedAt - a.submittedAt),
    [picked, workId],
  );
  // 最新の版（最後に提出されたもの）を選んだ状態にしておく
  const latestId = revisions[0]?.id ?? null;
  const selected = revisionId && revisions.some((r) => r.id === revisionId) ? revisionId : latestId;
  const title = workId ? (picked?.work.title ?? "…") : "別の制作物と比べる";

  return (
    <M3eDialog
      open={open}
      onClosed={onClose}
      closeLabel="閉じる"
      className="dialog--full cross-picker"
    >
      <span slot="header">{title}</span>
      <div className="dialog-body cross-picker__body">
        {!open ? null : workId === null ? (
          <>
            <M3eSearchBar
              className="search cross-picker__search"
              clearable
              onClear={() => setQuery("")}
            >
              <M3eIcon slot="leading" name="search" />
              <input
                slot="input"
                placeholder="制作物を探す"
                aria-label="比べる制作物を探す"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </M3eSearchBar>
            <p className="small muted cross-picker__hint">
              あなたが見られる制作物から選びます。選んだ制作物の版が左、いま開いている版が右に並びます。
            </p>
            {works === undefined ? (
              <Loading size="small" label="制作物を読み込んでいます" />
            ) : candidates.length === 0 ? (
              <p className="muted small cross-picker__empty">
                {text ? `「${text}」に合う制作物はありません` : "比べられる制作物はありません"}
              </p>
            ) : (
              <M3eActionList className="list cross-picker__list" aria-label="比べる制作物">
                {candidates.map((w) => (
                  <M3eListAction
                    key={w.id}
                    className="list__item"
                    disabled={w.latestRevisionLabel === null}
                    onClick={() => {
                      setWorkId(w.id);
                      setRevisionId(null);
                    }}
                  >
                    <M3eIcon slot="leading" name={mediaIcon[w.mediaType] ?? "draft"} />
                    <span className="list__headline">{w.title}</span>
                    <span slot="supporting-text">
                      {[
                        mediaLabel[w.mediaType] ?? w.mediaType,
                        w.latestRevisionLabel
                          ? `最新 ${w.latestRevisionLabel}`
                          : "まだ版がありません",
                        w.lifecycle !== "active" ? (lifecycleLabel[w.lifecycle] ?? null) : null,
                      ]
                        .filter(Boolean)
                        .join("・")}
                    </span>
                  </M3eListAction>
                ))}
              </M3eActionList>
            )}
          </>
        ) : (
          <>
            <p className="small muted cross-picker__hint">
              比べる版を選びます（最新の版が選ばれています）
            </p>
            {picked === undefined ? (
              <Loading size="small" label="版を読み込んでいます" />
            ) : revisions.length === 0 ? (
              <p className="muted small cross-picker__empty">この制作物にはまだ版がありません</p>
            ) : (
              <M3eActionList className="list cross-picker__list" aria-label="比べる版">
                {revisions.map((r, i) => {
                  const on = r.id === selected;
                  return (
                    <M3eListAction
                      key={r.id}
                      className={`list__item ${on ? "list__item--selected" : ""}`}
                      aria-pressed={on}
                      onClick={() => setRevisionId(r.id)}
                    >
                      <M3eIcon slot="leading" name={on ? "check" : "history"} />
                      <span className="list__headline">
                        {r.label}
                        {i === 0 ? <span className="meta ml">最新</span> : null}
                        {picked.work.finalRevisionId === r.id ? (
                          <span className="meta ml">校了版</span>
                        ) : null}
                      </span>
                      <span slot="supporting-text">
                        {reviewStateLabel[r.reviewState] ?? r.reviewState}・{r.submitter?.name}・
                        {formatJstShort(r.submittedAt)}
                        {r.changeSummary ? `・${r.changeSummary}` : ""}
                      </span>
                    </M3eListAction>
                  );
                })}
              </M3eActionList>
            )}
          </>
        )}
      </div>
      <div slot="actions" className="row">
        {workId === null ? (
          <M3eButton variant="text" onClick={onClose}>
            キャンセル
          </M3eButton>
        ) : (
          <>
            <M3eButton variant="text" onClick={() => setWorkId(null)}>
              <M3eIcon slot="icon" name="arrow_back" className="icon--mirror" />
              制作物を選び直す
            </M3eButton>
            <span className="spacer" />
            <M3eButton
              variant="filled"
              disabled={selected === null}
              onClick={() => {
                if (!selected) return;
                onClose();
                onPick(selected);
              }}
            >
              <M3eIcon slot="icon" name="compare" />
              比べる
            </M3eButton>
          </>
        )}
      </div>
    </M3eDialog>
  );
}
