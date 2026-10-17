import {
  canAssignManagers,
  defaultRuleCategories,
  DomainError,
  notationRole,
  neutralProposalTitle,
  proposalDedupeKey,
  publicProposalTitle,
  resolveRuleSet,
  restoreRuleSet,
  ruleStrictness,
  snapshotOf,
  validateRuleDraft,
  type EffectiveRule,
  type ExceptionCondition,
  type NotationRole,
  type NotationRule,
  type Principal,
  type ProposalContext,
  type ProposalKind,
  type RuleCategory,
  type RuleDraft,
  type RuleOperation,
  type RuleProposal,
  type RuleRevision,
  type RuleSetSnapshot,
} from "@mf100/domain";
import type { AppContext } from "../ports.ts";
import { loadAuthorizedWork } from "../shared.ts";
import { excerpt, notify, personName } from "./notifications.ts";

/**
 * 表記統一ルールの管理（閲覧・編集・無効化・履歴・カテゴリ・カテゴリ管理者・取り込み・変更提案）。
 * 権限はすべてここで判定する（画面のボタンの出し分けは補助）。
 * - 閲覧・提案・報告: ログインしている人なら誰でも
 * - ルールの編集・提案の承認: そのカテゴリの管理者（またはシステム管理者・notation:manage）
 * - カテゴリの追加・継承の変更・カテゴリ管理者の設定: システム管理者（または notation:manage）
 */

/** 保存済みのカテゴリが既定カテゴリを上書きする */
export async function loadCategories(ctx: AppContext): Promise<RuleCategory[]> {
  const stored = await ctx.notation.listCategories();
  const byCode = new Map(defaultRuleCategories.map((c) => [c.code, c]));
  for (const c of stored) byCode.set(c.code, c);
  return [...byCode.values()].sort((a, b) => a.order - b.order || a.code.localeCompare(b.code));
}

async function managedBy(ctx: AppContext, userId: string): Promise<string[]> {
  return (await ctx.notation.listManagers())
    .filter((m) => m.userId === userId)
    .map((m) => m.categoryCode);
}

async function roleFor(ctx: AppContext, principal: Principal, categoryCode: string) {
  return notationRole(principal, categoryCode, await managedBy(ctx, principal.userId));
}

async function requireManager(ctx: AppContext, principal: Principal, categoryCode: string) {
  if ((await roleFor(ctx, principal, categoryCode)) === "member")
    throw new DomainError("notation_not_manager", { categoryCode });
}

function requireAdmin(principal: Principal) {
  if (!canAssignManagers(principal))
    throw new DomainError("notation_not_manager", { reason: "admin_required" });
}

export interface RuleBook {
  categories: RuleCategory[];
  rules: NotationRule[];
  managers: Array<{ userId: string; categoryCode: string }>;
  /** 自分の役割（カテゴリごと） */
  roles: Record<string, NotationRole>;
  canAssignManagers: boolean;
}

/** ルール一覧（無効なルールも含む。管理画面・書き出し・ブラウザ内の検査に使う） */
export async function getRuleBook(ctx: AppContext, principal: Principal): Promise<RuleBook> {
  const [categories, rules, managers] = await Promise.all([
    loadCategories(ctx),
    ctx.notation.listRules(),
    ctx.notation.listManagers(),
  ]);
  const mine = managers.filter((m) => m.userId === principal.userId).map((m) => m.categoryCode);
  const roles: Record<string, NotationRole> = {};
  for (const c of categories) roles[c.code] = notationRole(principal, c.code, mine);
  return {
    categories,
    rules: rules.sort((a, b) => a.ruleId.localeCompare(b.ruleId)),
    managers: managers.map((m) => ({ userId: m.userId, categoryCode: m.categoryCode })),
    roles,
    canAssignManagers: canAssignManagers(principal),
  };
}

