import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";

const root = "/workspace";
const stackDir = path.join(root, "scripts/stack-pr");
const REF_LINEAR = "origin/cursor/stack-linear-8b5a";

function checkoutFromLinear(paths) {
  execSync(`git fetch origin cursor/stack-linear-8b5a 2>/dev/null || true`, { cwd: root });
  execSync(`git checkout ${REF_LINEAR} -- ${paths.map((p) => JSON.stringify(p)).join(" ")}`, {
    cwd: root,
    stdio: "inherit",
  });
}

export function applyPatches(names) {
  for (const n of names ?? []) {
    const candidates = [
      path.join(stackDir, n),
      path.join(stackDir, "patches", n),
      path.join(stackDir, "patches", path.basename(n)),
    ];
    const file = candidates.find((p) => fs.existsSync(p));
    if (!file) throw new Error(`patch missing: ${n}`);
    execSync(`git apply --whitespace=nowarn ${JSON.stringify(file)}`, {
      cwd: root,
      stdio: "inherit",
    });
  }
}

function patchFile(rel, pairs) {
  const file = path.join(root, rel);
  let s = fs.readFileSync(file, "utf8");
  for (const [from, to] of pairs) {
    if (!s.includes(from)) throw new Error(`patchFile missing: ${from.slice(0, 40)} in ${rel}`);
    s = s.replace(from, to);
  }
  fs.writeFileSync(file, s);
}

