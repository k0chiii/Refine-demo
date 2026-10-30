# アーキテクチャ

## レイヤと依存の向き

```
          ┌──────────────────────────────────────────────────────────────┐
          │  apps/web  React 19 / TanStack Router / @m3e/react / PDF.js   │  表示・操作。権限を確定しない
          └───────────────┬─────────────────────────────┬────────────────┘
                          │ Convex client (realtime)     │ fetch + Bearer JWT
          ┌───────────────▼──────────────┐   ┌──────────▼─────────────────┐
          │ apps/convex  (Convex)        │   │ apps/api  (Hono / Workers)  │
          │ 業務データの正本・認可・状態遷移 │◀──│ R2 提出 / 実体検証 / 配信      │
          │ convex-test で検証           │   │ 業務 CRUD を持たない          │
          └───────────────┬──────────────┘   └──────────┬─────────────────┘
                          │ implements ports             │ R2Bucket
          ┌───────────────▼──────────────┐   ┌──────────▼─────────────────┐
          │ packages/application         │   │ Cloudflare R2（非公開）       │
          │ ユースケース + ポート            │   └────────────────────────────┘
          └───────────────┬──────────────┘
                          │ uses
          ┌───────────────▼──────────────┐
          │ packages/domain              │  Work / Revision / UploadSession / CommentThread / Approval / ACL
          │ 純粋 TS・依存ゼロ               │  不変条件・状態機械・ポリシー
          └──────────────────────────────┘

          Nogiku Auth（OIDC IdP）──▶ Convex Auth（@convex-dev/auth）──▶ JWT ──▶ Convex / Hono が検証
```

- **domain**: フレームワーク非依存。`planRevision` / `supersede` / `assertCanPostComment` / `evaluateFinalization` / `isAllowed` など、§5 の不変条件をここで表現する。制度承認待ちの値は `ApprovalPolicy` 等のデータにする。
- **application**: ユースケース関数（`confirmSubmission`, `postComment`, `decideThread`, `finalizeWork`, `reopenWork`, `grantWorkPermission` …）と、それが必要とするポート（`WorkRepository` …、`Clock`, `AuditLogger`, `IdempotencyStore`）。インメモリ実装（`@mf100/application/testing`）で受け入れ条件を単体テストする。
- **apps/convex**: `convex/lib/adapters.ts` がポートを `ctx.db` で実装。公開関数は「認証 → ユースケース呼出 → ドメイン例外を ConvexError に変換」だけ。1 mutation = 1 トランザクション。
- **apps/api**: ポート `TokenVerifier` / `BackendGateway` / `ObjectStore` に依存する Hono アプリ。本番は jose / ConvexHttpClient / R2、テストはフェイク。
- **apps/web**: 画面は 制作（`/make`）／校正（`/check`）／制作物（`/works`）／エディタ（`/works/:id`, `/works/:id/v/N`）／管理（`/admin`）（`/` は最後に使った入口への振り分け。UI_M3E §83）（要件の U-01〜U-08 はこの中に収める。[`UI_M3E.md`](UI_M3E.md) §11）。アップロードのオーケストレーションは UI 非依存の `SubmissionFlow` に分離してテスト。座標変換はドメインの `toViewportRect / fromViewportRect` を使う。

## 認可の境界

```
利用者 ──JWT──▶ Convex 関数 ─▶ requireUser() ─▶ Principal{userId, isSystemAdmin, groupIds:[]}
                                   └─▶ loadAuthorizedWork(work, grants, action) ─▶ domain.isAllowed()
利用者 ──JWT──▶ Hono ─▶ TokenVerifier(JWKS) ─▶ 利用者本人のトークンで Convex を呼ぶ（Hono は特権を持たない）
```

| 操作                                                     | 判定                                                                                                                           |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| 閲覧（一覧・詳細・添付・コメント数）                     | 職責（制作者・校了者・主管）または有効な ACL `view` 以上。無ければ**存在も返さない**（`forbidden`）                            |
| 版提出・確定                                             | 制作者 or ACL `edit`                                                                                                           |
| 新規指摘（コメント）                                     | 制作物を見られる人なら誰でも（利用者決定 2026-10-19）、かつ版が受付中・期限前・最新受付版、作品が校了前                        |
| 校正への参加（自動校正・AI・ページ対応・専門確認の完了） | 制作者・校了者・主管 or ACL `review` 以上（`review.participate`）。自動校正はシステム管理者も（`canRunProofread`。2026-10-30） |
| 採否判断                                                 | 制作者 or ACL `edit`（校正者は不可）                                                                                           |
| 校了・再開                                               | 校了者（`approverIds`。無い行は `approverId`）のみ。管理者は不可                                                               |
| ACL 変更                                                 | `isSystemAdmin` のみ。`group` 主体は拒否（後続）                                                                               |

将来の Nogiku Access 連携は `Principal.groupIds` に値を入れるだけで `effectivePermission` が `group` 付与を評価する。

## ファイル提出フロー（F-04 / §8.1）

```
1. prepare   web → convex submissions.prepare      UploadSession(open) + UploadItem(pending, objectKey 予約)。Revision は作らない
2. put       web → hono PUT /uploads/items/:id     Hono: JWT 検証 → convex itemForUpload（所有者・open 確認）→ R2 put(sha256 検証) → convex markVerified
3. (失敗)    web → convex submissions.reset        失敗項目だけ pending に戻して 2 をやり直す
4. confirm   web → convex submissions.confirm      全項目 verified を確認 → Revision 作成 → Artifact 作成 → 旧 open 版を superseded → セッション confirmed（原子的）
5. view      web → hono GET /files/:artifactId     毎回 convex artifacts.authorizeAccess で認可 → R2 からストリーミング（Cache-Control: private, no-store）
```

## 状態の独立性（§5.1）

`Work.lifecycle` / `Revision.reviewState` / `ReviewAssignment.state` / `CommentThread.resolution` / `ApprovalEvent` は別々に保持し、相互に自動変換しない。期限到来は `Revision` だけを閉じ、コメント投稿は `ReviewAssignment` を `viewed` にするだけで `responded` にはしない。

## データモデル（Convex テーブル）

`users`（Nogiku 参照）/ `works` / `workRoles`（職責の派生索引）/ `workPermissions` / `revisions` / `artifacts` / `uploadSessions` / `uploadItems` / `commentThreads` / `commentEvents` / `reviewAssignments` / `approvalEvents` / `auditEvents` / `idempotencyKeys` + Convex Auth の `authTables`。定義は `apps/convex/convex/schema.ts`。要件 §6 の論理モデルとの対応: `UserRef→users`, `WorkPermission→workPermissions`, `Revision→revisions`, `Artifact→artifacts`, `CommentThread/CommentEvent→commentThreads/commentEvents`, `ApprovalEvent→approvalEvents`, `AuditEvent→auditEvents`。`TeamRef`, `CarryForward`, `NotificationJob` は未作成（後続）。