export async function getRuleHistory(
  ctx: AppContext,
  _principal: Principal,
  ruleId: string,
): Promise<RuleRevision[]> {
  const list = await ctx.notation.listRevisions(ruleId);
  return list.sort((a, b) => b.revision - a.revision);
}

function validateOrThrow(draft: RuleDraft, categories: RuleCategory[]) {
  const errors = validateRuleDraft(draft);
  const codes = new Set(categories.map((c) => c.code));
  if (!codes.has(draft.categoryCode)) errors.push(`カテゴリ ${draft.categoryCode} がありません`);
  for (const s of draft.scopes)
    if (!codes.has(s)) errors.push(`適用範囲のカテゴリ ${s} がありません`);
  for (const e of draft.exceptions)
    if (e.kind === "category" && !codes.has(e.value))
      errors.push(`例外のカテゴリ ${e.value} がありません`);
  if (errors.length) throw new DomainError("notation_rule_invalid", { errors });
}

/** 入力を RuleDraft に正規化する（空の表記を除く・重複を除く） */
function cleanDraft(d: RuleDraft): RuleDraft {
  const list = (xs: readonly string[]) =>
    Array.from(new Set(xs.map((x) => x.trim()).filter(Boolean)));
  const out: RuleDraft = {
    ruleId: d.ruleId.trim(),
    categoryCode: d.categoryCode.trim(),
    title: d.title.trim(),
    description: d.description.trim(),
    correct: list(d.correct),
    incorrect: list(d.incorrect),
    patterns: list(d.patterns),
    exceptions: d.exceptions
      .filter((e) => e.kind === "category" || e.value.trim() !== "" || (e.note ?? "") !== "")
      .map((e) => ({
        kind: e.kind,
        value: e.value.trim(),
        ...(e.note ? { note: e.note.trim() } : {}),
      })),
    language: d.language,
    scopes: list(d.scopes),
    years: Array.from(new Set(d.years.filter((y) => Number.isInteger(y) && y > 0 && y < 1000))),
    priority: Number.isFinite(d.priority)
      ? Math.max(-100, Math.min(100, Math.round(d.priority)))
      : 0,
    strictness: ruleStrictness.includes(d.strictness) ? d.strictness : "required",
    enabled: d.enabled,
  };
  if (d.note?.trim()) out.note = d.note.trim();
  if (d.translations && (d.translations.en || d.translations.zh))
    out.translations = {
      ...(d.translations.en ? { en: d.translations.en } : {}),
      ...(d.translations.zh ? { zh: d.translations.zh } : {}),
    };
  return out;
}

/** 保存の本体（権限確認済みの前提）。新規なら版 1、変更なら版 +1 で履歴を残す */
async function writeRule(
  ctx: AppContext,
  principal: Principal,
  draft: RuleDraft,
  meta: {
    operation: RuleOperation;
    reason: string;
    expectedRevision?: number;
    proposalId?: string;
  },
): Promise<NotationRule> {
  const now = ctx.clock.now();
  const current = await ctx.notation.findRule(draft.ruleId);
  if (current && meta.expectedRevision !== undefined && current.revision !== meta.expectedRevision)
    throw new DomainError("version_conflict", {
      expected: meta.expectedRevision,
      actual: current.revision,
    });
  if (!current && meta.expectedRevision !== undefined && meta.expectedRevision !== 0)
    throw new DomainError("version_conflict", { expected: meta.expectedRevision, actual: 0 });
  const rule: NotationRule = current
    ? {
        ...draft,
        revision: current.revision + 1,
        createdBy: current.createdBy,
        createdAt: current.createdAt,
        updatedBy: principal.userId,
        updatedAt: now,
        publishedAt: now,
      }
    : {
        ...draft,
        revision: 1,
        createdBy: principal.userId,
        createdAt: now,
        updatedBy: principal.userId,
        updatedAt: now,
        publishedAt: now,
      };
  if (current) await ctx.notation.updateRule(rule);
  else await ctx.notation.insertRule(rule);
  const rev: RuleRevision = {
    ruleId: rule.ruleId,
    revision: rule.revision,
    rule,
    operation: current ? meta.operation : meta.operation === "update" ? "create" : meta.operation,
    reason: meta.reason,
    actorId: principal.userId,
    at: now,
  };
  if (meta.proposalId) rev.proposalId = meta.proposalId;
  await ctx.notation.appendRevision(rev);
  await ctx.audit.record({
    entityType: "notationRule",
    entityId: rule.ruleId,
    operation: rev.operation,
    actorId: principal.userId,
    ...(current ? { before: current } : {}),
    after: rule,
    at: now,
  });
  return rule;
}

