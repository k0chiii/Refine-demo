#!/usr/bin/env node
/** Stacked PR キュー（系列 A→B→C）。run-queue.mjs が読む。 */
import fs from "node:fs";
import path from "node:path";

const patchDir = path.join(import.meta.dirname, "patches");

/** 0002 の per-file patch を PR 化（e2e は後でまとめる） */
const P02_SKIP = new Set([
  "p02-apps__web__src__features__review__ThreadPanel.tsx.patch",
  "p02-apps__web__src__features__editor__Editor.tsx.patch",
  "p02-apps__web__src__routes___app__make.tsx.patch",
]);

function copyFilePrs() {
  const files = fs
    .readdirSync(patchDir)
    .filter((f) => f.startsWith("p02-") && !f.includes("e2e") && !P02_SKIP.has(f))
    .sort();
  return files.map((f) => {
    const rel = f.replace(/^p02-/, "").replace(/__/g, "/");
    const slug = rel
      .replace(/[^a-z0-9]+/gi, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 48);
    return {
      series: "A-ui-copy",
      slug: `copy-${slug}`,
      title: `copy: ${path.basename(rel)} の文言短縮・用語統一`,
      patches: [`patches/${f}`],
      verify: "standard",
      shots: shotFor(rel),
      m3e: ["typography"],
      decide: null,
    };
  });
}

function shotFor(rel) {
  if (rel.includes("make.tsx") || rel.includes("workspace")) return { desktop: "27-make-creator" };
  if (rel.includes("check.tsx")) return { desktop: "28-check-reviewer" };
  if (rel.includes("works/index") || rel.includes("WorksTable"))
    return { desktop: "02-works-list" };
  if (rel.includes("Editor") || rel.includes("review/") || rel.includes("annotation/"))
    return { desktop: "08-workspace-comment" };
  if (rel.includes("signin")) return { desktop: "01-signin" };
  return { desktop: "02-works-list" };
}

