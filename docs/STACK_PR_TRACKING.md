# Stacked PR トラッキング（Refine UI 改善）

`scripts/stack-pr/manifest.json` が正本。linear ブランチ `cursor/stack-linear-8b5a` をコミット列に分解し、各コミットを `cursor/stack-<id>-<slug>-8b5a` として publish する。

## 系列

| 系列        | 内容                                                                              | PR 数（manifest） |
| ----------- | --------------------------------------------------------------------------------- | ----------------- |
| A-ui-copy   | uploads 0001–0009 分解＋大地さん fb（反映ボタンは選択中のみ、「あなたの番」撤去） | 001–068           |
| B-dashboard | schema / domain / demo / ViewSwitcher（初版）                                     | 069–073           |
| C-detail    | 詳細ルートの殻                                                                    | 074               |

## 未着手（次の積み増し）

- ダッシュボード本体（manager / approver / member モックの KPI・グラフ・タイムライン）を部品 PR に分割（目標 30+ 本）
- 詳細画面（detail.png）の版コメント・情報校正・校了前チェックリスト
- design-questions #4 配色、#7 解決済み折りたたみ、#8 ナビ
- 監査 Q2 の UI への 7 段階反映（domain は 069 で ID のみ）
- 参考 patch `ref-ce0b91f` / `ref-44dba54` を `stack-linear` 先端に反映済み。**058–060・066 のリモート branch は `build-linear --from 058` で再 publish が必要**
- 44dba54 の残り分割候補: InfoTab/WorkForm/AiBackground（1 PR）、domain+docs 用語（1 PR）— 現状は 066 と同コミットに同梱

## 衝突

- 既存 PR #86 `cursor/transfer-work-creators-c30a`（WorksTable）— 取り込み順に注意

## 一覧

