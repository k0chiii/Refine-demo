import { api } from "@mf100/convex/api";
import { useQuery } from "convex/react";
import { useState } from "react";
import { formatJstCompact } from "@/lib/format";
import { M3eBadge } from "@m3e/react/badge";
import { M3eFilterChip, M3eFilterChipSet } from "@m3e/react/chips";
import { M3eIcon } from "@m3e/react/icon";
import { M3eActionList, M3eListAction } from "@m3e/react/list";
import { M3eSearchBar } from "@m3e/react/search";

const mediaIcon: Record<string, string> = {
  pdf: "picture_as_pdf",
  image: "image",
  document: "article",
  sns: "share",
  video: "movie",
  web: "language",
  figma: "design_services",
};

const normalize = (s: string) => s.normalize("NFKC").toLowerCase();

/**
 * FB スペースの一覧（制作物ごとに 1 つ。Slack のチャンネル一覧に当たる。利用者決定 2026-10-16）。
 * 新しい投稿のあったスペースが上。未読のあるスペースは題名を強調し、末尾に未読の数（色だけに頼らず数で示す）。
 * スレッドの無い制作物も並べ、そこから最初のスレッドを立てられる。
 */
export function FeedbackSpaceList({
  selectedWorkId,
  onOpen,
}: {
  selectedWorkId?: string;
  onOpen: (workId: string) => void;
}) {
  const spaces = useQuery(api.feedback.listSpaces, {});
  const [query, setQuery] = useState("");
  const [unreadOnly, setUnreadOnly] = useState(false);
  const q = normalize(query.trim());
  const shown = spaces?.filter(
    (s) => (!unreadOnly || s.unread > 0) && (!q || normalize(s.title).includes(q)),
  );
  return (
    <div className="fb-spaces">
      <M3eSearchBar className="search fb-spaces__search" clearable onClear={() => setQuery("")}>
        <M3eIcon slot="leading" name="search" />
        <input
          slot="input"
          placeholder="制作物を探す"
          aria-label="FB スペース（制作物）を探す"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </M3eSearchBar>
      <M3eFilterChipSet aria-label="絞り込み" className="fb-spaces__filters">
        <M3eFilterChip selected={unreadOnly} onClick={() => setUnreadOnly((v) => !v)}>
          未読あり
        </M3eFilterChip>
      </M3eFilterChipSet>
      {shown === undefined ? (
        <p className="muted fb-spaces__empty">読み込み中…</p>
      ) : shown.length === 0 ? (
        <p className="muted fb-spaces__empty">
          {q ? `「${query.trim()}」に合う制作物はありません` : "FB スペースはまだありません"}
        </p>
      ) : (
        <M3eActionList className="list fb-spaces__list" aria-label="FB スペース">
          {shown.map((s) => (
            <M3eListAction
              key={s.workId}
              className={`list__item fb-spaces__item ${s.unread ? "list__item--unread" : ""} ${
                s.workId === selectedWorkId ? "fb-list__item--selected" : ""
              }`}
              {...(s.workId === selectedWorkId ? { "aria-current": "true" } : {})}
              onClick={() => onOpen(s.workId)}
            >
              <span slot="leading" className="fb-spaces__icon" aria-hidden="true">
                <M3eIcon name={mediaIcon[s.mediaType] ?? "draft"} />
              </span>
              <span className="list__headline">
                {s.title}
                {s.confidentiality === "restricted" ? "（非公開）" : ""}
              </span>
              <span slot="supporting-text">
                {s.threads ? `スレッド ${s.threads}` : "スレッドなし"}
                {s.latestRevision ? `・${s.latestRevision.label}` : ""}
              </span>
              <span slot="trailing" className="fb-list__trailing">
                {s.lastPostAt ? (
                  <span className="fb-list__time">{formatJstCompact(s.lastPostAt)}</span>
                ) : null}
                {s.unread ? (
                  <M3eBadge
                    size="medium"
                    className="fb-spaces__badge"
                    aria-label={`未読 ${s.unread} 件`}
                  >
                    {s.unread > 99 ? "99+" : s.unread}
                  </M3eBadge>
                ) : null}
              </span>
            </M3eListAction>
          ))}
        </M3eActionList>
      )}
    </div>
  );
}
