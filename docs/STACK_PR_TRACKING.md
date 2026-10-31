# STACK PR トラッキング

正本: `scripts/stack-pr/manifest.json`（76 件）

## develop マージ進捗（001–070）

`origin/develop` @ `554c6281ef2d1670ec22be73a6a9ec5e992df797`（2026-10-31 UTC・merge-batch 実行中）

| id | PR | develop | メモ |
|---|---:|---|---|
| 001–014 | #93–#107 | ✅ | `merge-one.sh` + PDF marker（#96/#95 は develop に MERGED 表示） |
| 015–070 | #104–#166 | 🔄 | tmux `merge-batch-008-070.sh` 順次（**#129 は対象外**） |
| 071–076 | #165,#163,#162,#168,#167,#169 | — | develop マージ後 #165 base→develop（**ManagePullRequest**）。現 base は stack 071–075 上 |

手順: `scripts/stack-pr/merge-one.sh` / `merge-batch-008-070.sh`。retarget・PDF コメントは **ManagePullRequest**（`gh` integration 403）。

### 071–076 CI（2026-10-31・マージしない）

| PR | id | base | CI |
|---:|---|---|---|
| #165 | 071 | `cursor/stack-070-copy-youtaiou-terminology-v2-8b5a` | verify 系 + e2e-smoke 緑 |
| #163 | 072 | `cursor/stack-071-domain-work-stages-v7-v2-8b5a` | 緑 |
| #162 | 073 | `cursor/stack-072-schema-revision-planned-at-v2-8b5a` | 緑 |
| #168 | 074 | `cursor/stack-073-domain-danger-kpi-v2-8b5a` | 緑 |
| #167 | 075 | `cursor/stack-074-demo-dashboard-role-homes-v2-8b5a` | 緑 |
| #169 | 076 | `cursor/stack-075-ui-home-view-switcher-v2-8b5a` | 緑 |

### C/D ダッシュボード mock（076 上・未マージ）