/** パッチではなく手編集が必要な PR */
export function applyEdit(name) {
  switch (name) {
    case "labels-resolution":
      patchFile("apps/web/src/lib/labels.ts", [
        ['  accepted: "採用",', '  accepted: "反映する",'],
        ['  rejected: "不採用",', '  rejected: "反映しない",'],
        ['  deferred: "次版へ持ち越し",', '  deferred: "次の版で対応",'],
      ]);
      return;
    case "labels-review-state":
      patchFile("apps/web/src/lib/labels.ts", [
        ['  open: "受付中",', '  open: "校正中",'],
        ['  closed: "受付終了",', '  closed: "締切済み",'],
        ['  deadline: "期限到来",', '  deadline: "校正期日を過ぎた",'],
        ['  superseded: "新版提出",', '  superseded: "新しい版が出た",'],
        ['  void: "無効化",', '  void: "無効にした",'],
      ]);
      return;
    case "labels-severity":
      patchFile("apps/web/src/lib/labels.ts", [['  info: "情報",', '  info: "参考",']]);
      return;
    case "labels-approval":
      patchFile("apps/web/src/lib/labels.ts", [
        ['  declared: "校了を宣言",', '  declared: "校了する",'],
        ['  exception_finalized: "例外校了",', '  exception_finalized: "未対応のまま校了",'],
      ]);
      return;
    case "labels-blocked":
      patchFile("apps/web/src/lib/labels.ts", [
        [
          '  finalized: "この制作物は校了済みのため、新しいコメントはできません",',
          '  finalized: "校了済みのため、コメントできません",',
        ],
        [
          '  superseded: "新版が提出されたため、この版の受付は終了しました",',
          '  superseded: "新しい版が出たため、この版の校正は終わりました",',
        ],
        [
          '  deadline: "校正期限を過ぎたため、この版の受付は終了しました",',
          '  deadline: "校正期日を過ぎたため、この版の校正は終わりました",',
        ],
        ['  closed: "この版の受付は終了しています",', '  closed: "この版の校正は終わりました",'],
        ['  void: "この版は無効化されています",', '  void: "この版は無効です",'],
        [
          '  not_latest: "最新の受付対象版ではありません",',
          '  not_latest: "最新の版ではありません",',
        ],
      ]);
      return;
    case "labels-notifications":
      patchFile("apps/web/src/lib/labels.ts", [
        ['  comment_decided: "採否",', '  comment_decided: "反映するかどうか",'],
        ['  comment_assigned: "対応担当",', '  comment_assigned: "対応する人",'],
        ['  deadline_approaching: "期限接近",', '  deadline_approaching: "校正期日が近い",'],
        ['  revision_voided: "版の無効化",', '  revision_voided: "版を無効にした",'],
      ]);
      return;
    case "labels-permission":
      patchFile("apps/web/src/lib/labels.ts", [['  edit: "編集（制作委任）",', '  edit: "編集",']]);
      return;
    case "errors-approver":
      applyPatches(["patches/p01-apps__web__src__lib__errors.ts.patch"]);
      return;
    case "review-panel-decide":
      applyPatches([
        "patches/p02-apps__web__src__features__review__ThreadPanel.tsx.patch",
        "patches/p03-apps__web__src__features__review__ThreadPanel.tsx.patch",
        "patches/p03-apps__web__src__features__review__ThreadPanel.css.patch",
        "patches/p03-apps__web__src__features__review__ThreadCard.tsx.patch",
      ]);
      return;
    case "review-focused-decide":
      applyPatches([
        "patches/p02-apps__web__src__features__review__ThreadPanel.tsx.patch",
        "patches/p03-apps__web__src__features__review__ThreadPanel.tsx.patch",
        "patches/p03-apps__web__src__features__review__ThreadPanel.css.patch",
      ]);
      checkoutFromLinear([
        "apps/web/src/features/review/ThreadCard.tsx",
        "apps/web/src/features/editor/Editor.tsx",
        "apps/web/src/features/review/ThreadPanel.tsx",
        "apps/web/src/features/review/ThreadPanel.css",
        "apps/web/src/styles.css",
      ]);
      {
        const editorPath = path.join(root, "apps/web/src/features/editor/Editor.tsx");
        let editor = fs.readFileSync(editorPath, "utf8");
        editor = editor.replace('import { ShortcutSheet } from "./ShortcutSheet";\n', "");
        editor = editor.replace("  const [keysOpen, setKeysOpen] = useState(false);\n", "");
        editor = editor.replace(
          /  \/\/ \? でショートカット一覧、C でコメントを付ける[\s\S]*?\}, \[commentKey\]\);\n/,
          `  // C でコメントを付ける（動画はビューアが C を受け持つ）。入力中は何もしない
  const commentKey = canComment && artifact?.type !== "video";
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.isComposing || e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
      const el = e.target as HTMLElement | null;
      if (el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))) return;
      if ((e.key === "c" || e.key === "C") && commentKey) {
        e.preventDefault();
        setMarkArmed(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [commentKey]);
`,
        );
        editor = editor.replace(
          /                  \{!mobile \? \(\n                    <M3eIconButton\n                      className="ws__keys"[\s\S]*?\) : null\}\n                  \{!mobile \? \(\n/,
          "                  {!mobile ? (\n",
        );
        editor = editor.replace(
          "        <ShortcutSheet open={keysOpen} onClose={() => setKeysOpen(false)} />\n",
          "",
        );
        fs.writeFileSync(editorPath, editor);
      }
      return;
    case "review-e2e-smoke-ce0b91f":
      checkoutFromLinear(["apps/web/e2e/specs/decision.spec.ts"]);
      try {
        patchFile("apps/web/e2e/screenshots.mjs", [
          [
            `const sel = '.comments .thread m3e-icon-button[aria-label="反映する"]';`,
            `const sel = ".comments .thread:not(.thread--closed)";`,
          ],
          [
            `await page.locator(sel).first().click();`,
            `await page.locator(".comments .thread--active .thread__decide m3e-button").first().click();`,
          ],
        ]);
      } catch {
        checkoutFromLinear(["apps/web/e2e/screenshots.mjs"]);
      }
      return;
    case "review-e2e-decision":
      patchFile("apps/web/e2e/specs/decision.spec.ts", [
        ['test.describe("コメントの採否"', 'test.describe("コメントの反映するかどうか"'],
        [
          'test("制作者が理由を付けて不採用にすると',
          'test("制作者が理由を付けて反映しないにすると',
        ],
        [
          `    await panel.locator('.thread-panel__bar m3e-icon-button[aria-label="その他の操作"]').click();
    await app.settle();
    await page.locator("m3e-menu-item:visible", { hasText: "不採用" }).click();
    await page.fill(".thread-panel textarea", "正式名称は規約で確認済み");
    await panel.locator("m3e-button", { hasText: "不採用にする" }).click();`,
          `    await panel.locator(".thread__decide m3e-button", { hasText: "反映しない" }).click();
    await page.fill(".thread-panel textarea", "正式名称は規約で確認済み");
    await panel.locator(".thread__form m3e-button", { hasText: "反映しない" }).click();`,
        ],
      ]);
      return;
    case "review-card-status": {
      const card = path.join(root, "apps/web/src/features/review/ThreadCard.tsx");
      let s = fs.readFileSync(card, "utf8");
      s = s.replace(/          \{canDecide && !closed \? \([\s\S]*?\) : null\}\n/, "");
      fs.writeFileSync(card, s);
      const meta = path.join(root, "apps/web/src/features/review/ThreadMeta.tsx");
      let m = fs.readFileSync(meta, "utf8");
      if (!m.includes("thread__pin-resolution")) {
        m = m.replace(
          `export function hasThreadMeta(t: Thread, placeState: WebAnchorState | undefined): boolean {
  return (
    isClosed(t) ||`,
          `export function hasThreadMeta(t: Thread, placeState: WebAnchorState | undefined): boolean {
  return (
    (!isClosed(t) && t.resolution !== "open") ||
    isClosed(t) ||`,
        );
        m = m.replace(
          `      {closed ? (`,
          `      {!closed && t.resolution !== "open" ? (
        <StatusText tone="neutral" icon="pending">
          {resolutionLabel[t.resolution]}
        </StatusText>
      ) : null}
      {closed ? (`,
        );
        fs.writeFileSync(meta, m);
      }
      return;
    }
    case "editor-comment-toolbar":
      applyPatches(["p04-apps__web__src__features__editor__Editor.tsx.patch"]);
      return;
    case "editor-shortcut-sheet":
      checkoutFromLinear([
        "apps/web/src/features/editor/ShortcutSheet.tsx",
        "apps/web/src/features/editor/ShortcutSheet.css",
        "apps/web/src/features/editor/Editor.tsx",
      ]);
      return;
    case "make-turn-layout": {
      const make = path.join(root, "apps/web/src/routes/_app/make.tsx");
      let s = fs.readFileSync(make, "utf8");
      s = s.replace(
        '<Group title="あなたの番" count={turn.length}>',
        '<Group title="要対応" count={turn.length}>',
      );
      s = s.replace(
        " * - 進行中: 「あなたの番」（未対応のコメントに返事をする・次の版を出す）",
        " * - 進行中: 「要対応」（未対応のコメントに返事をする・次の版を出す）",
      );
      fs.writeFileSync(make, s);
      return;
    }
    case "copy-anata-phrasing":
      checkoutFromLinear([
        "apps/web/src/features/editor/InfoTab.tsx",
        "apps/web/src/features/notation/AiBackground.tsx",
        "apps/web/src/features/work/WorkForm.tsx",
      ]);
      return;
    case "copy-youtaiou-terminology":
      checkoutFromLinear([
        "packages/domain/src/dashboard/workspace.ts",
        "packages/domain/src/__tests__/workspace.test.ts",
        "docs/DECISIONS.md",
        "docs/SCREENSHOTS.md",
        "docs/UI_M3E.md",
        "apps/web/e2e/motion/composition.html",
        "apps/web/src/features/workspace/parts.tsx",
        "apps/web/src/styles.css",
      ]);
      return;
    case "m3e-shape-table-kpi":
      applyEdit("m3e-shape-table");
      applyEdit("m3e-kpi-active");
      return;
    case "m3e-shape-table": {
      appendCssOnce(
        "m3e-shape-table",
        `
/* M3E shape: 表の角を large に */
.mf-table:not(.mf-table--flush) {
  border-radius: var(--mf-shape-lg);
}
`,
      );
      return;
    }
    case "m3e-kpi-active": {
      appendCssOnce(
        "m3e-kpi-active",
        `
.kpi {
  --m3e-card-shape: var(--mf-shape-xl);
}
.kpi__num {
  font-weight: 500;
  color: var(--mf-primary);
}
.comments .thread,
.thread-panel .creator-note,
.comments .creator-note {
  --m3e-card-shape: var(--mf-shape-lg);
}
.thread--active::before {
  width: 4px;
}
.comments .thread--active {
  --m3e-filled-card-container-color: color-mix(
    in srgb,
    var(--mf-primary) 10%,
    var(--mf-surface-container-lowest)
  );
}
.thread__decide m3e-button {
  --m3e-button-shape: var(--mf-shape-full);
}
`,
      );
      return;
    }
    case "m3e-ws-comment": {
      appendCssOnce(
        "m3e-ws-comment",
        `
.ws__comment {
  margin-inline: 4px;
}
`,
      );
      return;
    }
    case "e2e-screenshots-toolbar":
      checkoutFromLinear(["apps/web/e2e/screenshots.mjs"]);
      return;
    case "m3e-segmented-css":
      patchFile("apps/web/src/styles.css", [
        [
          `.mf-table__th {
  background: var(--mf-surface-container-high);
  font-weight: 600;
}`,
          `/* 見出し行は面の色を変えず、文字の色と太さで分ける（青い帯にしない。太さは 2026-10-15 の決定どおり 500 のまま） */
.mf-table__th {
  background: var(--mf-surface-container-low);
  color: var(--mf-on-surface-variant);
}`,
        ],
        [".kpi__num {\n  font-weight: 600;", ".kpi__num {\n  font-weight: 500;"],
      ]);
      appendCssOnce(
        "m3e-segmented-list",
        `
@container (min-width: 1240px) and (max-width: 1439px) {
  .works-table tr {
    --mf-table-pad: 12px;
  }
}
.list--segmented {
  --m3e-segmented-list-segment-gap: 2px;
  --m3e-segmented-list-container-shape: var(--md-sys-shape-corner-large-increased, 20px);
  --m3e-segmented-list-item-container-shape: var(--mf-shape-xs);
  --m3e-segmented-list-item-hover-container-shape: var(--mf-shape-lg);
  --m3e-segmented-list-item-focus-container-shape: var(--mf-shape-lg);
  --m3e-segmented-list-item-container-color: var(--mf-surface-container-lowest);
  --m3e-list-item-container-color: var(--mf-surface-container-lowest);
  margin: 0;
}
.list--segmented .list__item {
  --m3e-list-item-container-shape: var(--mf-shape-xs);
}
.hub .list.list--segmented {
  width: 100%;
  max-width: 100%;
}
.list--segmented .list__item--urgent {
  --m3e-list-item-container-color: color-mix(
    in srgb,
    var(--mf-error-container) 35%,
    var(--mf-surface-container-lowest)
  );
}
`,
      );
      return;
    case "domain-stages-v7":
      copySnippet("productionStages.ts", "packages/domain/src/dashboard/productionStages.ts");
      copySnippet(
        "productionStages.test.ts",
        "packages/domain/src/__tests__/productionStages.test.ts",
      );
      ensureIndexExport('export * from "./dashboard/productionStages.ts";');
      return;
    case "schema-revision-planned":
      patchFile("apps/convex/convex/schema.ts", [
        [
          `    submittedAt: v.number(),
    deadlineAt: v.number(),
    reviewState,`,
          `    submittedAt: v.number(),
    deadlineAt: v.number(),
    plannedSubmitAt: v.optional(v.number()),
    reviewState,`,
        ],
      ]);
      execSync("pnpm codegen", { cwd: root, stdio: "inherit" });
      return;
    case "domain-danger":
      copySnippet("danger.ts", "packages/domain/src/dashboard/danger.ts");
      copySnippet("danger.test.ts", "packages/domain/src/__tests__/danger.test.ts");
      ensureIndexExport('export * from "./dashboard/danger.ts";');
      return;
    case "demo-role-homes":
      patchFile("apps/convex/convex/seed.ts", [
        [
          `      created.push(workId);
    }
    // 表記統一のサンプル（notation2 の初期データ＋α）。ルールが 1 件も無いときだけ入れる`,
          `      created.push(workId);
    }
    // ロール別ホーム用: 校正割当付きの受付中版（dashboard.make / dashboard.check 用。1 セットだけ）
    if (!(await ctx.db.query("reviewAssignments").first())) {
      const pamphlet = await ctx.db
        .query("works")
        .withIndex("by_year", (q) => q.eq("year", 100))
        .filter((q) => q.eq(q.field("legacyId"), "PR-001"))
        .unique();
      if (pamphlet) {
        const revisionId = await ctx.db.insert("revisions", {
          workId: pamphlet._id,
          kind: "standard",
          sequence: 1,
          reviewType: "general",
          submittedBy: ids["mock-nogiku-creator"]!,
          submittedAt: now,
          deadlineAt: now + 12 * 3_600_000,
          plannedSubmitAt: now + 2 * day,
          reviewState: "open",
          changeSummary: "ホーム用サンプル",
          focusNotes: "",
        });
        await ctx.db.insert("reviewAssignments", {
          revisionId,
          reviewerId: ids["mock-nogiku-reviewer"]!,
          reviewType: "general",
          state: "pending",
        });
      }
    }
    // 表記統一のサンプル（notation2 の初期データ＋α）。ルールが 1 件も無いときだけ入れる`,
        ],
      ]);
      return;
    case "ui-view-switcher":
      copySnippet("ViewSwitcher.tsx", "apps/web/src/features/home/ViewSwitcher.tsx");
      patchFile("apps/web/src/routes/_app/make.tsx", [
        [
          `import { submitRouteIcon, useSubmitLauncher } from "@/features/home/SubmitPicker";`,
          `import { submitRouteIcon, useSubmitLauncher } from "@/features/home/SubmitPicker";
import { ViewSwitcher } from "@/features/home/ViewSwitcher";`,
        ],
        [
          `      <AppBarSlot slot="title">制作</AppBarSlot>
      {tabs}`,
          `      <AppBarSlot slot="title">制作</AppBarSlot>
      <AppBarSlot slot="actions">
        <ViewSwitcher />
      </AppBarSlot>
      {tabs}`,
        ],
      ]);
      appendCssOnce(
        "ui-home-view-switcher",
        `
.home-view-switcher__sr {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
}
`,
      );
      return;
    case "detail-shell":
      copySnippet("detail.tsx", "apps/web/src/routes/_app/works/$workId/detail.tsx");
      appendCssOnce(
        "detail-shell",
        `
.detail-shell__head {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 16px;
}
.detail-shell__row--title {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px 16px;
}
.detail-shell__title {
  margin: 0;
  min-width: 0;
}
.detail-shell__version {
  color: var(--mf-on-surface-variant);
  flex-shrink: 0;
}
.detail-shell__row--steps {
  min-height: 48px;
}
.detail-shell__stepper {
  width: 100%;
}
`,
      );
      return;
    default:
      throw new Error(`unknown edit: ${name}`);
  }
}

function appendCssOnce(marker, chunk) {
  const cssPath = path.join(root, "apps/web/src/styles.css");
  let c = fs.readFileSync(cssPath, "utf8");
  if (c.includes(marker)) return;
  c += `\n/* stack-pr:${marker} */\n${chunk}\n`;
  fs.writeFileSync(cssPath, c);
}

function copySnippet(name, destRel) {
  const src = path.join(stackDir, "snippets", name);
  if (!fs.existsSync(src)) throw new Error(`snippet missing: ${name}`);
  const dest = path.join(root, destRel);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, fs.readFileSync(src, "utf8"));
}

function ensureIndexExport(line) {
  const rel = "packages/domain/src/index.ts";
  const file = path.join(root, rel);
  const s = fs.readFileSync(file, "utf8");
  if (s.includes(line)) return;
  fs.writeFileSync(file, `${s.trimEnd()}\n${line}\n`);
}

export function applyItem(item) {
  if (item.patches?.length) applyPatches(item.patches);
  if (item.edit) applyEdit(item.edit);
}
