# 復旧と配信版の対応

Convex の export だけでは R2 原本・環境変数・関数のコード・予約済み実行は戻らない。
復旧点は Convex export と R2 の非公開バックアップ、Git SHA、各環境の設定、Worker version、Pages deployment を一組にする。
シークレットは専用の保管先で管理し、成果物・ログ・Git に書かない。定期バックアップの可否・保持期間は契約画面で確認する。

## 隔離環境でのリハーサル（本番への実行は禁止）

1. 管理者が対象 deployment と隔離先を確認し、`pnpm exec convex export --path <backup.zip>` で取得する。バックアップには実データがあるためアクセスを制限する。
2. 原本の参照が変わらないよう、同じ復旧点の R2 を別の非公開バケットへ複製する。DB の参照だけを消したり lifecycle で原本を削除しない。
3. export をローカルに展開し、R2 の実体と metadata を保存する。`inventory.json` は `[{"key":"R2 objectKey","file":"objects/001","encoding":"gzip"}]` 形式。非圧縮なら encoding を省略。objectKey をローカルパスとして直接使わない。
4. `python3 scripts/verify-backup.py <export dir> <R2 dir>` で artifacts と verified commentFiles の全体 SHA-256 と元サイズを確認する。gzip は伸長した原本を照合する。欠落・未検証の hash・空のバックアップは成功にしない。
5. 明示的な復元承認後、隔離用の Convex deployment に export を import。対応 Git SHA のコード、隔離先の環境変数、Worker、R2、Web を準備する。Nogiku redirect と CORS を揃え、通知・AI・cleanup cron は検証が終わるまで無効にする。
6. 閲覧・提出・校了・ACL 剥奪・Range 配信・添付・孤立清掃のリハーサルをする。予約済み処理は消失・重複の両方を確認し、再開時に既読・権限・採用状態を再判定する。
7. 復旧点・所要時間・欠落の有無を記録し、承認後に本番の切替を実施する。本番 import は破壊的操作であり、この手順書自体は実行承認ではない。

## ロールバック

- Worker の rollback は Convex schema・データ・R2・Pages を戻さない。配信前に `scripts/release-manifest.mjs` で Git SHA・環境・稼働先を記録し、Workers と Pages の deployment ID を追記して保管する。
- Worker のバインディング変更後は過去版を戻せない場合がある。対象 version の互換性を確認してから管理者が `wrangler rollback <version-id> --env production` を実施する。
- 新 API は旧 Web が残る期間も既存の HTTP/Convex 契約を維持する。削除や必須引数化は同時配信せず、追加→移行→利用確認→削除の順にする。
- データ変更を過去へ戻せない場合は、旧 Web/API の互換性を保つ前進修正を使う。Worker だけの rollback を「全体復旧」と記録しない。

このリポジトリの自動テストは実クラウドの復元や契約・定期バックアップ設定を確認しない。隔離環境でのリハーサルの記録が必要。