export interface SaveRuleInput {
  rule: RuleDraft;
  /** 編集を始めたときの版（同時編集の上書きを防ぐ）。新規は 0 */
  expectedRevision?: number;
  reason?: string;
}

/** ルールの追加・編集。カテゴリを移すときは移動元・移動先の両方の権限が要る */
export async function saveRule(
  ctx: AppContext,
  principal: Principal,
  input: SaveRuleInput,
): Promise<{ ruleId: string; revision: number }> {
  const draft = cleanDraft(input.rule);
  validateOrThrow(draft, await loadCategories(ctx));
  await requireManager(ctx, principal, draft.categoryCode);
  const current = await ctx.notation.findRule(draft.ruleId);
  if (current && current.categoryCode !== draft.categoryCode)
    await requireManager(ctx, principal, current.categoryCode);
  const rule = await writeRule(ctx, principal, draft, {
    operation: "update",
    reason: (input.reason ?? "").slice(0, 500),
    ...(input.expectedRevision !== undefined ? { expectedRevision: input.expectedRevision } : {}),
  });
  return { ruleId: rule.ruleId, revision: rule.revision };
}

/** 無効化・再有効化（削除はしない。過去の校正結果が参照するため） */
export async function setRuleEnabled(
  ctx: AppContext,
  principal: Principal,
  input: { ruleId: string; enabled: boolean; reason?: string },
): Promise<{ revision: number }> {
  const current = await ctx.notation.findRule(input.ruleId);
  if (!current) throw new DomainError("notation_rule_invalid", { errors: ["ルールがありません"] });
  await requireManager(ctx, principal, current.categoryCode);
  if (current.enabled === input.enabled) return { revision: current.revision };
  const {
    revision: _r,
    createdBy: _cb,
    updatedBy: _ub,
    createdAt: _ca,
    updatedAt: _ua,
    publishedAt: _p,
    ...draft
  } = current;
  const rule = await writeRule(
    ctx,
    principal,
    { ...draft, enabled: input.enabled },
    { operation: input.enabled ? "enable" : "disable", reason: (input.reason ?? "").slice(0, 500) },
  );
  return { revision: rule.revision };
}

/**
 * カテゴリの追加・変更。
 * 追加・継承元の変更はシステム管理者、名前・説明・運用メモはそのカテゴリの管理者も変えられる。
 */
