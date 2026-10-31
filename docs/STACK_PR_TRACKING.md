# STACK PR トラッキング

正本: `scripts/stack-pr/manifest.json`（76 件）

## develop マージ進捗（001–070）— 完了

`origin/develop` @ **`f22ff5ed315ea5c937226dec03167b5e9f55cc5f`**（2026-10-31 UTC）

| 範囲 | PR | develop |
|---|---|---|
| 001–070 | #93–#166（manifest 順） | ✅ すべて **MERGED**（merge commit / `gh pr merge --merge`） |
| #129 | トラッキング doc のみ | **マージしない** |

手順: `scripts/stack-pr/merge-batch-008-070.sh` + `merge-one.sh`（`artifacts/` 未追跡で checkout 失敗したため退避後に再開）。

## 071–076（マージしない）

| PR | id | base（2026-10-31） | CI |
|---:|---|---|---|
| #165 | 071 | **`develop`**（ManagePullRequest で付け替え済） | verify 系 + e2e-smoke **緑** |
| #163 | 072 | `cursor/stack-071-domain-work-stages-v7-v2-8b5a` | 緑 |
| #162 | 073 | `cursor/stack-072-schema-revision-planned-at-v2-8b5a` | 緑 |
| #168 | 074 | `cursor/stack-073-domain-danger-kpi-v2-8b5a` | 緑 |
| #167 | 075 | `cursor/stack-074-demo-dashboard-role-homes-v2-8b5a` | 緑 |
| #169 | 076 | `cursor/stack-075-ui-home-view-switcher-v2-8b5a` | 緑 |

## C/D ダッシュボード mock（076 上・未マージ）

| id | PR | ブランチ | 備考 |
|---|---|---|
| 077 | **#170** | `cursor/stack-077-ui-delay-color-tokens-8b5a` | base: `stack-076` |
| 078–088 | （積み上げ中） | `manifest-dashboard-cd.json` | force push 禁止 |

## スクリーンショット

- `scripts/stack-pr/capture.mjs` … デモログイン + md5 `ac741f73` 拒否 + `/signin` URL 拒否
- `docs/stack-pr-screenshots/` … 071–076 優先で撮り直し
