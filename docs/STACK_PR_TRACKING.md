# STACK PR トラッキング

正本: `scripts/stack-pr/manifest.json`（76 件） / E 系列: `scripts/stack-pr/manifest-e-series.json` / C/D: `scripts/stack-pr/manifest-dashboard-cd.json`

## develop マージ（001–070）— 完了

`origin/develop` @ **`f22ff5ed315ea5c937226dec03167b5e9f55cc5f`**

| 範囲 | PR | 備考 |
|---|---|---|
| 001–070 | #93–#166 | ✅ MERGED |
| #129 | 本 doc | **マージしない** |

## 積み順（大地さん 2026-10-31 決定）

1. **E 系列**（`develop` ベース）… 制作物登録・メタ（decisions 78–89）。**072 の単一 `plannedSubmitAt` は e082 で置換**。
2. **B ダッシュボード 071–076** … E の上に付け替えて再スタック（#165 は既に `develop` base）。
3. **C/D ダッシュボード 077+** … **CD 081/082 は E81/E82 に統合して中止**。077–080 → **083–088**（083 の親は **stack-080**）。

## E 系列（develop・未マージ）

| id | PR | ブランチ | tip（参考） |
|---|---|---|---|
| e089 | **#175** | `cursor/stack-e089-copy-unify-terminology-8b5a` | `13a298f` |
| e088 | **#177** | `cursor/stack-e088-drop-legacy-id-ui-8b5a` | `40d636e` |
| e078 | **#181** | `cursor/stack-e078-reg-minimal-fields-8b5a` | `55739fa` |
| e081 | **#180** | `cursor/stack-e081-dates-approval-target-finish-8b5a` | `29439d3` |
| e082 | **#179** | `cursor/stack-e082-revision-planned-dates-list-8b5a` | `1d34b79` |

## B ダッシュボード 071–076（未マージ・base 付け替え待ち）

| PR | id | base（現状） |
|---:|---|---|
| #165 | 071 | `develop` ✅ |
| #163 | 072 | stack-071（**e082 後に差し替え**） |
| #162 | 073 | stack-072 |
| #168 | 074 | stack-073 |
| #167 | 075 | stack-074 |
| #169 | 076 | stack-075 |

071 の再撮: `after-desktop.png` ≥30KB・検査通過（076 は `08-workspace-comment` 要再撮）。

## C/D ダッシュボード（未マージ）

| PR | id | base |
|---:|---|---|
| #170 | 077 | stack-076 |
| #171 | 078 | stack-077 |
| #172 | 079 | stack-078 |
| #173 | 080 | stack-079 |
| **#176** | 083 | stack-080 |
| **#178** | 084 | stack-083 |
| **#185** | 085 | stack-084 |
| **#183** | 086 | stack-085 |
| **#184** | 087 | stack-086 |
| **#182** | 088 | stack-087 |

スクリーンショット raw（docs `7a024bc`）例:  
https://raw.githubusercontent.com/k0chiii/Refine-demo/7a024bcde924846efb32f0f72806d3b15b749577/docs/stack-pr-screenshots/083/after-desktop.png

## スクリーンショット

- 検査: ≥30KB / サインイン md5 禁止 / シーン文言 / 同一 id フォルダ内 md5 一意
- 撮影: `scripts/stack-pr/capture.ts`、CD 083–088 は `capture-cd-083-088.mjs`
- Raw は **docs ブランチの commit SHA** を差し替え:  
  `https://raw.githubusercontent.com/k0chiii/Refine-demo/<sha>/docs/stack-pr-screenshots/<id>/after-desktop.png`