export async function saveCategory(
  ctx: AppContext,
  principal: Principal,
  input: RuleCategory,
): Promise<void> {
  const categories = await loadCategories(ctx);
  const current = categories.find((c) => c.code === input.code);
  const code = input.code.trim();
  if (!/^[A-Za-z][A-Za-z0-9_-]{0,15}$/.test(code))
    throw new DomainError("notation_category_invalid", { reason: "code" });
  const parents = Array.from(new Set(input.parents.map((p) => p.trim()).filter(Boolean)));
  const structural =
    !current || current.parents.join(",") !== parents.join(",") || current.order !== input.order;
  if (structural) requireAdmin(principal);
  else await requireManager(ctx, principal, code);
  const codes = new Set(categories.map((c) => c.code));
  for (const p of parents)
    if (!codes.has(p) || p === code)
      throw new DomainError("notation_category_invalid", { reason: "parent", parent: p });
  // 循環しないこと
  const next = categories.filter((c) => c.code !== code).concat([{ ...input, code, parents }]);
  const byCode = new Map(next.map((c) => [c.code, c]));
  const visit = (c: string, seen: Set<string>): boolean => {
    if (seen.has(c)) return false;
    seen.add(c);
    return (byCode.get(c)?.parents ?? []).every((p) => visit(p, new Set(seen)));
  };
  if (!visit(code, new Set()))
    throw new DomainError("notation_category_invalid", { reason: "cycle" });
  if (!input.name.trim()) throw new DomainError("notation_category_invalid", { reason: "name" });
  const row: RuleCategory = {
    code,
    name: input.name.trim().slice(0, 80),
    description: input.description.slice(0, 2000),
    parents,
    policyNotes: input.policyNotes.slice(0, 20_000),
    order: Number.isFinite(input.order) ? input.order : categories.length + 1,
  };
  await ctx.notation.upsertCategory(row);
  await ctx.audit.record({
    entityType: "notationCategory",
    entityId: code,
    operation: current ? "update" : "create",
    actorId: principal.userId,
    ...(current ? { before: current } : {}),
    after: row,
    at: ctx.clock.now(),
  });
}

/** カテゴリ管理者の設定（システム管理者のみ） */
export async function setCategoryManager(
  ctx: AppContext,
  principal: Principal,
  input: { userId: string; categoryCode: string; assigned: boolean },
): Promise<void> {
  requireAdmin(principal);
  const categories = await loadCategories(ctx);
  if (!categories.some((c) => c.code === input.categoryCode))
    throw new DomainError("notation_category_invalid", { reason: "unknown" });
  const exists = (await ctx.notation.listManagers()).some(
    (m) => m.userId === input.userId && m.categoryCode === input.categoryCode,
  );
  if (input.assigned && !exists)
    await ctx.notation.addManager({
      userId: input.userId,
      categoryCode: input.categoryCode,
      assignedBy: principal.userId,
      assignedAt: ctx.clock.now(),
    });
  if (!input.assigned && exists) await ctx.notation.removeManager(input.userId, input.categoryCode);
  await ctx.audit.record({
    entityType: "notationManager",
    entityId: `${input.categoryCode}:${input.userId}`,
    operation: input.assigned ? "assign" : "unassign",
    actorId: principal.userId,
    at: ctx.clock.now(),
  });
}

export interface ImportRulesInput {
  rules: RuleDraft[];
  /** ルールにできなかった行（カテゴリの運用メモに追記する） */
  notes: Array<{ categoryCode: string; text: string }>;
  /** 同じ ruleId があれば上書き（版 +1）。false なら飛ばす */
  overwrite: boolean;
  reason?: string;
}

const IMPORT_MAX = 1000;

/**
 * 取り込み（プレビューを確認したあとに呼ぶ）。各ルールのカテゴリについて編集権限が要る。
 * 内容の誤りは 1 件ずつ報告し、正しいものだけ取り込む（全体を止めない）。
 */
