import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";

const root = "/workspace";
const stackDir = path.join(root, "scripts/stack-pr");

export function applyPatches(names) {
  for (const n of names ?? []) {
    const candidates = [
      path.join(stackDir, n),
      path.join(stackDir, "patches", n),
      path.join(stackDir, "patches", path.basename(n)),
    ];
    const file = candidates.find((p) => fs.existsSync(p));
    if (!file) throw new Error(`patch missing: ${n}`);
    execSync(`git apply --whitespace=nowarn ${JSON.stringify(file)}`, { cwd: root, stdio: "inherit" });
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
        ['  not_latest: "最新の受付対象版ではありません",', '  not_latest: "最新の版ではありません",'],
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
      patchFile("apps/web/src/lib/labels.ts", [
        ['  edit: "編集（制作委任）",', '  edit: "編集",'],
      ]);
      return;
    case "errors-approver":
      applyPatches(["patches/p01-apps__web__src__lib__errors.ts.patch"]);
      return;
    case "review-panel-decide":
      applyPatches([
        "patches/p03-apps__web__src__features__review__ThreadPanel.tsx.patch",
        "patches/p03-apps__web__src__features__review__ThreadPanel.css.patch",
        "patches/p03-apps__web__src__features__review__ThreadCard.tsx.patch",
      ]);
      return;
    case "review-card-status": {
      const card = path.join(root, "apps/web/src/features/review/ThreadCard.tsx");
      let s = fs.readFileSync(card, "utf8");
      s = s.replace(
        /          \{canDecide && !closed \? \([\s\S]*?\) : null\}\n/,
        "",
      );
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
      s = s.replace('<Group title="あなたの番" count={turn.length}>', '<Group title="" label="今すぐ" count={turn.length} className="dash__section--now">');
      s = s.replace(
        " * - 進行中: 「あなたの番」（未対応のコメントに返事をする・次の版を出す）",
        " * - 進行中: 今すぐ（未対応のコメント・次の版。見出しは件数バッジで示す）",
      );
      fs.writeFileSync(make, s);
      const parts = path.join(root, "apps/web/src/features/workspace/parts.tsx");
      let p = fs.readFileSync(parts, "utf8");
      if (!p.includes("dash__title--sr")) {
        p = p.replace(
          `        >
          {title}
        </M3eHeading>`,
          `        >
          {title ? title : <span className="dash__title--sr">今すぐ</span>}
        </M3eHeading>`,
        );
        fs.writeFileSync(parts, p);
      }
      const css = path.join(root, "apps/web/src/styles.css");
      let c = fs.readFileSync(css, "utf8");
      if (!c.includes("dash__title--sr")) {
        c += `\n.dash__title--sr {\n  position: absolute;\n  width: 1px;\n  height: 1px;\n  overflow: hidden;\n  clip: rect(0, 0, 0, 0);\n}\n.dash__section--now .dash__head {\n  gap: 8px;\n}\n`;
        fs.writeFileSync(css, c);
      }
      return;
    }
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
    case "m3e-segmented-css": {
      applyPatches(["patches/p09-apps__web__src__styles.css.patch"]);
      return;
    }
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

export function applyItem(item) {
  if (item.patches?.length) applyPatches(item.patches);
  if (item.edit) applyEdit(item.edit);
}