| id | ブランチ | 備考 |
|---|---|---|
| 077 | `cursor/stack-077-ui-delay-color-tokens-8b5a` | push 済。PR 作成は ManagePullRequest（gh create 403）→ [compare](https://github.com/k0chiii/Refine-demo/compare/cursor/stack-076-detail-route-shell-v2-8b5a...cursor/stack-077-ui-delay-color-tokens-8b5a) |
| 078–088 | — | `manifest-dashboard-cd.json` 残り（未 push） |

### スクリーンショット

- `scripts/stack-pr/capture.ts` … `App.signInAs` / `App.go` + `build:demo` + signin md5 `ac741f735c6593b5cbdc397deb4a8004` 拒否
- `node scripts/stack-pr/retake-screenshots.mjs --ids=071,072,073,074,075,076`（412px mobile）

## 使っていないブランチ（v1・058–074 再積み前）

058 以降の再ビルドは `-v2-8b5a` ブランチで PR 化。以下は **上書き・削除せず未使用**:

- `cursor/stack-058-review-decide-buttons-panel-8b5a` → 代わりに `...-v2-8b5a`
- `cursor/stack-059-review-card-status-not-actions-8b5a` → 代わりに `...-v2-8b5a`
- `cursor/stack-060-review-e2e-decision-8b5a` → 代わりに `...-v2-8b5a`
- `cursor/stack-061-editor-shortcut-sheet-8b5a` → 代わりに `...-v2-8b5a`
- `cursor/stack-062-copy-deadline-term-8b5a` → 代わりに `...-v2-8b5a`
- `cursor/stack-063-style-m3e-table-card-shape-8b5a` → 代わりに `...-v2-8b5a`
- `cursor/stack-064-test-e2e-screenshots-toolbar-8b5a` → 代わりに `...-v2-8b5a`
- `cursor/stack-065-copy-make-unsubmitted-line-8b5a` → 代わりに `...-v2-8b5a`
- `cursor/stack-066-ui-make-turn-section-layout-8b5a` → 代わりに `...-v2-8b5a`
- `cursor/stack-067-style-m3e-segmented-list-8b5a` → 代わりに `...-v2-8b5a`
- `cursor/stack-068-style-m3e-table-header-segmented-css-8b5a` → 代わりに `...-v2-8b5a`
- `cursor/stack-069-copy-anata-phrasing-8b5a` → 代わりに `...-v2-8b5a`
- `cursor/stack-070-copy-youtaiou-terminology-8b5a` → 代わりに `...-v2-8b5a`
- `cursor/stack-071-domain-work-stages-v7-8b5a` → 代わりに `...-v2-8b5a`
- `cursor/stack-072-schema-revision-planned-at-8b5a` → 代わりに `...-v2-8b5a`
- `cursor/stack-073-domain-danger-kpi-8b5a` → 代わりに `...-v2-8b5a`
- `cursor/stack-074-demo-dashboard-role-homes-8b5a` → 代わりに `...-v2-8b5a`

用語分割（069/070 挿入）以前の id 付け替えで、旧 `stack-069-domain...` 等も未使用の可能性あり。リモートに残っているものは同様に触らない。

## 一覧

| id | 系列 | PR branch | base | 決めること |
|---|---|---|---|---|
| 001 | A-ui-copy | `cursor/stack-001-copy-labels-resolution-8b5a` | `develop` | あり |
| 002 | A-ui-copy | `cursor/stack-002-copy-labels-review-state-8b5a` | `cursor/stack-001-copy-labels-resolution-8b5a` | あり |
| 003 | A-ui-copy | `cursor/stack-003-copy-labels-severity-info-8b5a` | `cursor/stack-002-copy-labels-review-state-8b5a` | あり |
| 004 | A-ui-copy | `cursor/stack-004-copy-labels-approval-action-8b5a` | `cursor/stack-003-copy-labels-severity-info-8b5a` | あり |
| 005 | A-ui-copy | `cursor/stack-005-copy-labels-blocked-reason-8b5a` | `cursor/stack-004-copy-labels-approval-action-8b5a` | なし |
| 006 | A-ui-copy | `cursor/stack-006-copy-labels-notifications-8b5a` | `cursor/stack-005-copy-labels-blocked-reason-8b5a` | あり |
| 007 | A-ui-copy | `cursor/stack-007-copy-labels-permission-edit-8b5a` | `cursor/stack-006-copy-labels-notifications-8b5a` | なし |
| 008 | A-ui-copy | `cursor/stack-008-copy-errors-messages-8b5a` | `cursor/stack-007-copy-labels-permission-edit-8b5a` | なし |
| 009 | A-ui-copy | `cursor/stack-009-copy-errors-tests-8b5a` | `cursor/stack-008-copy-errors-messages-8b5a` | なし |
| 010 | A-ui-copy | `cursor/stack-010-copy-errors-failure-text-test-8b5a` | `cursor/stack-009-copy-errors-tests-8b5a` | なし |
| 011 | A-ui-copy | `cursor/stack-011-copy-apps-web-src-features-annotation-FigmaEmbedViewe-8b5a` | `cursor/stack-010-copy-errors-failure-text-test-8b5a` | なし |
| 012 | A-ui-copy | `cursor/stack-012-copy-apps-web-src-features-annotation-VideoViewer-tsx-8b5a` | `cursor/stack-011-copy-apps-web-src-features-annotation-FigmaEmbedViewe-8b5a` | なし |
| 013 | A-ui-copy | `cursor/stack-013-copy-apps-web-src-features-annotation-WebLiveViewer-t-8b5a` | `cursor/stack-012-copy-apps-web-src-features-annotation-VideoViewer-tsx-8b5a` | なし |
| 014 | A-ui-copy | `cursor/stack-014-copy-apps-web-src-features-compare-CompareButton-tsx--8b5a` | `cursor/stack-013-copy-apps-web-src-features-annotation-WebLiveViewer-t-8b5a` | なし |
| 015 | A-ui-copy | `cursor/stack-015-copy-apps-web-src-features-compare-CrossWorkPicker-ts-8b5a` | `cursor/stack-014-copy-apps-web-src-features-compare-CompareButton-tsx--8b5a` | なし |
| 016 | A-ui-copy | `cursor/stack-016-copy-apps-web-src-features-compare-PageMappingDialog--8b5a` | `cursor/stack-015-copy-apps-web-src-features-compare-CrossWorkPicker-ts-8b5a` | なし |
| 017 | A-ui-copy | `cursor/stack-017-copy-apps-web-src-features-editor-EditorPending-tsx-p-8b5a` | `cursor/stack-016-copy-apps-web-src-features-compare-PageMappingDialog--8b5a` | なし |
| 018 | A-ui-copy | `cursor/stack-018-copy-apps-web-src-features-editor-InfoTab-tsx-patch-8b5a` | `cursor/stack-017-copy-apps-web-src-features-editor-EditorPending-tsx-p-8b5a` | なし |
| 019 | A-ui-copy | `cursor/stack-019-copy-apps-web-src-features-editor-PaneHandle-tsx-patc-8b5a` | `cursor/stack-018-copy-apps-web-src-features-editor-InfoTab-tsx-patch-8b5a` | なし |
| 020 | A-ui-copy | `cursor/stack-020-copy-apps-web-src-features-editor-RevisionFiles-tsx-p-8b5a` | `cursor/stack-019-copy-apps-web-src-features-editor-PaneHandle-tsx-patc-8b5a` | なし |
| 021 | A-ui-copy | `cursor/stack-021-copy-apps-web-src-features-editor-VersionsTab-tsx-pat-8b5a` | `cursor/stack-020-copy-apps-web-src-features-editor-RevisionFiles-tsx-p-8b5a` | なし |
| 022 | A-ui-copy | `cursor/stack-022-copy-apps-web-src-features-home-DashboardOverview-tsx-8b5a` | `cursor/stack-021-copy-apps-web-src-features-editor-VersionsTab-tsx-pat-8b5a` | なし |
| 023 | A-ui-copy | `cursor/stack-023-copy-apps-web-src-features-home-SubmitPicker-tsx-patc-8b5a` | `cursor/stack-022-copy-apps-web-src-features-home-DashboardOverview-tsx-8b5a` | なし |
| 024 | A-ui-copy | `cursor/stack-024-copy-apps-web-src-features-notation-AiAssist-tsx-patc-8b5a` | `cursor/stack-023-copy-apps-web-src-features-home-SubmitPicker-tsx-patc-8b5a` | なし |
| 025 | A-ui-copy | `cursor/stack-025-copy-apps-web-src-features-notation-AiBackground-tsx--8b5a` | `cursor/stack-024-copy-apps-web-src-features-notation-AiAssist-tsx-patc-8b5a` | なし |
| 026 | A-ui-copy | `cursor/stack-026-copy-apps-web-src-features-notation-ImportDialog-tsx--8b5a` | `cursor/stack-025-copy-apps-web-src-features-notation-AiBackground-tsx--8b5a` | なし |
| 027 | A-ui-copy | `cursor/stack-027-copy-apps-web-src-features-notation-SemanticRuleSearc-8b5a` | `cursor/stack-026-copy-apps-web-src-features-notation-ImportDialog-tsx--8b5a` | なし |
| 028 | A-ui-copy | `cursor/stack-028-copy-apps-web-src-features-notifications-Notification-8b5a` | `cursor/stack-027-copy-apps-web-src-features-notation-SemanticRuleSearc-8b5a` | なし |
| 029 | A-ui-copy | `cursor/stack-029-copy-apps-web-src-features-notifications-PushSetting--8b5a` | `cursor/stack-028-copy-apps-web-src-features-notifications-Notification-8b5a` | なし |
| 030 | A-ui-copy | `cursor/stack-030-copy-apps-web-src-features-processing-ProcessingTools-8b5a` | `cursor/stack-029-copy-apps-web-src-features-notifications-PushSetting--8b5a` | なし |
| 031 | A-ui-copy | `cursor/stack-031-copy-apps-web-src-features-review-CreatorNoteCard-tsx-8b5a` | `cursor/stack-030-copy-apps-web-src-features-processing-ProcessingTools-8b5a` | なし |
| 032 | A-ui-copy | `cursor/stack-032-copy-apps-web-src-features-social-PostEditor-tsx-patc-8b5a` | `cursor/stack-031-copy-apps-web-src-features-review-CreatorNoteCard-tsx-8b5a` | なし |
| 033 | A-ui-copy | `cursor/stack-033-copy-apps-web-src-features-social-PostReview-tsx-patc-8b5a` | `cursor/stack-032-copy-apps-web-src-features-social-PostEditor-tsx-patc-8b5a` | なし |
| 034 | A-ui-copy | `cursor/stack-034-copy-apps-web-src-features-social-ProfilesAdmin-tsx-p-8b5a` | `cursor/stack-033-copy-apps-web-src-features-social-PostReview-tsx-patc-8b5a` | なし |
| 035 | A-ui-copy | `cursor/stack-035-copy-apps-web-src-features-social-preview-PostPreview-8b5a` | `cursor/stack-034-copy-apps-web-src-features-social-ProfilesAdmin-tsx-p-8b5a` | なし |
| 036 | A-ui-copy | `cursor/stack-036-copy-apps-web-src-features-team-GroupsAdmin-tsx-patch-8b5a` | `cursor/stack-035-copy-apps-web-src-features-social-preview-PostPreview-8b5a` | なし |
| 037 | A-ui-copy | `cursor/stack-037-copy-apps-web-src-features-team-TeamsAdmin-tsx-patch-8b5a` | `cursor/stack-036-copy-apps-web-src-features-team-GroupsAdmin-tsx-patch-8b5a` | なし |
| 038 | A-ui-copy | `cursor/stack-038-copy-apps-web-src-features-upload-SubmitDialog-tsx-pa-8b5a` | `cursor/stack-037-copy-apps-web-src-features-team-TeamsAdmin-tsx-patch-8b5a` | なし |
| 039 | A-ui-copy | `cursor/stack-039-copy-apps-web-src-features-upload-fileKind-test-ts-pa-8b5a` | `cursor/stack-038-copy-apps-web-src-features-upload-SubmitDialog-tsx-pa-8b5a` | なし |
| 040 | A-ui-copy | `cursor/stack-040-copy-apps-web-src-features-work-AclPanel-tsx-patch-8b5a` | `cursor/stack-039-copy-apps-web-src-features-upload-fileKind-test-ts-pa-8b5a` | なし |
| 041 | A-ui-copy | `cursor/stack-041-copy-apps-web-src-features-work-ApproverFields-tsx-pa-8b5a` | `cursor/stack-040-copy-apps-web-src-features-work-AclPanel-tsx-patch-8b5a` | なし |
| 042 | A-ui-copy | `cursor/stack-042-copy-apps-web-src-features-work-ExportStatsDialog-tsx-8b5a` | `cursor/stack-041-copy-apps-web-src-features-work-ApproverFields-tsx-pa-8b5a` | なし |
| 043 | A-ui-copy | `cursor/stack-043-copy-apps-web-src-features-work-ImportWorksDialog-tsx-8b5a` | `cursor/stack-042-copy-apps-web-src-features-work-ExportStatsDialog-tsx-8b5a` | なし |
| 044 | A-ui-copy | `cursor/stack-044-copy-apps-web-src-features-work-ReviewersDialog-tsx-p-8b5a` | `cursor/stack-043-copy-apps-web-src-features-work-ImportWorksDialog-tsx-8b5a` | なし |
| 045 | A-ui-copy | `cursor/stack-045-copy-apps-web-src-features-work-TagPicker-tsx-patch-8b5a` | `cursor/stack-044-copy-apps-web-src-features-work-ReviewersDialog-tsx-p-8b5a` | なし |
| 046 | A-ui-copy | `cursor/stack-046-copy-apps-web-src-features-work-WorkForm-tsx-patch-8b5a` | `cursor/stack-045-copy-apps-web-src-features-work-TagPicker-tsx-patch-8b5a` | なし |
| 047 | A-ui-copy | `cursor/stack-047-copy-apps-web-src-features-work-WorksTable-tsx-patch-8b5a` | `cursor/stack-046-copy-apps-web-src-features-work-WorkForm-tsx-patch-8b5a` | なし |
| 048 | A-ui-copy | `cursor/stack-048-copy-apps-web-src-features-writing-EditorMismatch-tsx-8b5a` | `cursor/stack-047-copy-apps-web-src-features-work-WorksTable-tsx-patch-8b5a` | なし |
| 049 | A-ui-copy | `cursor/stack-049-copy-apps-web-src-features-writing-WriteEditor-tsx-pa-8b5a` | `cursor/stack-048-copy-apps-web-src-features-writing-EditorMismatch-tsx-8b5a` | なし |
| 050 | A-ui-copy | `cursor/stack-050-copy-apps-web-src-features-writing-WritePanels-tsx-pa-8b5a` | `cursor/stack-049-copy-apps-web-src-features-writing-WriteEditor-tsx-pa-8b5a` | なし |
| 051 | A-ui-copy | `cursor/stack-051-copy-apps-web-src-features-writing-plainText-test-ts--8b5a` | `cursor/stack-050-copy-apps-web-src-features-writing-WritePanels-tsx-pa-8b5a` | なし |
| 052 | A-ui-copy | `cursor/stack-052-copy-apps-web-src-lib-push-ts-patch-8b5a` | `cursor/stack-051-copy-apps-web-src-features-writing-plainText-test-ts--8b5a` | なし |
| 053 | A-ui-copy | `cursor/stack-053-copy-apps-web-src-routes-app-admin-tsx-patch-8b5a` | `cursor/stack-052-copy-apps-web-src-lib-push-ts-patch-8b5a` | なし |
| 054 | A-ui-copy | `cursor/stack-054-copy-apps-web-src-routes-app-check-tsx-patch-8b5a` | `cursor/stack-053-copy-apps-web-src-routes-app-admin-tsx-patch-8b5a` | なし |
| 055 | A-ui-copy | `cursor/stack-055-copy-apps-web-src-routes-app-works-index-tsx-patch-8b5a` | `cursor/stack-054-copy-apps-web-src-routes-app-check-tsx-patch-8b5a` | なし |
| 056 | A-ui-copy | `cursor/stack-056-copy-apps-web-src-routes-signin-tsx-patch-8b5a` | `cursor/stack-055-copy-apps-web-src-routes-app-works-index-tsx-patch-8b5a` | なし |
| 057 | A-ui-copy | `cursor/stack-057-copy-apps-web-src-ui-DateField-tsx-patch-8b5a` | `cursor/stack-056-copy-apps-web-src-routes-signin-tsx-patch-8b5a` | なし |
| 058 | A-ui-copy | `cursor/stack-058-review-decide-buttons-panel-v2-8b5a` | `cursor/stack-057-copy-apps-web-src-ui-DateField-tsx-patch-8b5a` | あり |
| 059 | A-ui-copy | `cursor/stack-059-review-card-status-not-actions-v2-8b5a` | `cursor/stack-058-review-decide-buttons-panel-v2-8b5a` | なし |
| 060 | A-ui-copy | `cursor/stack-060-review-e2e-decision-v2-8b5a` | `cursor/stack-059-review-card-status-not-actions-v2-8b5a` | なし |
| 061 | A-ui-copy | `cursor/stack-061-editor-shortcut-sheet-v2-8b5a` | `cursor/stack-060-review-e2e-decision-v2-8b5a` | あり |
| 062 | A-ui-copy | `cursor/stack-062-copy-deadline-term-v2-8b5a` | `cursor/stack-061-editor-shortcut-sheet-v2-8b5a` | なし |
| 063 | A-ui-copy | `cursor/stack-063-style-m3e-table-card-shape-v2-8b5a` | `cursor/stack-062-copy-deadline-term-v2-8b5a` | なし |
| 064 | A-ui-copy | `cursor/stack-064-test-e2e-screenshots-toolbar-v2-8b5a` | `cursor/stack-063-style-m3e-table-card-shape-v2-8b5a` | なし |
| 065 | A-ui-copy | `cursor/stack-065-copy-make-unsubmitted-line-v2-8b5a` | `cursor/stack-064-test-e2e-screenshots-toolbar-v2-8b5a` | なし |
| 066 | A-ui-copy | `cursor/stack-066-ui-make-turn-section-layout-v2-8b5a` | `cursor/stack-065-copy-make-unsubmitted-line-v2-8b5a` | なし |
| 067 | A-ui-copy | `cursor/stack-067-style-m3e-segmented-list-v2-8b5a` | `cursor/stack-066-ui-make-turn-section-layout-v2-8b5a` | あり |
| 068 | A-ui-copy | `cursor/stack-068-style-m3e-table-header-segmented-css-v2-8b5a` | `cursor/stack-067-style-m3e-segmented-list-v2-8b5a` | あり |
| 069 | A-ui-copy | `cursor/stack-069-copy-anata-phrasing-v2-8b5a` | `cursor/stack-068-style-m3e-table-header-segmented-css-v2-8b5a` | なし |
| 070 | A-ui-copy | `cursor/stack-070-copy-youtaiou-terminology-v2-8b5a` | `cursor/stack-069-copy-anata-phrasing-v2-8b5a` | なし |
| 071 | B-dashboard | `cursor/stack-071-domain-work-stages-v7-v2-8b5a` | `cursor/stack-070-copy-youtaiou-terminology-v2-8b5a` | あり |
| 072 | B-dashboard | `cursor/stack-072-schema-revision-planned-at-v2-8b5a` | `cursor/stack-071-domain-work-stages-v7-v2-8b5a` | なし |
| 073 | B-dashboard | `cursor/stack-073-domain-danger-kpi-v2-8b5a` | `cursor/stack-072-schema-revision-planned-at-v2-8b5a` | なし |
| 074 | B-dashboard | `cursor/stack-074-demo-dashboard-role-homes-v2-8b5a` | `cursor/stack-073-domain-danger-kpi-v2-8b5a` | なし |
| 075 | B-dashboard | `cursor/stack-075-ui-home-view-switcher-v2-8b5a` | `cursor/stack-074-demo-dashboard-role-homes-v2-8b5a` | あり |
| 076 | C-detail | `cursor/stack-076-detail-route-shell-v2-8b5a` | `cursor/stack-075-ui-home-view-switcher-v2-8b5a` | あり |

## 参照

- 集成: `origin/cursor/stack-linear-v2-8b5a`
- 本文生成: `node scripts/stack-pr/write-pr-bodies.mjs`
- **未作成 PR の一括作成**: Cloud Agent が `node scripts/stack-pr/agent-bulk-create-prs.mjs` の出力を見て `ManagePullRequest` で create（`gh pr create` は integration 権限不足）
- 2026-10-30: #108–#128 まで 016–036 を作成済み。037–076 は `agent-bulk-create-prs.mjs` で pending 確認後に同手順で続行