export async function importRules(
  ctx: AppContext,
  principal: Principal,
  input: ImportRulesInput,
): Promise<{
  created: number;
  updated: number;
  skipped: number;
  errors: Array<{ ruleId: string; errors: string[] }>;
}> {
  if (input.rules.length > IMPORT_MAX)
    throw new DomainError("notation_rule_invalid", {
      errors: [`一度に取り込めるのは ${IMPORT_MAX} 件までです`],
    });
  const categories = await loadCategories(ctx);
  const result = {
    created: 0,
    updated: 0,
    skipped: 0,
    errors: [] as Array<{ ruleId: string; errors: string[] }>,
  };
  const roles = new Map<string, NotationRole>();
  const role = async (code: string) => {
    if (!roles.has(code)) roles.set(code, await roleFor(ctx, principal, code));
    return roles.get(code)!;
  };
  for (const raw of input.rules) {
    const draft = cleanDraft(raw);
    try {
      validateOrThrow(draft, categories);
    } catch (e) {
      result.errors.push({
        ruleId: draft.ruleId,
        errors: e instanceof DomainError ? ((e.details.errors as string[]) ?? []) : [String(e)],
      });
      continue;
    }
    if ((await role(draft.categoryCode)) === "member") {
      result.errors.push({
        ruleId: draft.ruleId,
        errors: [`カテゴリ ${draft.categoryCode} を編集する権限がありません`],
      });
      continue;
    }
    const current = await ctx.notation.findRule(draft.ruleId);
    if (current && !input.overwrite) {
      result.skipped++;
      continue;
    }
    if (
      current &&
      current.categoryCode !== draft.categoryCode &&
      (await role(current.categoryCode)) === "member"
    ) {
      result.errors.push({
        ruleId: draft.ruleId,
        errors: ["移動元のカテゴリを編集する権限がありません"],
      });
      continue;
    }
    await writeRule(ctx, principal, draft, {
      operation: "import",
      reason: (input.reason ?? "取り込み").slice(0, 500),
    });
    if (current) result.updated++;
    else result.created++;
  }
  // 説明行はカテゴリの運用メモへ
  const byCat = new Map<string, string[]>();
  for (const n of input.notes.slice(0, 2000)) {
    if (!n.text.trim()) continue;
    byCat.set(n.categoryCode, [...(byCat.get(n.categoryCode) ?? []), n.text.trim()]);
  }
  for (const [code, texts] of byCat) {
    const cat = categories.find((c) => c.code === code);
    if (!cat || (await role(code)) === "member") continue;
    const add = texts.filter((t) => !cat.policyNotes.includes(t));
    if (!add.length) continue;
    await ctx.notation.upsertCategory({
      ...cat,
      policyNotes: [cat.policyNotes, ...add].filter(Boolean).join("\n").slice(0, 20_000),
    });
  }
  return result;
}

export interface WorkRuleSet {
  categories: string[];
  year: number;
  rules: EffectiveRule[];
  snapshot: RuleSetSnapshot;
}

/** 制作物に今適用されるルールの組（文章エディタでの検査に使う） */
export async function resolveRulesForWork(
  ctx: AppContext,
  principal: Principal,
  workId: string,
): Promise<WorkRuleSet> {
  const { work } = await loadAuthorizedWork(ctx, principal, workId, "work.view");
  return currentRuleSet(ctx, work.notationCategories ?? [], work.year);
}

/** 権限確認なしで現在のルールの組を作る（提出確定のトランザクション内から使う） */
export async function currentRuleSet(
  ctx: AppContext,
  selected: readonly string[],
  year: number,
): Promise<WorkRuleSet> {
  const [categories, rules] = await Promise.all([loadCategories(ctx), ctx.notation.listRules()]);
  const effective = selected.length ? resolveRuleSet(categories, selected, rules, { year }) : [];
  return {
    categories: [...selected],
    year,
    rules: effective,
    snapshot: snapshotOf(selected, year, effective),
  };
}

/**
 * 版の提出時に記録したルールの組を、そのときの版の内容で復元する（後からルールが変わっても同じ結果にする）。
 * 版に記録が無い（機能導入前の版）なら null。
 */
export async function rulesOfSnapshot(
  ctx: AppContext,
  snapshot: RuleSetSnapshot,
): Promise<EffectiveRule[]> {
  const current = new Map((await ctx.notation.listRules()).map((r) => [r.ruleId, r]));
  const rules: NotationRule[] = [];
  for (const ref of snapshot.rules) {
    const now = current.get(ref.ruleId);
    if (now && now.revision === ref.revision) {
      rules.push(now);
      continue;
    }
    const hist = (await ctx.notation.listRevisions(ref.ruleId)).find(
      (h) => h.revision === ref.revision,
    );
    if (hist) rules.push(hist.rule);
  }
  // 当てるルールと深さは提出時の記録に従う（今のカテゴリの継承で選び直さない）。
  // 深さを記録していない古い版だけ、今の継承から深さを推定する
  const legacy = snapshot.rules.some((r) => r.depth === undefined) ? await loadCategories(ctx) : [];
  return restoreRuleSet(snapshot, rules, legacy);
}

