import type { MediaType } from "@mf100/domain";
import { useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { PinButton } from "@/features/home/PinButton";
import { preloadViewers } from "@/features/annotation/lazyViewers";
import { useMedia } from "@/lib/useMedia";
import { workHint } from "@/lib/workHint";
import { AppBarSlot } from "@/ui/AppBarSlot";
import { Loading } from "@/ui/Loading";
import { M3eIcon } from "@m3e/react/icon";
import { M3eIconButton } from "@m3e/react/icon-button";
import { M3eToolbar } from "@m3e/react/toolbar";

/**
 * 校正画面（Editor）のコードを取りに行っているあいだの画面（ルートの pendingComponent）。
 * Editor が届く前から、同じ枠（アプリバーの戻る・題名、紙面の指標、スマホの下のツールバー）を同じ場所に出し、
 * Editor に替わっても枠が作り直されたように見えない（読み込み中の指標は Loading が遅れ・形の位相を引き継ぐ）。
 * 利用者指示 2026-10-17「一回の読み込みで3回くらい表示が変わるのヤダ」。docs/UI_M3E.md §65
 * 題名と媒体は、一覧・ホームで押した行の値（workHint）。媒体が分かれば、ビューアの先読みもここから始める。
 */
export function EditorPending({ workId }: { workId: string }) {
  const navigate = useNavigate();
  const mobile = useMedia("(max-width: 839px)");
  const hint = workHint(workId);
  const mediaType = hint?.mediaType;
  useEffect(() => {
    if (mediaType) preloadViewers(mediaType as MediaType);
  }, [mediaType]);
  return (
    <div className="ws ws--panel">
      <AppBarSlot slot="leading">
        <M3eIconButton
          aria-label="制作物一覧へ戻る"
          onClick={() => void navigate({ to: "/works" })}
        >
          <M3eIcon name="arrow_back" className="icon--mirror" />
        </M3eIconButton>
      </AppBarSlot>
      <AppBarSlot slot="title" title={hint?.title ?? ""}>
        {hint?.title ?? ""}
      </AppBarSlot>
      {/* 副題の 1 行は Editor と同じく空で場所だけ取る（題名の位置が、副題が届いたときに動かない） */}
      <AppBarSlot slot="subtitle">{"\u00A0"}</AppBarSlot>
      <AppBarSlot slot="actions">
        <PinButton workId={workId} />
      </AppBarSlot>
      <div className={`ws__body ${mobile ? "" : "ws__body--handle"}`}>
        <div className="ws__viewer ws__viewer--pending">
          <Loading label="制作物を読み込んでいます" className="ws__loading" />
          {mobile ? (
            // Editor の「引き出しの操作」と同じ並び（押せるようになるのは Editor が届いてから。見た目は変えない）
            <M3eToolbar
              className="ws__toolbar"
              shape="rounded"
              elevated
              aria-label="サイドパネルの操作"
              inert
            >
              <div className="ws__toolbar-items">
                {(
                  [
                    ["comment", "コメント"],
                    ["forum", "FB"],
                    ["history", "版"],
                    ["info", "情報"],
                  ] as const
                ).map(([icon, label]) => (
                  <M3eIconButton key={icon} aria-label={label} toggle>
                    <M3eIcon name={icon} />
                  </M3eIconButton>
                ))}
              </div>
            </M3eToolbar>
          ) : null}
        </div>
      </div>
    </div>
  );
}
