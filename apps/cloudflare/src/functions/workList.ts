import { canChangeCreators } from "@mf100/application";
import {
  approvalSetupOf,
  approversOf,
  hasOrgPermission,
  isAllowed,
  nextRevisionPlannedAt,
  orgPermissions,
  overridesAllPermissions,
  type Principal,
  type RevisionGlance,
  type Work,
  type WorkSummary,
} from "@mf100/domain";
import { summaryFromRow } from "../sqlite/derived.ts";
import { Rows } from "../sqlite/docs.ts";
import { substringQuery, workSearchText } from "../sqlite/workSearch.ts";
import type { FnCtx } from "./define.ts";
import { resolveUsers } from "./users.ts";

// apps/convex/convex/works.ts の listMyWorks / listWorksRelatedTo / summarizeWorkList / listMinePage の写し

/** 一覧で読む制作物の上限（Convex の WORKS_SCAN_LIMIT と同じ） */
export const WORKS_SCAN_LIMIT = 2000;

/** 自分が見られる制作物（105A: サインインした委員はすべて）。一覧・ダッシュボードの全件の節で共用 */
export const listMyWorks = (ctx: FnCtx): Promise<Work[]> => ctx.db.works.list(WORKS_SCAN_LIMIT);

/**
 * 職責・割当・許可の索引から、自分に行が出うる制作物だけを読む（ダッシュボードの校正・制作の節）。works の全件は読まない。
 * - workRoles: 自分の職責（制作者・統括・校了者）
 * - grants: 自分（・所属グループ）に edit 以上の、取り消されていない許可がある制作物
 * - assignments: 自分の校正の割当（全状態）と専門確認の担当（全状態）がある、受付中の版の制作物。
 *   要約の受付中の版から引き、要約が無い・受付中の印が無い行は版が open なら含める（Convex と同じ）
 * 並びは works の全件と同じ（追加順）
 *
 * ponytail: Convex の rolesVersion が無い古い行を必ず含める枝は持たない（Cloudflare の works は書込みで必ず職責の表ができる）
 */
export function listWorksRelatedTo(
  ctx: FnCtx,
  principal: Principal,
  opts: { assignments: boolean },
): Work[] {
  const me = principal.userId;
  const sources: string[] = [
    "SELECT workId FROM workRoles WHERE userId = ?",
    `SELECT workId FROM grants
     WHERE json_extract(doc, '$.revokedAt') IS NULL AND json_extract(doc, '$.permission') IN ('edit', 'manage')
       AND ((principalType = 'user' AND principalId = ?)
         OR (principalType = 'group' AND principalId IN (SELECT value FROM json_each(?))))`,
  ];
  const params: (string | number)[] = [me, me, JSON.stringify(principal.groupIds)];
  if (opts.assignments) {
    const mine = `SELECT revisionId FROM assignments WHERE reviewerId = ?
                  UNION SELECT revisionId FROM checks WHERE assigneeId = ?`;
    sources.push(
      `SELECT id FROM workSummaries WHERE acceptingId IN (${mine})`,
      `SELECT r.workId FROM revisions r LEFT JOIN workSummaries s ON s.id = r.workId
       WHERE r.id IN (${mine}) AND r.reviewState = 'open'
         AND (s.id IS NULL OR s.acceptingId IS NULL OR s.acceptingId = r.id)`,
    );
    params.push(me, me, me, me);
  }
  return new Rows<Work>(ctx.sql, "works").select(
    `WHERE id IN (${sources.join(" UNION ")}) ORDER BY rowid`,
    ...params,
  );
}

/** システム管理者はすべての操作ができるので全件。それ以外は職責・割当・許可から */
export function listCandidates(
  ctx: FnCtx,
  principal: Principal,
  opts: { assignments: boolean },
): Promise<Work[]> | Work[] {
  return overridesAllPermissions(principal)
    ? listMyWorks(ctx)
    : listWorksRelatedTo(ctx, principal, opts);
}

export interface WorkFilters {
  year?: number;
  lifecycle?: Work["lifecycle"];
  text?: string;
  genre?: Work["genre"];
}

function summarize(
  work: Work,
  latest: RevisionGlance | null,
  accepting: RevisionGlance | null,
  creators: string[],
  now: number,
) {
  return {
    id: work.id,
    title: work.title,
    legacyId: work.legacyId ?? null,
    category: work.category,
    mediaType: work.mediaType,
    genre: work.genre ?? null,
    subGenre: work.subGenre ?? null,
    tags: [...(work.tags ?? [])],
    year: work.year,
    lifecycle: work.lifecycle,
    deadlineAt: work.deadlineAt ?? null,
    finishAt: work.finishAt ?? null,
    revisionPlannedAt: work.revisionPlannedAt ?? null,
    nextRevisionPlannedAt: nextRevisionPlannedAt(work.revisionPlannedAt, now),
    latestRevisionLabel: latest?.label ?? null,
    acceptingRevisionId: accepting?.id ?? null,
    acceptingDeadlineAt: accepting?.deadlineAt ?? null,
    acceptingReviewUrgent: accepting?.reviewUrgent === true,
    /** 主管担当・制作担当（teams の ID。担当別の表示に使う） */
    ownerTeamId: work.ownerTeamId ?? null,
    productionTeamIds: [...work.productionTeamIds],
    /** 制作者の表示名 */
    creators,
  };
}

