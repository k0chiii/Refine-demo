# ui-perf-cost

## 問い

MF100（Convex + Workers + R2 + React）で、画面要件を守りつつ、帯域・待ち時間・課金に効く改善はどこか。

## 要る主張

1. この分野の知見はどこに集まっているか（場）
2. Convex の DB 帯域は「読み取り量 × 購読の再実行」で測るべきで、推測だけでは足りない
3. フロントの予算（JS/CSS/フォント）は初回・再訪で別枠にする
4. R2 は egress 無料でも Class B と Worker 往復が効く
5. 要件上「後続」の画面を載せ続けると、購読とバンドルの両方を押し上げる
6. 既に入った要約・ページネーション・版カウンタのあとに残る山は何か

## 用語（未確認のものは注記）

| 用語 | 出所 |
| --- | --- |
| Database bandwidth / document reads | Convex usage limits（sources/） |
| Performance budget | web.dev performance-budgets-101（sources/） |
| R2 Class A / Class B | Cloudflare R2 pricing（sources/） |
| Occasional reads vs subscriptions | Convex best practices（sources/） |

## 場

| 場 | 備考 |
| --- | --- |
| docs.convex.dev | Best practices, limits, Insights |
| developers.cloudflare.com | R2 pricing, Workers limits |
| web.dev | Performance budgets |
| リポジトリ docs/COST.md | 既存の見積りと残推奨（コード根拠） |

## 原文

| ファイル | URL |
| --- | --- |
| sources/convex-best-practices.md | https://docs.convex.dev/understanding/best-practices/ |
| sources/convex-usage-limits.md | https://docs.convex.dev/production/state/limits |
| sources/cloudflare-r2-pricing.md | https://developers.cloudflare.com/r2/pricing/ |
| sources/webdev-performance-budgets-101.md | https://web.dev/articles/performance-budgets-101 |

## 未保存のリンク先（1周打ち切り）

- infrequently.org（performance budgets が参照）
- stack.convex.dev の complex-filters / row-level-security
- Convex Health / Tracking Usage、Workers 料金、R2 署名付き URL
