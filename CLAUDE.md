# MF100 校正システム — 作業メモ（AI/人間共通）

- 要件の正本: `docs/REQUIREMENTS.md`（v1.1）。矛盾する資料より優先。決定ログ: `docs/DECISIONS.md`。
- 依存の向き: `apps/* → packages/application → packages/domain`。業務ルールは domain に書き、Convex 関数はアダプタに留める。
- 制度承認待ち（D2/D3 など）は `ApprovalPolicy` 等のポリシー値として外出しし、コードで業務規則を確定しない。
- ツールチェーンは Vite+（`vp`）。`pnpm check` / `pnpm test` / `pnpm typecheck` を変更後に実行する。
- Convex の `_generated` はコミット対象。モジュール追加後は `pnpm codegen`（または `npx convex dev`）。
- 本番デプロイ・課金・過去データ移行・外部への実データ送信は明示承認まで行わない。