const seriesA = [
  {
    series: "A-ui-copy",
    slug: "copy-labels-resolution",
    title: "copy(labels): 採否を「反映する／反映しない／次の版で対応」に統一",
    edit: "labels-resolution",
    verify: "standard",
    shots: { desktop: "09-decision" },
    m3e: ["typography"],
    decide: [
      {
        id: "Q3",
        q: "監査 Q3: 受付中→校正中（本 PR は resolution のみ）",
        options: [
          { id: "A", rec: true, text: "別 PR で reviewState を揃える", note: "混在を避ける" },
        ],
      },
    ],
  },
  {
    series: "A-ui-copy",
    slug: "copy-labels-review-state",
    title: "copy(labels): 版の状態を「校正中／締切済み」に統一",
    edit: "labels-review-state",
    verify: "standard",
    shots: { desktop: "27-make-creator" },
    m3e: ["typography"],
    decide: [
      {
        id: "Q3",
        q: "監査 Q3: stageInfo の「受付終了」は別 PR",
        options: [
          { id: "A", rec: true, text: "本 PR は labels のみ", note: "約20か所は follow-up" },
        ],
      },
    ],
  },
  {
    series: "A-ui-copy",
    slug: "copy-labels-severity-info",
    title: "copy(labels): 重要度 info を「参考」に",
    edit: "labels-severity",
    verify: "standard",
    shots: { desktop: "08-workspace-comment" },
    m3e: ["typography"],
    decide: [
      {
        id: "Q9",
        q: "監査 Q9",
        options: [{ id: "A", rec: true, text: "参考", note: "仮実装承認待ち" }],
      },
    ],
  },
  {
    series: "A-ui-copy",
    slug: "copy-labels-approval-action",
    title: "copy(labels): 校了操作を「校了する／未対応のまま校了」に",
    edit: "labels-approval",
    verify: "standard",
    shots: { desktop: "31-finalize" },
    m3e: ["buttons"],
    decide: [
      {
        id: "Q6",
        q: "監査 Q6: 校了を宣言→校了する",
        options: [{ id: "A", rec: true, text: "はい（本 PR）", note: "UI ボタンは別 PR" }],
      },
    ],
  },
  {
    series: "A-ui-copy",
    slug: "copy-labels-blocked-reason",
    title: "copy(labels): コメント不可理由を短く",
    edit: "labels-blocked",
    verify: "standard",
    shots: { desktop: "08-workspace-comment" },
    m3e: ["typography"],
    decide: null,
  },
  {
    series: "A-ui-copy",
    slug: "copy-labels-notifications",
    title: "copy(labels): 通知種別ラベルを短く・用語統一",
    edit: "labels-notifications",
    verify: "standard",
    shots: { desktop: "15-notifications" },
    m3e: ["typography"],
    decide: [
      {
        id: "Q8",
        q: "監査 Q8: 担当者→対応する人",
        options: [{ id: "A", rec: true, text: "はい", note: "通知種別のみ" }],
      },
    ],
  },
  {
    series: "A-ui-copy",
    slug: "copy-labels-permission-edit",
    title: "copy(labels): 権限「編集（制作委任）」→「編集」",
    edit: "labels-permission",
    verify: "standard",
    shots: { desktop: "34-acl" },
    m3e: ["typography"],
    decide: null,
  },
  {
    series: "A-ui-copy",
    slug: "copy-errors-messages",
    title: "copy(errors): 利用者向けエラーメッセージの短縮・用語統一",
    edit: "errors-approver",
    verify: "standard",
    shots: { desktop: "12-submit-dialog" },
    m3e: ["typography"],
    decide: null,
  },
  {
    series: "A-ui-copy",
    slug: "copy-errors-tests",
    title: "copy(errors): errors.test を新文言に合わせる",
    patches: ["patches/p01-apps__web__src__lib__errors.test.ts.patch"],
    verify: "standard",
    shots: { desktop: "33-work-form" },
    m3e: ["typography"],
    decide: null,
  },
  {
    series: "A-ui-copy",
    slug: "copy-errors-failure-text-test",
    title: "copy(errors): failureText テストを新文言に合わせる",
    patches: ["patches/p01-apps__web__src__features__proofread__failureText.test.ts.patch"],
    verify: "standard",
    shots: { desktop: "02-works-list" },
    m3e: ["typography"],
    decide: null,
  },
  ...copyFilePrs(),
  {
    series: "A-ui-copy",
    slug: "review-decide-buttons-panel",
    title: "review: 選んだ／フォーカスしたコメントにだけ採否ボタン行",
    edit: "review-focused-decide",
    verify: "standard",
    shots: { desktop: "09-decision", mobile: "09-decision" },
    m3e: ["buttons", "buttonGroups"],
    decide: [
      {
        id: "1",
        q: "design-questions #1 反映ボタンの置き場所",
        options: [
          {
            id: "A",
            rec: true,
            text: "一覧で選んだ／フォーカスしたカード（パネルも同じ行）",
            note: "大地さん fb (a)",
          },
          { id: "B", text: "見出しアイコン", note: "次の版が入らない" },
        ],
      },
    ],
  },
  {
    series: "A-ui-copy",
    slug: "review-card-status-not-actions",
    title: "review: 一覧カードは小さな状態表示のみ（✓ クイック操作をやめる）",
    edit: "review-card-status",
    verify: "standard",
    shots: { desktop: "78-thread-panel" },
    m3e: ["lists", "chips"],
    decide: null,
  },
  {
    series: "A-ui-copy",
    slug: "review-e2e-decision",
    title: "test(e2e): 採否は選択中のみ・反映しないで理由にフォーカス @smoke",
    edit: "review-e2e-smoke-ce0b91f",
    verify: "e2e-smoke",
    shots: { desktop: "09-decision" },
    m3e: ["buttons"],
    decide: null,
  },
  {
    series: "A-ui-copy",
    slug: "editor-shortcut-sheet",
    title: "editor: ? でショートカット一覧",
    edit: "editor-shortcut-sheet",
    verify: "standard",
    shots: { desktop: "08-workspace-comment" },
    m3e: ["dialogs", "typography", "buttons"],
    decide: [
      {
        id: "2",
        q: "design-questions #2 コメントボタン",
        options: [{ id: "A", rec: true, text: "ツールバー", note: "Figma C" }],
      },
      {
        id: "3",
        q: "design-questions #3",
        options: [{ id: "A", rec: true, text: "エディタ内だけ", note: "58626f5" }],
      },
    ],
  },
  {
    series: "A-ui-copy",
    slug: "copy-deadline-term",
    title: "copy: 「校正の締切」→「校正期日」",
    patches: [
      "patches/p05-apps__web__src__features__editor__Editor.tsx.patch",
      "patches/p05-apps__web__src__features__work__WorksTable.tsx.patch",
      "patches/p05-apps__web__src__routes___app__check.tsx.patch",
      "patches/p05-apps__web__src__routes___app__make.tsx.patch",
      "patches/p05-apps__web__src__routes___app__works__index.tsx.patch",
    ],
    verify: "standard",
    shots: { desktop: "27-make-creator" },
    m3e: ["typography"],
    decide: null,
  },
  {
    series: "A-ui-copy",
    slug: "style-m3e-table-card-shape",
    title: "style(M3E): 表・KPI・コメントカードの shape と強調",
    patches: ["patches/p06-apps__web__src__styles.css.patch"],
    verify: "standard",
    shots: { desktop: "02-works-list" },
    m3e: ["shape", "cards"],
    decide: null,
  },
  {
    series: "A-ui-copy",
    slug: "test-e2e-screenshots-toolbar",
    title: "test(e2e): スクリーンショット手順をツールバー配置に合わせる",
    patches: ["patches/p07-apps__web__e2e__screenshots.mjs.patch"],
    verify: "e2e-smoke",
    shots: { desktop: "08-workspace-comment" },
    m3e: ["buttons"],
    decide: null,
  },
  {
    series: "A-ui-copy",
    slug: "copy-make-unsubmitted-line",
    title: "copy(make): 未提出行の「まだ版がありません」を削除",
    patches: ["patches/p08-apps__web__src__routes___app__make.tsx.patch"],
    verify: "standard",
    shots: { desktop: "27-make-creator" },
    m3e: ["lists"],
    decide: null,
  },
  {
    series: "A-ui-copy",
    slug: "ui-make-turn-section-layout",
    title: "copy(make): 「あなたの番」→「要対応」",
    edit: "make-turn-layout",
    verify: "standard",
    shots: { desktop: "27-make-creator", mobile: "20-mobile-make" },
    m3e: ["lists", "typography"],
    decide: null,
  },
  {
    series: "A-ui-copy",
    slug: "style-m3e-segmented-list",
    title: "style(M3E): 制作・校正一覧を segmented list に",
    patches: ["patches/p09-apps__web__src__features__workspace__parts.tsx.patch"],
    verify: "standard",
    shots: { desktop: "27-make-creator" },
    m3e: ["lists", "shape"],
    decide: [
      {
        id: "5",
        q: "design-questions #5",
        options: [{ id: "A", rec: true, text: "segmented list にする", note: "efdba20" }],
      },
    ],
  },
  {
    series: "A-ui-copy",
    slug: "style-m3e-table-header-segmented-css",
    title: "style(M3E): 表見出しのトーンと segmented list CSS",
    edit: "m3e-segmented-css",
    verify: "standard",
    shots: { desktop: "02-works-list" },
    m3e: ["lists", "color"],
    decide: [
      {
        id: "6",
        q: "design-questions #6 表見出し",
        options: [{ id: "A", rec: true, text: "surface-container-low", note: "青い帯にしない" }],
      },
    ],
  },
  {
    series: "A-ui-copy",
    slug: "copy-anata-phrasing",
    title: "copy: 画面の「あなた」表現を直す（InfoTab/WorkForm/AiBackground）",
    edit: "copy-anata-phrasing",
    verify: "standard",
    shots: { desktop: "08-workspace-comment" },
    m3e: ["typography"],
    decide: null,
  },
  {
    series: "A-ui-copy",
    slug: "copy-youtaiou-terminology",
    title: "copy: domain/docs の「要対応」用語統一",
    edit: "copy-youtaiou-terminology",
    verify: "standard",
    shots: { desktop: "27-make-creator" },
    m3e: ["typography"],
    decide: null,
  },
];

