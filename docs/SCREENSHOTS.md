# 画面一覧（デモモードで撮影）

`apps/web` の**デモモード**（`pnpm build:demo` → `vp preview --mode demo`、バックエンド無しで Convex の実関数を `convex-test` によりブラウザ内実行）で、Nogiku モック委員 5 名を切り替えながら「登録済み制作物 → 版提出（専門確認の宣言） → 割当 → 指摘 → 専門確認完了 → 採否 → 第2版提出と指摘の持越 → 校了 → 通知」を一周して撮影した（v1 機能を含む）。撮影スクリプト: `apps/web/e2e/screenshots.mjs`（`pnpm screenshots`）。

| #   | 画面（要件 §4）                                     | 役割           | 画像                                              |
| --- | --------------------------------------------------- | -------------- | ------------------------------------------------- |
| 1   | サインイン（Nogiku SSO / 開発用モック）             | —              | ![](screenshots/01-signin.png)                    |
| 2   | U-02 制作物一覧（権限のある作品のみ）               | 制作者         | ![](screenshots/02-works-list.png)                |
| 3   | U-03 制作物詳細（版未提出）                         | 制作者         | ![](screenshots/03-work-detail-empty.png)         |
| 4   | U-04 版提出: 全ファイル検証済み（確定前）           | 制作者         | ![](screenshots/04-submit-verified.png)           |
| 5   | U-04 版提出: 提出確定                               | 制作者         | ![](screenshots/05-submit-confirmed.png)          |
| 6   | U-03 制作物詳細（第1版受付中・校正者割当後）        | 主管           | ![](screenshots/06-work-detail-with-revision.png) |
| 7   | U-01 自分の校正待ち                                 | 校正者         | ![](screenshots/07-queue.png)                     |
| 8   | U-05 校正ワークスペース: PDF に範囲指定した重大指摘 | 校正者         | ![](screenshots/08-workspace-comment.png)         |
| 9   | U-06 指摘対応: 理由付き不採用と履歴                 | 制作者         | ![](screenshots/09-decision.png)                  |
| 10  | U-07 校了ダイアログ（対象版・未対応件数・例外理由） | 校了権限者     | ![](screenshots/10-finalize-dialog.png)           |
| 11  | U-03 校了後（校了履歴・校了版）                     | 校了権限者     | ![](screenshots/11-work-finalized.png)            |
| 12  | U-08 作品の閲覧権限（個人 ACL）と変更履歴           | システム管理者 | ![](screenshots/12-acl.png)                       |
| 13  | U-08 管理（ACL 対象作品・ユーザー・監査ログ）       | システム管理者 | ![](screenshots/13-admin-audit.png)               |
| 14  | v1 U-04 版提出: 専門確認の宣言と担当者選択          | 制作者         | ![](screenshots/14-submit-required-checks.png)    |
| 15  | v1 制作物の編集（職責はユーザー選択 UI）            | 主管           | ![](screenshots/15-work-edit.png)                 |
| 16  | v1 U-05 専門確認パネル（担当者が確認完了）          | 校正者         | ![](screenshots/16-required-check-done.png)       |
| 17  | v1 U-05 第2版: 前版の未解決指摘の持越（人が確認）   | 制作者         | ![](screenshots/17-carry-forward.png)             |
| 18  | v1 アプリ内通知（依頼・割当・採否・持越）           | 校正者         | ![](screenshots/18-notifications.png)             |

## デモモードについて

- `vite.config.ts` の `--mode demo` で `convex/react` / `@convex-dev/auth/react` / `@/integrations/api` / `node:async_hooks` を `src/demo/*` に差し替える。
- 業務ロジック（domain / application / apps/convex の関数）は本番と同一コードが動く。差し替えているのは通信層（Convex クライアント・認証・ファイル転送）だけ。
- 用途: バックエンド無しの UI 開発、スクリーンショット、E2E。本番ビルド（`pnpm build`）には含まれない。
