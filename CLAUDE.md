# MF100 校正システム — 作業メモ（AI/人間共通）

- 要件の正本: `docs/REQUIREMENTS.md`（v1.1）。矛盾する資料より優先。決定ログ: `docs/DECISIONS.md`。
- 依存の向き: `apps/* → packages/application → packages/domain`。業務ルールは domain に書き、Convex 関数はアダプタに留める。
- 制度承認待ち（D2/D3 など）は `ApprovalPolicy` 等のポリシー値として外出しし、コードで業務規則を確定しない。
- ツールチェーンは Vite+（`vp`）。`pnpm check` / `pnpm test` / `pnpm typecheck` を変更後に実行する。
- Convex の `_generated` はコミット対象。モジュール追加後は `pnpm codegen`（または `npx convex dev`）。
- ブランチは `main ← develop ← feat-*`。機能は develop へ、本番は develop→main の merge。main への到達で本番 CD が走る（Environment `production` に承認者を置けばそこで止まる）。課金・過去データ移行・外部への実データ送信は明示承認まで行わない。
- テスト: 業務規則は domain / application の単体で先に（pstack `tdd`）。画面の流れは `apps/web/e2e/specs`（Playwright Test。spec ごとに前提を自分で用意し、画面の部品は `e2e/support/app.ts` に集める）、撮影と a11y は `e2e/screenshots.mjs`。文言は確かめない。画面に触れたら `pnpm --filter @mf100/web e2e:smoke` と該当 spec。方針は `docs/TESTING_AGENT_POLICY.md`、動かして確かめる手順はスキル `verify-mf100-web`、E2E を足す手順は `e2e-from-spec`。