/** 制作物ごとの要約。表の行を 1 回の SELECT でまとめて引き、揃っていない・無い行だけ元から数え直す */
async function summariesOf(
  ctx: FnCtx,
  works: readonly Work[],
): Promise<Map<string, Pick<WorkSummary, "latest" | "accepting" | "declared">>> {
  const rows = new Rows<Parameters<typeof summaryFromRow>[0]>(ctx.sql, "workSummaries").select(
    "WHERE id IN (SELECT value FROM json_each(?))",
    JSON.stringify(works.map((w) => w.id)),
  );
  const out = new Map<string, WorkSummary>();
  for (const row of rows) {
    const s = summaryFromRow(row);
    if (s) out.set(row.workId, s);
  }
  for (const w of works)
    if (!out.has(w.id)) {
      const s = await ctx.db.workSummaries.findByWork(w.id);
      if (s) out.set(w.id, s);
    }
  return out;
}

/** 一覧の行（制作物 + 要約 + 制作者・校了者の表示名 + 操作できるか）。並びは受付中の締切 → 題名 */
export async function summarizeWorkList(
  ctx: FnCtx,
  principal: Principal,
  mine: readonly Work[],
  args: WorkFilters,
) {
  const text = args.text?.trim().toLowerCase() ?? "";
  const filtered = mine.filter(
    (work) =>
      (args.year === undefined || work.year === args.year) &&
      (args.lifecycle === undefined || work.lifecycle === args.lifecycle) &&
      (args.genre === undefined || work.genre === args.genre) &&
      (!text || workSearchText(work).includes(text)),
  );
  const summaries = await summariesOf(ctx, filtered);
  const picked = filtered.map((work) => {
    const s = summaries.get(work.id);
    return {
      work,
      latest: s?.latest ?? null,
      accepting: s?.accepting ?? null,
      declared: s?.declared ?? 0,
    };
  });
  // 制作者・校了者の表示名（一覧で「担当別」に並べたとき、誰の制作物か分かるように）
  const users = resolveUsers(
    ctx.sql,
    picked.flatMap((p) => [
      ...p.work.creatorIds,
      ...approversOf(p.work),
      ...(p.work.reviewerIds ?? []),
    ]),
  );
  const canAssignReviewers = hasOrgPermission(principal, orgPermissions.reviewsAssign);
  // 一覧から校了者を直せるか: 校了者を決める権限（approvers:assign）がある人。判定の本体は更新（updateWork）
  const canAssignApprovers = hasOrgPermission(principal, orgPermissions.approversAssign);
  const unknown = "（不明なユーザー）";
  const out = picked.map(({ work, latest, accepting, declared }) => ({
    ...summarize(
      work,
      latest,
      accepting,
      work.creatorIds.map((id) => users.get(id)?.name ?? unknown),
      ctx.now(),
    ),
    /** 校了者の全員（先頭が approverId）と校了とみなす人数、宣言の済んだ人数（2 人以上の進行中のみ） */
    approvers: approversOf(work).map((id) => ({ id, name: users.get(id)?.name ?? unknown })),
    approvalQuorum: approvalSetupOf(work).quorum,
    approvalDeclared: declared,
    /** 統括（managerIds）。SNS の帯など、自分の職責で絞る表示に使う */
    managerIds: [...work.managerIds],
    /** 制作者の ID（校了者の選択肢から外すため。制作者は校了者になれない） */
    creatorIds: [...work.creatorIds],
    canEditApprovers: work.lifecycle !== "finalized" && canAssignApprovers,
    /**
     * 一覧の行メニューから制作物の情報を編集できるか。主管（work.edit の職責）とシステム管理者に限る。
     * ACL の manage を持つ人の判定には制作物ごとの ACL の読み取りが要るので一覧では行わない。校了後は編集できない
     */
    canEdit:
      work.lifecycle !== "finalized" &&
      (overridesAllPermissions(principal) || work.managerIds.includes(principal.userId)),
    canTransferCreators: canChangeCreators(work, principal),
    /** 一覧の「⋮」から中止できるか。統括・校了者・システム管理者だけ（work.cancel） */
    canCancel:
      work.lifecycle !== "finalized" &&
      work.lifecycle !== "cancelled" &&
      isAllowed("work.cancel", { work, grants: [], principal }),
    reviewers: (work.reviewerIds ?? []).map((id) => ({ id, name: users.get(id)?.name ?? unknown })),
    canEditReviewers:
      work.lifecycle !== "finalized" &&
      work.lifecycle !== "cancelled" &&
      (canAssignReviewers ||
        work.creatorIds.includes(principal.userId) ||
        work.managerIds.includes(principal.userId)),
  }));
  return out.sort(
    (a, b) =>
      (a.acceptingDeadlineAt ?? Infinity) - (b.acceptingDeadlineAt ?? Infinity) ||
      a.title.localeCompare(b.title, "ja"),
  );
}