| #   | 系列        | タイトル                                                         | 決めること | ブランチ                                                                      |
| --- | ----------- | ---------------------------------------------------------------- | ---------- | ----------------------------------------------------------------------------- |
| 001 | A-ui-copy   | copy(labels): 採否を「反映する／反映しない／次の版で対応」に統一 | あり       | `cursor/stack-001-copy-labels-resolution-8b5a`                                |
| 002 | A-ui-copy   | copy(labels): 版の状態を「校正中／締切済み」に統一               | あり       | `cursor/stack-002-copy-labels-review-state-8b5a`                              |
| 003 | A-ui-copy   | copy(labels): 重要度 info を「参考」に                           | あり       | `cursor/stack-003-copy-labels-severity-info-8b5a`                             |
| 004 | A-ui-copy   | copy(labels): 校了操作を「校了する／未対応のまま校了」に         | あり       | `cursor/stack-004-copy-labels-approval-action-8b5a`                           |
| 005 | A-ui-copy   | copy(labels): コメント不可理由を短く                             | なし       | `cursor/stack-005-copy-labels-blocked-reason-8b5a`                            |
| 006 | A-ui-copy   | copy(labels): 通知種別ラベルを短く・用語統一                     | あり       | `cursor/stack-006-copy-labels-notifications-8b5a`                             |
| 007 | A-ui-copy   | copy(labels): 権限「編集（制作委任）」→「編集」                  | なし       | `cursor/stack-007-copy-labels-permission-edit-8b5a`                           |
| 008 | A-ui-copy   | copy(errors): 利用者向けエラーメッセージの短縮・用語統一         | なし       | `cursor/stack-008-copy-errors-messages-8b5a`                                  |
| 009 | A-ui-copy   | copy(errors): errors.test を新文言に合わせる                     | なし       | `cursor/stack-009-copy-errors-tests-8b5a`                                     |
| 010 | A-ui-copy   | copy(errors): failureText テストを新文言に合わせる               | なし       | `cursor/stack-010-copy-errors-failure-text-test-8b5a`                         |
| 011 | A-ui-copy   | copy: FigmaEmbedViewer.tsx.patch の文言短縮・用語統一            | なし       | `cursor/stack-011-copy-apps-web-src-features-annotation-FigmaEmbedViewe-8b5a` |
| 012 | A-ui-copy   | copy: VideoViewer.tsx.patch の文言短縮・用語統一                 | なし       | `cursor/stack-012-copy-apps-web-src-features-annotation-VideoViewer-tsx-8b5a` |
| 013 | A-ui-copy   | copy: WebLiveViewer.tsx.patch の文言短縮・用語統一               | なし       | `cursor/stack-013-copy-apps-web-src-features-annotation-WebLiveViewer-t-8b5a` |
| 014 | A-ui-copy   | copy: CompareButton.tsx.patch の文言短縮・用語統一               | なし       | `cursor/stack-014-copy-apps-web-src-features-compare-CompareButton-tsx--8b5a` |
| 015 | A-ui-copy   | copy: CrossWorkPicker.tsx.patch の文言短縮・用語統一             | なし       | `cursor/stack-015-copy-apps-web-src-features-compare-CrossWorkPicker-ts-8b5a` |
| 016 | A-ui-copy   | copy: PageMappingDialog.tsx.patch の文言短縮・用語統一           | なし       | `cursor/stack-016-copy-apps-web-src-features-compare-PageMappingDialog--8b5a` |
| 017 | A-ui-copy   | copy: EditorPending.tsx.patch の文言短縮・用語統一               | なし       | `cursor/stack-017-copy-apps-web-src-features-editor-EditorPending-tsx-p-8b5a` |
| 018 | A-ui-copy   | copy: InfoTab.tsx.patch の文言短縮・用語統一                     | なし       | `cursor/stack-018-copy-apps-web-src-features-editor-InfoTab-tsx-patch-8b5a`   |
| 019 | A-ui-copy   | copy: PaneHandle.tsx.patch の文言短縮・用語統一                  | なし       | `cursor/stack-019-copy-apps-web-src-features-editor-PaneHandle-tsx-patc-8b5a` |
| 020 | A-ui-copy   | copy: RevisionFiles.tsx.patch の文言短縮・用語統一               | なし       | `cursor/stack-020-copy-apps-web-src-features-editor-RevisionFiles-tsx-p-8b5a` |
| 021 | A-ui-copy   | copy: VersionsTab.tsx.patch の文言短縮・用語統一                 | なし       | `cursor/stack-021-copy-apps-web-src-features-editor-VersionsTab-tsx-pat-8b5a` |
| 022 | A-ui-copy   | copy: DashboardOverview.tsx.patch の文言短縮・用語統一           | なし       | `cursor/stack-022-copy-apps-web-src-features-home-DashboardOverview-tsx-8b5a` |
| 023 | A-ui-copy   | copy: SubmitPicker.tsx.patch の文言短縮・用語統一                | なし       | `cursor/stack-023-copy-apps-web-src-features-home-SubmitPicker-tsx-patc-8b5a` |
| 024 | A-ui-copy   | copy: AiAssist.tsx.patch の文言短縮・用語統一                    | なし       | `cursor/stack-024-copy-apps-web-src-features-notation-AiAssist-tsx-patc-8b5a` |
| 025 | A-ui-copy   | copy: AiBackground.tsx.patch の文言短縮・用語統一                | なし       | `cursor/stack-025-copy-apps-web-src-features-notation-AiBackground-tsx--8b5a` |
| 026 | A-ui-copy   | copy: ImportDialog.tsx.patch の文言短縮・用語統一                | なし       | `cursor/stack-026-copy-apps-web-src-features-notation-ImportDialog-tsx--8b5a` |
| 027 | A-ui-copy   | copy: SemanticRuleSearch.tsx.patch の文言短縮・用語統一          | なし       | `cursor/stack-027-copy-apps-web-src-features-notation-SemanticRuleSearc-8b5a` |
| 028 | A-ui-copy   | copy: NotificationPrompt.tsx.patch の文言短縮・用語統一          | なし       | `cursor/stack-028-copy-apps-web-src-features-notifications-Notification-8b5a` |
| 029 | A-ui-copy   | copy: PushSetting.tsx.patch の文言短縮・用語統一                 | なし       | `cursor/stack-029-copy-apps-web-src-features-notifications-PushSetting--8b5a` |
| 030 | A-ui-copy   | copy: ProcessingTools.tsx.patch の文言短縮・用語統一             | なし       | `cursor/stack-030-copy-apps-web-src-features-processing-ProcessingTools-8b5a` |
| 031 | A-ui-copy   | copy: CreatorNoteCard.tsx.patch の文言短縮・用語統一             | なし       | `cursor/stack-031-copy-apps-web-src-features-review-CreatorNoteCard-tsx-8b5a` |
| 032 | A-ui-copy   | copy: PostEditor.tsx.patch の文言短縮・用語統一                  | なし       | `cursor/stack-032-copy-apps-web-src-features-social-PostEditor-tsx-patc-8b5a` |
| 033 | A-ui-copy   | copy: PostReview.tsx.patch の文言短縮・用語統一                  | なし       | `cursor/stack-033-copy-apps-web-src-features-social-PostReview-tsx-patc-8b5a` |
| 034 | A-ui-copy   | copy: ProfilesAdmin.tsx.patch の文言短縮・用語統一               | なし       | `cursor/stack-034-copy-apps-web-src-features-social-ProfilesAdmin-tsx-p-8b5a` |
| 035 | A-ui-copy   | copy: PostPreview.tsx.patch の文言短縮・用語統一                 | なし       | `cursor/stack-035-copy-apps-web-src-features-social-preview-PostPreview-8b5a` |
| 036 | A-ui-copy   | copy: GroupsAdmin.tsx.patch の文言短縮・用語統一                 | なし       | `cursor/stack-036-copy-apps-web-src-features-team-GroupsAdmin-tsx-patch-8b5a` |
| 037 | A-ui-copy   | copy: TeamsAdmin.tsx.patch の文言短縮・用語統一                  | なし       | `cursor/stack-037-copy-apps-web-src-features-team-TeamsAdmin-tsx-patch-8b5a`  |
| 038 | A-ui-copy   | copy: SubmitDialog.tsx.patch の文言短縮・用語統一                | なし       | `cursor/stack-038-copy-apps-web-src-features-upload-SubmitDialog-tsx-pa-8b5a` |
| 039 | A-ui-copy   | copy: fileKind.test.ts.patch の文言短縮・用語統一                | なし       | `cursor/stack-039-copy-apps-web-src-features-upload-fileKind-test-ts-pa-8b5a` |
| 040 | A-ui-copy   | copy: AclPanel.tsx.patch の文言短縮・用語統一                    | なし       | `cursor/stack-040-copy-apps-web-src-features-work-AclPanel-tsx-patch-8b5a`    |
| 041 | A-ui-copy   | copy: ApproverFields.tsx.patch の文言短縮・用語統一              | なし       | `cursor/stack-041-copy-apps-web-src-features-work-ApproverFields-tsx-pa-8b5a` |
| 042 | A-ui-copy   | copy: ExportStatsDialog.tsx.patch の文言短縮・用語統一           | なし       | `cursor/stack-042-copy-apps-web-src-features-work-ExportStatsDialog-tsx-8b5a` |
| 043 | A-ui-copy   | copy: ImportWorksDialog.tsx.patch の文言短縮・用語統一           | なし       | `cursor/stack-043-copy-apps-web-src-features-work-ImportWorksDialog-tsx-8b5a` |
| 044 | A-ui-copy   | copy: ReviewersDialog.tsx.patch の文言短縮・用語統一             | なし       | `cursor/stack-044-copy-apps-web-src-features-work-ReviewersDialog-tsx-p-8b5a` |
| 045 | A-ui-copy   | copy: TagPicker.tsx.patch の文言短縮・用語統一                   | なし       | `cursor/stack-045-copy-apps-web-src-features-work-TagPicker-tsx-patch-8b5a`   |
| 046 | A-ui-copy   | copy: WorkForm.tsx.patch の文言短縮・用語統一                    | なし       | `cursor/stack-046-copy-apps-web-src-features-work-WorkForm-tsx-patch-8b5a`    |
| 047 | A-ui-copy   | copy: WorksTable.tsx.patch の文言短縮・用語統一                  | なし       | `cursor/stack-047-copy-apps-web-src-features-work-WorksTable-tsx-patch-8b5a`  |
| 048 | A-ui-copy   | copy: EditorMismatch.tsx.patch の文言短縮・用語統一              | なし       | `cursor/stack-048-copy-apps-web-src-features-writing-EditorMismatch-tsx-8b5a` |
| 049 | A-ui-copy   | copy: WriteEditor.tsx.patch の文言短縮・用語統一                 | なし       | `cursor/stack-049-copy-apps-web-src-features-writing-WriteEditor-tsx-pa-8b5a` |
| 050 | A-ui-copy   | copy: WritePanels.tsx.patch の文言短縮・用語統一                 | なし       | `cursor/stack-050-copy-apps-web-src-features-writing-WritePanels-tsx-pa-8b5a` |
| 051 | A-ui-copy   | copy: plainText.test.ts.patch の文言短縮・用語統一               | なし       | `cursor/stack-051-copy-apps-web-src-features-writing-plainText-test-ts--8b5a` |
| 052 | A-ui-copy   | copy: push.ts.patch の文言短縮・用語統一                         | なし       | `cursor/stack-052-copy-apps-web-src-lib-push-ts-patch-8b5a`                   |
| 053 | A-ui-copy   | copy: admin.tsx.patch の文言短縮・用語統一                       | なし       | `cursor/stack-053-copy-apps-web-src-routes-app-admin-tsx-patch-8b5a`          |
| 054 | A-ui-copy   | copy: check.tsx.patch の文言短縮・用語統一                       | なし       | `cursor/stack-054-copy-apps-web-src-routes-app-check-tsx-patch-8b5a`          |
| 055 | A-ui-copy   | copy: index.tsx.patch の文言短縮・用語統一                       | なし       | `cursor/stack-055-copy-apps-web-src-routes-app-works-index-tsx-patch-8b5a`    |
| 056 | A-ui-copy   | copy: signin.tsx.patch の文言短縮・用語統一                      | なし       | `cursor/stack-056-copy-apps-web-src-routes-signin-tsx-patch-8b5a`             |
| 057 | A-ui-copy   | copy: DateField.tsx.patch の文言短縮・用語統一                   | なし       | `cursor/stack-057-copy-apps-web-src-ui-DateField-tsx-patch-8b5a`              |
| 058 | A-ui-copy   | review: 選んだ／フォーカスしたコメントにだけ採否ボタン行           | あり       | `cursor/stack-058-review-decide-buttons-panel-8b5a`                           |
| 059 | A-ui-copy   | review: 一覧カードは小さな状態表示のみ（✓ クイック操作をやめる） | なし       | `cursor/stack-059-review-card-status-not-actions-8b5a`                        |
| 060 | A-ui-copy   | test(e2e): 反映ボタン行に合わせ decision spec を更新             | なし       | `cursor/stack-060-review-e2e-decision-8b5a`                                   |
| 061 | A-ui-copy   | editor: ? でショートカット一覧                                   | あり       | `cursor/stack-061-editor-shortcut-sheet-8b5a`                                 |
| 062 | A-ui-copy   | copy: 「校正の締切」→「校正期日」                                | なし       | `cursor/stack-062-copy-deadline-term-8b5a`                                    |
| 063 | A-ui-copy   | style(M3E): 表・KPI・コメントカードの shape と強調               | なし       | `cursor/stack-063-style-m3e-table-card-shape-8b5a`                            |
| 064 | A-ui-copy   | test(e2e): スクリーンショット手順をツールバー配置に合わせる      | なし       | `cursor/stack-064-test-e2e-screenshots-toolbar-8b5a`                          |
| 065 | A-ui-copy   | copy(make): 未提出行の「まだ版がありません」を削除               | なし       | `cursor/stack-065-copy-make-unsubmitted-line-8b5a`                            |
| 066 | A-ui-copy   | ui(make): 「あなたの番」見出しをやめ件数バッジで区切る           | なし       | `cursor/stack-066-ui-make-turn-section-layout-8b5a`                           |
| 067 | A-ui-copy   | style(M3E): 制作・校正一覧を segmented list に                   | あり       | `cursor/stack-067-style-m3e-segmented-list-8b5a`                              |
| 068 | A-ui-copy   | style(M3E): 表見出しのトーンと segmented list CSS                | あり       | `cursor/stack-068-style-m3e-table-header-segmented-css-8b5a`                  |
| 069 | B-dashboard | feat(domain): 7 段階 stage ID を追加（旧 stage と並行）          | あり       | `cursor/stack-069-domain-work-stages-v7-8b5a`                                 |
| 070 | B-dashboard | feat(schema): 版ごとの予定日フィールド                           | なし       | `cursor/stack-070-schema-revision-planned-at-8b5a`                            |
| 071 | B-dashboard | feat(domain): 危ない KPI 定義（24h/3日）                         | なし       | `cursor/stack-071-domain-danger-kpi-8b5a`                                     |
| 072 | B-dashboard | feat(demo): ロール別ホーム用シード                               | なし       | `cursor/stack-072-demo-dashboard-role-homes-8b5a`                             |
| 073 | B-dashboard | ui(home): ロール名なしのビュー切替                               | あり       | `cursor/stack-073-ui-home-view-switcher-8b5a`                                 |
| 074 | C-detail    | ui(detail): 詳細画面ルートと 2 行見出し                          | あり       | `cursor/stack-074-detail-route-shell-8b5a`                                    |
