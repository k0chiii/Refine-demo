import type { api } from "@mf100/convex/api";
import {
  teamPath,
  type Team,
  type WorkSortDir,
  type WorkSortKey,
  type WorkStage,
} from "@mf100/domain";
import { Link } from "@tanstack/react-router";
import type { FunctionReturnType } from "convex/server";
import { useEffect, useState } from "react";
import { formatDeadline, remaining } from "@/lib/format";
import { lifecycleLabel } from "@/lib/labels";
import { stageInfo } from "@/lib/stageInfo";
import { rememberWorkHint } from "@/lib/workHint";
import { StatusText } from "@/ui/Chip";
import { ColumnHeader, DataTable, pageSlice, TablePager } from "@/ui/DataTable";
import { M3eIcon } from "@m3e/react/icon";
import { ApproversCell } from "./ApproversCell";
import { DuplicateWorkDialog } from "./DuplicateWorkDialog";
import { EditWorkById } from "./EditWorkDialog";
import { TransferCreatorsById } from "./TransferCreatorsDialog";
import { ReviewersCell } from "./ReviewersCell";
import { WorkRowMenu } from "./WorkRowMenu";

export type WorkRow = FunctionReturnType<typeof api.works.listMine>[number] & {
  /** 段階（domain の workStageOf。下書き・中止は null） */
  stage: WorkStage | null;
};

const mediaIcon: Record<string, string> = {
  pdf: "picture_as_pdf",
  image: "image",
  document: "article",
  sns: "share",
  video: "movie",
  web: "language",
  figma: "design_services",
};

/** 1 ページの件数の初期値（M3E の paginator の選択肢 10・25・50・100 のうち） */
const DEFAULT_PAGE_SIZE = 25;

/**
 * 制作物一覧の表（利用者決定 2026-10-18「制作物一覧も表がいいかも」。共通の表 ui/DataTable。docs/UI_M3E.md §75）。
 * 並べる順と絞り込みは呼び出し側（domain の sortWorks・workBelongsToTeam）。見出しを押すと `onSort`（題名・状態・校正の締切・納期・
 * 主管担当・制作担当。もう一度押すと向きが逆）。校了者のセルは、編集できる人には押せて、校了者の選択を開く（ApproversCell）。
 * - 題名は制作物へのリンク（Tab・Enter で開ける）。行のほかの場所を押しても開く（`onOpen`）
 * - 狭い幅では列を隠す（コンテナクエリ）。状態・版は題名の下に移る。スマホは 題名 + 校正の締切 の 2 列
 * - 件数が多いときは M3E の paginator（最小の 10 件を超えるとき）。並べ替え・絞り込みが変わったら 1 ページ目へ戻る
 * - 縦に収める（medium 以上）と見出しが貼り付き、ページ送りは表の下に残る
 * - 行の末尾に「⋮」（WorkRowMenu）: 情報の編集（主管）と複製（登録の権限のある人。`canDuplicate`）。ダイアログは表の外に 1 つずつ置く
 */