// ------------------------------------------------------------------ ページ

interface SearchCursor {
  phase: "rows" | "unindexed" | "search" | "legacy";
  cursor: string | null;
}

/** text の検索 1 ページ。続きの印は Convex と同じ `{ phase, cursor }` の JSON（cursor は FTS の rowid = works の rowid） */
function searchPage(
  ctx: FnCtx,
  args: WorkFilters & { text: string },
  cursorIn: string | null,
  numItems: number,
): { works: Work[]; isDone: boolean; continueCursor: string } {
  const cursor: SearchCursor = cursorIn ? JSON.parse(cursorIn) : { phase: "rows", cursor: null };
  if (cursor.phase === "unindexed" || cursor.phase === "search" || cursor.phase === "legacy")
    // Convex では移行前の行（検索の行が無い制作物）を順に読む段と、古い続きの印。Cloudflare に検索の行が無い制作物は無いので、そこで終える
    return { works: [], isDone: true, continueCursor: JSON.stringify(cursor) };
  if (cursor.phase !== "rows") throw new Error("invalid_cursor");
  const after = cursor.cursor === null ? 0 : Number(cursor.cursor);
  if (!Number.isFinite(after)) throw new Error("invalid_cursor");
  const rows = ctx.sql.exec(
    `SELECT rowid AS rid FROM workSearch
     WHERE workSearch MATCH ? AND rowid > ?
       AND (? IS NULL OR year = ?) AND (? IS NULL OR lifecycle = ?)
     ORDER BY rowid LIMIT ?`,
    `"${substringQuery(args.text)}"`,
    after,
    args.year ?? null,
    args.year ?? null,
    args.lifecycle ?? null,
    args.lifecycle ?? null,
    numItems + 1,
  );
  const hit = rows.slice(0, numItems).map((r) => r.rid as number);
  const works = new Rows<Work>(ctx.sql, "works").select(
    "WHERE rowid IN (SELECT value FROM json_each(?)) ORDER BY rowid",
    JSON.stringify(hit),
  );
  const isDone = rows.length <= numItems;
  return {
    works,
    isDone,
    // Convex は索引を読み切ると「移行前の行」の段へ進む（isDone:false）。ここはその段が空なので、読み切ったらすぐ終える
    continueCursor: JSON.stringify(
      isDone
        ? ({ phase: "unindexed", cursor: null } satisfies SearchCursor)
        : ({ phase: "rows", cursor: String(hit.at(-1)) } satisfies SearchCursor),
    ),
  };
}

/** text なしの 1 ページ。続きの印は works の rowid（追加順。Convex の作成順と同じ並び） */
function rowsPage(
  ctx: FnCtx,
  args: WorkFilters,
  cursorIn: string | null,
  numItems: number,
): { works: Work[]; isDone: boolean; continueCursor: string } {
  const after = cursorIn === null ? 0 : Number(cursorIn);
  if (!Number.isFinite(after)) throw new Error("invalid_cursor");
  const rows = ctx.sql.exec(
    `SELECT rowid AS rid, doc FROM works
     WHERE rowid > ? AND (? IS NULL OR year = ?) AND (? IS NULL OR lifecycle = ?)
     ORDER BY rowid LIMIT ?`,
    after,
    args.year ?? null,
    args.year ?? null,
    args.lifecycle ?? null,
    args.lifecycle ?? null,
    numItems + 1,
  );
  const page = rows.slice(0, numItems);
  return {
    works: page.map((r) => JSON.parse(r.doc as string) as Work),
    isDone: rows.length <= numItems,
    continueCursor: String(page.length ? (page.at(-1)!.rid as number) : after),
  };
}

/**
 * 一覧の 1 ページ。year / lifecycle は索引で絞り、genre / text の絞り込みはページの後（summarizeWorkList）で行う。
 * だからページは numItems より短い・空のことがある。続きは isDone まで continueCursor で読む
 */
export async function listMinePageOf(
  ctx: FnCtx,
  principal: Principal,
  args: WorkFilters & { paginationOpts: { numItems: number; cursor: string | null } },
) {
  const numItems = Math.max(1, Math.floor(args.paginationOpts.numItems));
  const search = args.text?.trim();
  const { works, isDone, continueCursor } = search
    ? searchPage(ctx, { ...args, text: search }, args.paginationOpts.cursor, numItems)
    : rowsPage(ctx, args, args.paginationOpts.cursor, numItems);
  return { page: await summarizeWorkList(ctx, principal, works, args), isDone, continueCursor };
}