// ---------------------------------------------------------------- 変更提案

export interface ProposeRuleInput {
  kind: ProposalKind;
  categoryCode: string;
  ruleId?: string;
  title: string;
  correct: string[];
  incorrect: string[];
  patterns?: string[];
  exceptions?: ExceptionCondition[];
  reason: string;
  context?: ProposalContext;
}

const short = (s: string | undefined, n: number) => (s ?? "").slice(0, n);

/**
 * 変更提案・誤表記の報告。承認されるまでルールには反映されない。
 * 同じ内容の未処理の提案があれば賛同者として加える（merged: true）。
 * 校正画面から出すときは、その制作物を閲覧できることを確かめる（他の制作物の文章を提案に混ぜない）。
 */
export async function proposeRule(
  ctx: AppContext,
  principal: Principal,
  input: ProposeRuleInput,
): Promise<{ proposal: RuleProposal; merged: boolean }> {
  const categories = await loadCategories(ctx);
  if (!categories.some((c) => c.code === input.categoryCode))
    throw new DomainError("notation_category_invalid", { reason: "unknown" });
  const list = (xs: readonly string[] | undefined) =>
    Array.from(new Set((xs ?? []).map((x) => x.trim()).filter(Boolean)))
      .slice(0, 50)
      .map((x) => x.slice(0, 200));
  const correct = list(input.correct);
  const incorrect = list(input.incorrect);
  const patterns = list(input.patterns);
  if (input.kind !== "report" && correct.length === 0)
    throw new DomainError("notation_rule_invalid", { errors: ["統一表記が空です"] });
  if (input.kind === "report" && incorrect.length === 0 && !input.context?.quote)
    throw new DomainError("notation_rule_invalid", { errors: ["報告する表記が空です"] });
  if (input.kind === "change") {
    const target = input.ruleId ? await ctx.notation.findRule(input.ruleId) : null;
    if (!target)
      throw new DomainError("notation_rule_invalid", { errors: ["変更するルールがありません"] });
  }
  const context: ProposalContext = {};
  if (input.context?.workId) {
    await loadAuthorizedWork(ctx, principal, input.context.workId, "work.view");
    context.workId = input.context.workId;
    if (input.context.revisionId) {
      const rev = await ctx.revisions.findById(input.context.revisionId);
      if (!rev || rev.workId !== input.context.workId)
        throw new DomainError("forbidden", { reason: "revision_work_mismatch" });
      context.revisionId = rev.id;
    }
    if (input.context.artifactId) context.artifactId = input.context.artifactId;
  }
  if (input.context?.quote) context.quote = short(input.context.quote, 200);
  if (input.context?.surrounding) context.surrounding = short(input.context.surrounding, 400);

  const base = {
    kind: input.kind,
    categoryCode: input.categoryCode,
    ...(input.ruleId ? { ruleId: input.ruleId } : {}),
    correct,
    incorrect,
    patterns,
  };
  const dedupeKey = proposalDedupeKey(base);
  const now = ctx.clock.now();
  const existing = await ctx.notation.findOpenProposalByKey(dedupeKey);
  if (existing) {
    if (
      existing.proposedBy !== principal.userId &&
      !existing.supporters.includes(principal.userId)
    ) {
      const next = { ...existing, supporters: [...existing.supporters, principal.userId] };
      await ctx.notation.updateProposal(next);
      return { proposal: next, merged: true };
    }
    return { proposal: existing, merged: true };
  }
  const proposal = await ctx.notation.insertProposal({
    ...base,
    // 引用（context.quote）は元の制作物を見られる人だけのもの。公開される題名へは写さない
    title: short(
      input.title.trim() || correct[0] || incorrect[0] || neutralProposalTitle(input.kind),
      200,
    ),
    exceptions: (input.exceptions ?? []).slice(0, 20),
    reason: short(input.reason, 2000),
    context,
    status: "open",
    dedupeKey,
    proposedBy: principal.userId,
    proposedAt: now,
    supporters: [],
  });
  await ctx.audit.record({
    entityType: "notationProposal",
    entityId: proposal.id,
    operation: "propose",
    actorId: principal.userId,
    after: proposal,
    at: now,
  });
  const managers = (await ctx.notation.listManagers())
    .filter((m) => m.categoryCode === input.categoryCode)
    .map((m) => m.userId);
  const who = await personName(ctx, principal.userId);
  await notify(ctx, managers, principal.userId, {
    kind: "rule_proposed",
    title: "表記ルールの提案が届きました",
    // 担当者が元の制作物を見られるとは限らないので、文脈と重なる題名は出さない（一覧と同じ保護）
    body: `${who ? `${who}から・` : ""}カテゴリ ${input.categoryCode}「${publicProposalTitle(proposal)}」: ${
      proposal.reason?.trim() ? excerpt(proposal.reason) : "理由の記載なし"
    }`,
  });
  return { proposal, merged: false };
}

