import { figmaDeepLink, type WebAnchorState } from "@mf100/domain";
import { M3eIcon } from "@m3e/react/icon";
import { resolutionLabel, severityLabel } from "@/lib/labels";
import { StatusText } from "@/ui/Chip";
import { isClosed, type Thread } from "./thread";

/** カードの状態の行（解決済み・重大・持ち越し・担当・位置が外れた…）を出す必要があるか */
export function hasThreadMeta(t: Thread, placeState: WebAnchorState | undefined): boolean {
  return (
    (!isClosed(t) && t.resolution !== "open") ||
    isClosed(t) ||
    t.severity === "critical" ||
    Boolean(t.carriedFromThreadId) ||
    Boolean(t.assignee) ||
    Boolean(t.origin?.needsReview) ||
    t.origin?.textSource === "ocr" ||
    (placeState !== undefined && placeState !== "attached") ||
    t.anchor?.type === "figma_node"
  );
}

/**
 * スレッドの状態の行（一覧のカードとスレッドのパネルで同じもの）。状態は文字＋アイコン
 * （M3 の chip は操作の部品なので、ただの表示には使わない。§49）。
 * Web のライブ表示: 要素が見つからない（位置が外れた）・文字で見つけた（動いた）。消さずに注記する（WB-05）
 */
export function ThreadMeta({
  thread: t,
  placeState,
}: {
  thread: Thread;
  placeState?: WebAnchorState | undefined;
}) {
  if (!hasThreadMeta(t, placeState)) return null;
  const closed = isClosed(t);
  return (
    <div className="thread__meta">
      {placeState === "detached" ? (
        <StatusText tone="error" icon="location_off">
          位置が外れました（要素が見つかりません）
        </StatusText>
      ) : placeState === "moved" ? (
        <StatusText tone="warning" icon="move_down">
          文字で見つけた位置に出しています
        </StatusText>
      ) : null}
      {t.anchor?.type === "figma_node" ? (
        <a
          className="thread__link"
          href={figmaDeepLink({
            kind: "design",
            fileKey: t.anchor.fileKey,
            nodeId: t.anchor.nodeId,
          })}
          target="_blank"
          rel="noreferrer noopener"
          onClick={(e) => e.stopPropagation()}
        >
          <M3eIcon name="open_in_new" />
          Figma で開く
        </a>
      ) : null}
      {t.origin?.needsReview ? <StatusText icon="help">要確認</StatusText> : null}
      {t.origin?.textSource === "ocr" ? (
        <StatusText icon="document_scanner">画像から読み取り</StatusText>
      ) : null}
      {!closed && t.resolution !== "open" ? (
        <StatusText tone="neutral" icon="pending">
          {resolutionLabel[t.resolution]}
        </StatusText>
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
  );
}