// Series B — dashboard
const seriesB = [
  {
    series: "B-dashboard",
    slug: "domain-work-stages-v7",
    title: "feat(domain): 7 段階 stage ID を追加（旧 stage と並行）",
    edit: "domain-stages-v7",
    verify: "full",
    shots: { desktop: "02-works-list" },
    m3e: ["color"],
    decide: [
      {
        id: "Q2",
        q: "監査 Q2 状態4つ",
        options: [{ id: "A", rec: true, text: "7 段階を新 ID で追加", note: "データ影響" }],
      },
    ],
  },
  {
    series: "B-dashboard",
    slug: "schema-revision-planned-at",
    title: "feat(schema): 版ごとの予定日フィールド",
    edit: "schema-revision-planned",
    verify: "full",
    shots: { desktop: "02-works-list" },
    m3e: ["typography"],
    decide: null,
  },
  {
    series: "B-dashboard",
    slug: "domain-danger-kpi",
    title: "feat(domain): 危ない KPI 定義（24h/3日）",
    edit: "domain-danger",
    verify: "full",
    shots: { desktop: "02-works-list" },
    m3e: ["color"],
    decide: null,
  },
  {
    series: "B-dashboard",
    slug: "demo-dashboard-role-homes",
    title: "feat(demo): ロール別ホーム用シード",
    edit: "demo-role-homes",
    verify: "standard",
    shots: { desktop: "27-make-creator" },
    m3e: ["cards"],
    decide: null,
  },
  {
    series: "B-dashboard",
    slug: "ui-home-view-switcher",
    title: "ui(home): ロール名なしのビュー切替",
    edit: "ui-view-switcher",
    verify: "standard",
    shots: { desktop: "27-make-creator" },
    m3e: ["buttonGroups"],
    decide: [
      {
        id: "38A",
        q: "ロール別ホーム",
        options: [
          { id: "A", rec: true, text: "画面上にロール名を出さない", note: "decisions 38A" },
        ],
      },
    ],
  },
  // ... more dashboard widgets - placeholders implemented incrementally
];

const seriesC = [
  {
    series: "C-detail",
    slug: "detail-route-shell",
    title: "ui(detail): 詳細画面ルートと 2 行見出し",
    edit: "detail-shell",
    verify: "standard",
    shots: { desktop: "08-workspace-comment" },
    m3e: ["typography", "shape"],
    decide: [
      {
        id: "59A",
        q: "詳細画面作り直し",
        options: [{ id: "A", rec: true, text: "初版から", note: "decisions 59A" }],
      },
    ],
  },
];

const queue = [...seriesA, ...seriesB, ...seriesC].map((item, i) => ({
  id: String(i + 1).padStart(3, "0"),
  ...item,
}));

fs.writeFileSync(path.join(import.meta.dirname, "manifest.json"), JSON.stringify(queue, null, 2));
console.log("manifest entries:", queue.length);