export function WorksTable({
  works,
  teams,
  sort,
  dir,
  resetKey,
  compact,
  canDuplicate = false,
  onSort,
  onOpen,
}: {
  works: readonly WorkRow[];
  teams: readonly Team[];
  sort: WorkSortKey;
  dir: WorkSortDir;
  /** これが変わったら 1 ページ目に戻す（絞り込み・検索・並べ替えの組） */
  resetKey: string;
  compact: boolean;
  /** 行メニューに「複製」を出す（制作物を登録できる人） */
  canDuplicate?: boolean;
  onSort: (key: WorkSortKey) => void;
  onOpen: (workId: string) => void;
}) {
  const [page, setPage] = useState({ index: 0, size: DEFAULT_PAGE_SIZE });
  /** 行メニューから開いているダイアログ（編集・複製）。表の外に 1 つだけ置く */
  const [dialog, setDialog] = useState<{
    kind: "edit" | "duplicate" | "transferCreators";
    workId: string;
  } | null>(null);
  useEffect(() => setPage((p) => (p.index === 0 ? p : { ...p, index: 0 })), [resetKey]);
  const { index, rows } = pageSlice(works, page.index, page.size);
  const now = Date.now();
  const hasTeams = teams.length > 0;
  const header = (key: WorkSortKey, text: string, className = "") => (
    <ColumnHeader
      className={className}
      sort={{ active: sort === key, dir, onSort: () => onSort(key) }}
    >
      {text}
    </ColumnHeader>
  );
  return (
    <>
      <DataTable
        label="制作物一覧"
        className="works-table"
        footer={
          works.length > 10 ? (
            <TablePager
              length={works.length}
              pageIndex={index}
              pageSize={page.size}
              compact={compact}
              onPage={(i, size) => setPage({ index: i, size })}
            />
          ) : null
        }
      >
        <thead>
          <tr>
            {header("title", "制作物名")}
            {header("stage", "状態", "works-table__col--stage")}
            <ColumnHeader className="works-table__col--version">版</ColumnHeader>
            {header("accepting", "校正期日")}
            {header("deadline", "◆校了目標日", "works-table__col--delivery")}
            {hasTeams ? header("owner", "担当", "works-table__col--owner") : null}
            {hasTeams ? header("production", "制作担当", "works-table__col--production") : null}
            <ColumnHeader className="works-table__col--creators">制作者</ColumnHeader>
            <ColumnHeader className="works-table__col--reviewers">校正者</ColumnHeader>
            <ColumnHeader className="works-table__col--approvers">校了する人</ColumnHeader>
            {/* 見出しの文字は読み上げだけ（aria-label は span に付けられない: aria-prohibited-attr） */}
            <ColumnHeader className="works-table__col--actions">
              <span className="sr-only">操作</span>
            </ColumnHeader>
          </tr>
        </thead>
        <tbody>
          {rows.map((w) => (
            <Row
              key={w.id}
              w={w}
              teams={teams}
              hasTeams={hasTeams}
              now={now}
              compact={compact}
              canDuplicate={canDuplicate}
              onOpen={onOpen}
              onEdit={() => setDialog({ kind: "edit", workId: w.id })}
              onTransferCreators={() => setDialog({ kind: "transferCreators", workId: w.id })}
              onDuplicate={() => setDialog({ kind: "duplicate", workId: w.id })}
            />
          ))}
        </tbody>
      </DataTable>
      {dialog?.kind === "edit" ? (
        <EditWorkById key={dialog.workId} workId={dialog.workId} onClose={() => setDialog(null)} />
      ) : null}
      {dialog?.kind === "duplicate" ? (
        <DuplicateWorkDialog
          key={dialog.workId}
          sourceWorkId={dialog.workId}
          onClose={() => setDialog(null)}
        />
      ) : null}
      {dialog?.kind === "transferCreators" ? (
        <TransferCreatorsById
          key={dialog.workId}
          workId={dialog.workId}
          onClose={() => setDialog(null)}
        />
      ) : null}
    </>
  );
}

