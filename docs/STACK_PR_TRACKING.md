# STACK PR トラッキング

正本: `scripts/stack-pr/manifest.json`（76 件） / E 系列: `scripts/stack-pr/manifest-e-series.json`

## develop マージ（001–070）— 完了

`origin/develop` @ **`f22ff5ed315ea5c937226dec03167b5e9f55cc5f`**

| 範囲 | PR | 備考 |
|---|---|---|
| 001–070 | #93–#166 | ✅ MERGED |
| #129 | 本 doc | **マージしない** |

## 積み順（大地さん 2026-10-31 決定）

1. **E 系列**（`develop` ベース）… 制作物登録・メタ（decisions 78–89）。**072 の単一 `plannedSubmitAt` は e082 で置換**。
2. **B ダッシュボード 071–076** … E の上に付け替えて再スタック（#165 は既に `develop` base）。
3. **C/D ダッシュボード 077+** … **CD 081（英語 KPI）・082（入稿準備日数 UI）は E81/E82 と重なるため中止**。077–080, 083–088 を E 完了後に積む。

## E 系列（develop・未マージ）

| id | PR | ブランチ | 状態 |
|---|---|---|---|
| e089 | （作成中） | `cursor/stack-e089-copy-unify-terminology-8b5a` | 統括・校了する人、納期/ID 削除、タグ a/b 除外 |
| e088 | — | `stack-e088-drop-legacy-id-ui` | 予定 |
| e078 | — | `stack-e078-reg-minimal-fields` | 登録4項目のみ |
| e081 | — | | ◆校了目標日・■仕上がり日（CD081 相当はここ） |
| e082 | — | | 版予定日リスト + 移行（**072 置換**） |

## B ダッシュボード 071–076（未マージ・base 付け替え待ち）

| PR | id | base（現状） |
|---:|---|---|
| #165 | 071 | `develop` ✅ |
| #163 | 072 | stack-071（**e082 後に差し替え**） |
| #162 | 073 | stack-072 |
| #168 | 074 | stack-073 |
| #167 | 075 | stack-074 |
| #169 | 076 | stack-075 |

## C/D ダッシュボード（未マージ）

| PR | id | base |
|---:|---|---|
| #170 | 077 | stack-076 |
| #171 | 078 | stack-077 |
| #172 | 079 | stack-078 |
| #173 | 080 | stack-079 |
| 081–088 | | **E 系列と整合後に再開**（081/082 は E に統合） |

## スクリーンショット

- `scripts/stack-pr/capture.ts` … デモログイン、md5 `ac741f73` / `/signin` 拒否
- 071–076: `docs/stack-pr-screenshots/`（manager は `/works` の `.ov` 優先で再撮影中）
- Raw 例（docs ブランチ `66381d4`）:  
  `https://raw.githubusercontent.com/k0chiii/Refine-demo/66381d4/docs/stack-pr-screenshots/074/after-desktop.png`