export interface ProposalView extends RuleProposal {
  /** 閲覧者が元の制作物を見られないときは、文脈（引用・制作物）を隠す */
  contextHidden: boolean;
  canDecide: boolean;
}

/** 提案の一覧。自分の提案と、自分が管理するカテゴリの提案（システム管理者はすべて） */
export async function listRuleProposals(
  ctx: AppContext,
  principal: Principal,
  input: { status: RuleProposal["status"] | null; limit?: number },
): Promise<ProposalView[]> {
  const managed = await managedBy(ctx, principal.userId);
  const all = await ctx.notation.listProposals(input.status, Math.min(input.limit ?? 200, 500));
  const out: ProposalView[] = [];
  for (const p of all) {
    const role = notationRole(principal, p.categoryCode, managed);
    const mine = p.proposedBy === principal.userId || p.supporters.includes(principal.userId);
    if (role === "member" && !mine) continue;
    let hidden = false;
    if (p.context.workId) {
      try {
        await loadAuthorizedWork(ctx, principal, p.context.workId, "work.view");
      } catch {
        hidden = true;
      }
    }
    out.push({
      ...p,
      // 文脈を隠すときは、文脈と重なる題名も中立的な題名にする（引用が題名として残らないように）
      title: hidden ? publicProposalTitle(p) : p.title,
      context: hidden ? {} : p.context,
      contextHidden: hidden,
      canDecide: role !== "member" && p.status === "open",
    });
  }
  return out;
}

export interface DecideProposalInput {
  proposalId: string;
  decision: "approve" | "reject";
  note?: string;
  /** 編集して承認するときのルール */
  edited?: RuleDraft;
}

/** 提案 → ルールの下書き（新規なら ID を採番、変更なら既存ルールに重ねる） */
async function draftFromProposal(ctx: AppContext, p: RuleProposal): Promise<RuleDraft> {
  if (p.kind === "change" && p.ruleId) {
    const cur = await ctx.notation.findRule(p.ruleId);
    if (cur) {
      const {
        revision: _r,
        createdBy: _cb,
        updatedBy: _ub,
        createdAt: _ca,
        updatedAt: _ua,
        publishedAt: _p,
        ...d
      } = cur;
      return {
        ...d,
        correct: p.correct.length ? p.correct : d.correct,
        incorrect: p.incorrect.length || p.patterns.length ? p.incorrect : d.incorrect,
        patterns: p.incorrect.length || p.patterns.length ? p.patterns : d.patterns,
        exceptions: p.exceptions.length ? p.exceptions : d.exceptions,
      };
    }
  }
  const rules = await ctx.notation.listRules();
  const taken = new Set(rules.map((r) => r.ruleId));
  let n = rules.filter((r) => r.categoryCode === p.categoryCode).length + 1;
  let id = `${p.categoryCode}-P${String(n).padStart(4, "0")}`;
  while (taken.has(id)) id = `${p.categoryCode}-P${String(++n).padStart(4, "0")}`;
  return {
    ruleId: id,
    categoryCode: p.categoryCode,
    // ルールは誰でも読めるので、文脈と重なる題名は使わない
    title: publicProposalTitle(p),
    description: p.reason,
    correct: p.correct,
    incorrect: p.incorrect,
    patterns: p.patterns,
    exceptions: p.exceptions,
    language: "ja",
    scopes: [],
    years: [],
    priority: 0,
    strictness: "required",
    enabled: true,
  };
}