function Row({
  w,
  teams,
  hasTeams,
  now,
  compact,
  canDuplicate,
  onOpen,
  onEdit,
  onTransferCreators,
  onDuplicate,
}: {
  w: WorkRow;
  teams: readonly Team[];
  hasTeams: boolean;
  now: number;
  compact: boolean;
  canDuplicate: boolean;
  onOpen: (workId: string) => void;
  onEdit: () => void;
  onTransferCreators: () => void;
  onDuplicate: () => void;
}) {
  const done = w.lifecycle === "finalized" || w.lifecycle === "cancelled";
  const info = w.stage ? stageInfo[w.stage] : null;
  const stage = info ? (
    <StatusText tone={info.tone} icon={info.icon}>
      {info.label}
    </StatusText>
  ) : (
    <span className="meta">{lifecycleLabel[w.lifecycle] ?? w.lifecycle}</span>
  );
  return (
    <tr
      className={`mf-table__row mf-table__row--action ${done ? "mf-table__row--off" : ""}`}
      onClick={(e) => {
        // リンク（題名）はそれ自身で開く。行の中のボタン・メニュー（校了者・校正者・⋮）は自分の操作をする。
        // 行のほかの場所を押したときだけ開く
        if ((e.target as HTMLElement).closest("a, button, m3e-icon-button, m3e-menu")) return;
        onOpen(w.id);
      }}
    >
      <th scope="row" className="mf-table__td mf-table__title">
        <div className="works-table__head">
          <M3eIcon name={mediaIcon[w.mediaType] ?? "draft"} className="works-table__media" />
          <span className="works-table__name">
            <Link
              to="/works/$workId"
              params={{ workId: w.id }}
              className="mf-table__link"
              onClick={() => rememberWorkHint(w.id, { title: w.title, mediaType: w.mediaType })}
            >
              {w.title}
              {w.confidentiality === "restricted" ? (
                <M3eIcon
                  name="lock"
                  className="works-table__lock"
                  role="img"
                  aria-label="非公開"
                  title="非公開"
                />
              ) : null}
            </Link>
            {/* 状態・版の列が隠れる幅では、題名の下に出す */}
            <span className="mf-table__sub works-table__inline">
              <span className="works-table__in works-table__in--stage">{stage}</span>
              {w.latestRevisionLabel ? (
                <span className="works-table__in works-table__in--version">
                  {w.latestRevisionLabel}
                </span>
              ) : null}
            </span>
          </span>
        </div>
      </th>
      <td className="mf-table__td works-table__col--stage">{stage}</td>
      <td className="mf-table__td works-table__col--version">
        {w.latestRevisionLabel ?? <span className="muted">—</span>}
        {w.nextRevisionPlannedAt ? (
          <span className="mf-table__sub">
            予定提出 {formatDeadline(w.nextRevisionPlannedAt, now)}
          </span>
        ) : null}
      </td>
      <td className="mf-table__td">
        {w.acceptingDeadlineAt ? (
          <>
            <span className="works-table__date">{formatDeadline(w.acceptingDeadlineAt, now)}</span>
            <span className="mf-table__sub">{remaining(w.acceptingDeadlineAt, now)}</span>
          </>
        ) : (
          <span className="muted">—</span>
        )}
      </td>
      <td className="mf-table__td works-table__col--delivery">
        {w.deadlineAt ? (
          <span className="works-table__date">{formatDeadline(w.deadlineAt, now)}</span>
        ) : (
          <span className="muted">—</span>
        )}
      </td>
      {hasTeams ? (
        <td className="mf-table__td works-table__col--owner">
          <Clip text={w.ownerTeamId ? teamPath(w.ownerTeamId, teams) : null} />
        </td>
      ) : null}
      {hasTeams ? (
        <td className="mf-table__td works-table__col--production">
          <Clip
            text={
              w.productionTeamIds
                .map((id) => teamPath(id, teams))
                .filter((n): n is string => n !== null)
                .join("、") || null
            }
          />
        </td>
      ) : null}
      <td className="mf-table__td works-table__col--creators">
        <Clip text={w.creators.join("、") || null} />
      </td>
      <td className="mf-table__td works-table__col--reviewers">
        <ReviewersCell w={w} />
      </td>
      <td className="mf-table__td works-table__col--approvers">
        <ApproversCell w={w} />
      </td>
      <td className="mf-table__td works-table__col--actions" onClick={(e) => e.stopPropagation()}>
        <WorkRowMenu
          w={w}
          canDuplicate={canDuplicate}
          compact={compact}
          onEdit={onEdit}
          onTransferCreators={onTransferCreators}
          onDuplicate={onDuplicate}
        />
      </td>
    </tr>
  );
}

/** 長い文字は省略記号で切る（全文は title。無ければ「—」） */
function Clip({ text }: { text: string | null }) {
  return text ? (
    <span className="mf-table__clip works-table__clip" title={text}>
      {text}
    </span>
  ) : (
    <span className="muted">—</span>
  );
}
