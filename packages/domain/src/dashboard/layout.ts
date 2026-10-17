/**
 * 自分だけのダッシュボード（W-26。利用者決定 2026-10-15「役割で自動に組み、並べ替え・非表示ができる」）。
 * 節（widget）の並び・表示・件数をアカウントごとに保存する。ここは保存値の正規化と並べ替えの純粋関数だけを持つ。
 * 既定の構成（どの役割にどの節を先に出すか）はアプリケーション層のポリシー値（`dashboardLayoutPolicy`）。
 *
 * - 保存値に知らない ID があれば捨てる（節を廃止しても壊れない）。重複は先のものだけ残す
 * - 保存値に無い節（あとから足した節）は既定の値で末尾に足す
 * - 並べ替えはドラッグを使わず上下の操作（WCAG 2.5.7。M3E に並べ替えの部品が無い）
 */
export const dashboardWidgetIds = [
  "submit",
  "review",
  "respond",
  "checks",
  "finalize",
  "assign",
  "deadlines",
  "mentions",
  "pinned",
  "recent",
  "backlog",
] as const;
export type DashboardWidgetId = (typeof dashboardWidgetIds)[number];

/**
 * 2 列（expanded 以上）のどちらに置くか。左は「やること」（主目的）、右は補助
 * （M3 Canonical layouts › Feed。利用者決定 2026-10-15「expanded 以上は 2 列」）。compact は 1 列で並び順どおり。
 */
export const dashboardWidgetColumn: Record<DashboardWidgetId, "todo" | "side"> = {
  submit: "todo",
  review: "todo",
  respond: "todo",
  checks: "todo",
  finalize: "todo",
  assign: "todo",
  deadlines: "side",
  mentions: "side",
  pinned: "side",
  recent: "side",
  backlog: "side",
};

/** 表示件数: 3・5・すべて（null） */
export const dashboardLimits = [3, 5, null] as const;
export type DashboardLimit = (typeof dashboardLimits)[number];

export interface DashboardWidgetPref {
  id: DashboardWidgetId;
  visible: boolean;
  limit: DashboardLimit;
}

export function isDashboardWidgetId(id: unknown): id is DashboardWidgetId {
  return typeof id === "string" && (dashboardWidgetIds as readonly string[]).includes(id);
}

function normalizeLimit(limit: unknown, fallback: DashboardLimit): DashboardLimit {
  if (limit === null) return null;
  return limit === 3 || limit === 5 ? limit : fallback;
}

/**
 * 保存値（形を信用しない）と既定の構成から、画面で使う構成を作る。
 * 既定の構成に無い節は出さない（既定がすべての節を並べる前提。並べない節は visible: false で渡す）。
 */
export function normalizeDashboardLayout(
  saved: ReadonlyArray<{ id: unknown; visible?: unknown; limit?: unknown }> | null | undefined,
  defaults: readonly DashboardWidgetPref[],
): DashboardWidgetPref[] {
  const byId = new Map(defaults.map((d) => [d.id, d]));
  const out: DashboardWidgetPref[] = [];
  const seen = new Set<string>();
  for (const w of saved ?? []) {
    if (!isDashboardWidgetId(w.id) || seen.has(w.id)) continue;
    const base = byId.get(w.id);
    if (!base) continue;
    seen.add(w.id);
    out.push({
      id: w.id,
      visible: typeof w.visible === "boolean" ? w.visible : base.visible,
      limit: normalizeLimit(w.limit, base.limit),
    });
  }
  for (const d of defaults) if (!seen.has(d.id)) out.push({ ...d });
  return out;
}

/** 節を 1 つ上（-1）・下（+1）へ。端ではそのまま */
export function moveDashboardWidget(
  layout: readonly DashboardWidgetPref[],
  id: DashboardWidgetId,
  dir: -1 | 1,
): DashboardWidgetPref[] {
  const out = layout.map((w) => ({ ...w }));
  const i = out.findIndex((w) => w.id === id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= out.length) return out;
  [out[i], out[j]] = [out[j]!, out[i]!];
  return out;
}

/**
 * 仲間（`isPeer` が真の節）の中で 1 つ上・下へ。間にある仲間でない節（隠した節・空の節・別の列の節）は飛ばす。
 * 画面の「上へ／下へ」は、いま出ている節（2 列のときは同じ列の節）を仲間にして使う
 */
export function moveDashboardWidgetAmong(
  layout: readonly DashboardWidgetPref[],
  id: DashboardWidgetId,
  dir: -1 | 1,
  isPeer: (w: DashboardWidgetPref) => boolean,
): DashboardWidgetPref[] {
  const out = layout.map((w) => ({ ...w }));
  const i = out.findIndex((w) => w.id === id);
  if (i < 0) return out;
  let j = i + dir;
  while (j >= 0 && j < out.length && !isPeer(out[j]!)) j += dir;
  if (j < 0 || j >= out.length) return out;
  const [moved] = out.splice(i, 1);
  out.splice(j, 0, moved!);
  return out;
}

export function updateDashboardWidget(
  layout: readonly DashboardWidgetPref[],
  id: DashboardWidgetId,
  patch: Partial<Pick<DashboardWidgetPref, "visible" | "limit">>,
): DashboardWidgetPref[] {
  return layout.map((w) => (w.id === id ? { ...w, ...patch } : { ...w }));
}

/** 件数の上限で切る（null はすべて） */
export function limitDashboardItems<T>(items: readonly T[], limit: DashboardLimit): T[] {
  return limit === null ? [...items] : items.slice(0, limit);
}