/** 承認・却下・編集して承認（カテゴリ管理者）。承認でルールに反映し、提案者に知らせる */
export async function decideRuleProposal(
  ctx: AppContext,
  principal: Principal,
  input: DecideProposalInput,
): Promise<RuleProposal> {
  const p = await ctx.notation.findProposal(input.proposalId);
  if (!p) throw new DomainError("forbidden", { reason: "proposal_not_found" });
  await requireManager(ctx, principal, p.categoryCode);
  if (p.status !== "open") throw new DomainError("notation_proposal_closed");
  const now = ctx.clock.now();
  const next: RuleProposal = {
    ...p,
    status: input.decision === "approve" ? "approved" : "rejected",
    decidedBy: principal.userId,
    decidedAt: now,
  };
  if (input.note?.trim()) next.decisionNote = input.note.trim().slice(0, 2000);
  if (input.decision === "approve") {
    const draft = cleanDraft(input.edited ?? (await draftFromProposal(ctx, p)));
    validateOrThrow(draft, await loadCategories(ctx));
    await requireManager(ctx, principal, draft.categoryCode);
    const existing = await ctx.notation.findRule(draft.ruleId);
    if (existing && existing.categoryCode !== draft.categoryCode)
      await requireManager(ctx, principal, existing.categoryCode);
    const rule = await writeRule(ctx, principal, draft, {
      operation: "proposal",
      reason: next.decisionNote ?? `提案 ${p.id} を承認`,
      proposalId: p.id,
    });
    next.resultRuleId = rule.ruleId;
    next.resultRevision = rule.revision;
  }
  await ctx.notation.updateProposal(next);
  await ctx.audit.record({
    entityType: "notationProposal",
    entityId: p.id,
    operation: input.decision,
    actorId: principal.userId,
    before: p,
    after: next,
    at: now,
  });
  const who = await personName(ctx, principal.userId);
  await notify(ctx, [p.proposedBy, ...p.supporters], principal.userId, {
    kind: "rule_proposal_decided",
    title:
      input.decision === "approve"
        ? "表記ルールの提案が承認されました"
        : "表記ルールの提案が却下されました",
    body: `「${publicProposalTitle(p)}」${who ? `・${who}` : ""}${
      next.decisionNote?.trim() ? `: ${excerpt(next.decisionNote)}` : ""
    }`,
  });
  return next;
}

/** まとめて承認・却下（編集なし）。1 件ずつ判定し、失敗したものは理由を返す */
export async function decideRuleProposals(
  ctx: AppContext,
  principal: Principal,
  input: { proposalIds: string[]; decision: "approve" | "reject"; note?: string },
): Promise<{ done: string[]; failed: Array<{ id: string; code: string }> }> {
  const done: string[] = [];
  const failed: Array<{ id: string; code: string }> = [];
  for (const id of input.proposalIds.slice(0, 50)) {
    try {
      await decideRuleProposal(ctx, principal, {
        proposalId: id,
        decision: input.decision,
        ...(input.note ? { note: input.note } : {}),
      });
      done.push(id);
    } catch (e) {
      failed.push({ id, code: e instanceof DomainError ? e.code : "unknown" });
    }
  }
  return { done, failed };
}
