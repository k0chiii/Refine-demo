---
name: verify-mf100-web
description: "MF100 校正システムの Web（デモ版: ブラウザ内の Convex、実データなし）を、利用者と同じ操作で動かして挙動を確かめる。画面・業務の流れ（版の提出・割り当て・コメント・採否・校了・通知）を変えたあと、変更が本当に動くかを示すとき、E2E の spec を足す前に流れを確かめるときに使う。pstack の /maintain-verification-skill で保守する。"
---

# MF100 Web を動かして確かめる

機能の地図は [`features/README.md`](features/README.md)。spec の書き方の決まりは `docs/TESTING_AGENT_POLICY.md`。

## Launch

デモ版（`--mode demo`）は apps/convex の実際の関数を convex-test でブラウザ内で動かす。データはページのメモリにだけあり、**ページを読み直すたびにシードから作り直される**。DB・秘密・外部サービスは要らない。

```bash
cd apps/web
pnpm build:demo                                   # 15 秒前後。dist-demo/ に出る
mkdir -p e2e/out                                  # 証拠と preview のログの置き場（git 管理外）
# 自分のセッション（プロセスグループ）で建て、その番号を残す。vp は子プロセスを作るので、$! を kill しても preview は残る
setsid sh -c 'echo $$ > e2e/out/preview.pgid; exec pnpm exec vp preview --mode demo --outDir dist-demo --port 4173 --host 127.0.0.1 --strictPort' \
  > e2e/out/preview.log 2>&1 &
for i in $(seq 1 60); do curl -sf -o /dev/null http://127.0.0.1:4173/ && break; sleep 1; done
```

- 4173 が使用中なら、ほかの人（やほかのエージェント）の preview かもしれない。止めずに `--port 4174` などで建て、以降の URL も合わせる。
- ブラウザ: クラウド環境は `CHROMIUM_PATH=/opt/pw-browsers/chromium`、GitHub Actions は `/usr/bin/google-chrome`。`playwright install` はしない。
- spec を流すだけなら Launch は要らない（`pnpm e2e` が自分でビルドして建てる）。

## Doctor

```bash
CHROMIUM_PATH=/opt/pw-browsers/chromium node .claude/skills/verify-mf100-web/scripts/doctor.mjs http://127.0.0.1:4173
```

`doctor: OK …（デモ版・アカウント N 人）` なら使える。NG なら理由が出る（応答しない・デモ版ではない、など）。おかしいと思ったらまずこれ。

## Drive

道具は Playwright Test と `apps/web/e2e/support/app.ts` の `App`（画面操作の部品）と `scenarios.ts`（前提をつくる手順）。

- **既にある流れを確かめる**: `cd apps/web && BASE_URL=http://127.0.0.1:4173 pnpm exec playwright test <spec のファイル名> --trace on`
- **新しい流れ・その場の確認**: `apps/web/e2e/specs/_verify-<題>.spec.ts` を一時的に作り、`test`（`../support/app` から）で書いて流す。残す価値があれば名前を変えて spec にする（`.claude/skills/e2e-from-spec`）。残さないなら消す。
- 人を変える: `await app.signInAs("mock-nogiku-creator" | "mock-nogiku-reviewer" | "mock-nogiku-manager" | "mock-nogiku-approver" | "mock-nogiku-admin")`。
- 移動は `app.go(path)`（SPA 内。`page.goto` で読み直すとデータが消える）。
- 手がかりはロール・ラベル（`getByRole` / `getByLabel`）を先に。M3E の部品は `m3e-button` / `m3e-dialog[open]` などのタグと、`hasText` の文言で探してよい（操作を見つけるための手がかり）。確かめるのは文言ではなく状態（`docs/TEST_PLAN.md`）。

## Evidence

- 証拠: Playwright の trace（`--trace on`。操作ごとの DOM・console・ネットワーク）と、終わりの状態のスクリーンショット（`await page.screenshot({ path: "e2e/out/verify/<機能>-<段>.png" })`）。
- 置き場: `apps/web/e2e/out/`（git 管理外）。trace は `e2e/out/test-results/<test>/trace.zip`、`pnpm exec playwright show-trace <zip>` で開ける。
- 決まり: 利用者の操作の道で確かめる（`__mf100demo` を直接呼ぶのは前提づくりとサインインだけ）。操作と、その結果の状態の両方を残す。変わったものは別の見え方（別の人・別の画面）でも確かめる（例: 割り当て → 校正者の「校正」に出る）。
- 画面の撮影一式と a11y は `E2E_PART=<部> A11Y=1 node e2e/screenshots.mjs`（`BASE_URL` を合わせる）。

## Cleanup

```bash
kill -- -"$(cat apps/web/e2e/out/preview.pgid)" && rm apps/web/e2e/out/preview.pgid   # 自分が建てた preview のグループだけ
rm -f apps/web/e2e/specs/_verify-*.spec.ts                                       # 一時的な spec
```

プロセス名やコマンドラインで探して kill しない（ほかの人の preview や、探している自分のシェルまで止める）。`e2e/out/` の証拠（trace・スクリーンショット）は消さない。データはメモリだけなので消すものは無い。

## Helpers

- `scripts/doctor.mjs [BASE_URL]` — 上の Doctor。読むだけ。
