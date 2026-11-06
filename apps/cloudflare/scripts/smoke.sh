#!/usr/bin/env bash
# wrangler dev で起こした本物の Worker + Durable Object に対して、HTTP の境界から関数を 1 周させる。
# 使い方: apps/cloudflare で `pnpm dev --port 8790` を起こしてから `scripts/smoke.sh 8790`
# サービス認証の「合っていれば通る」まで見るなら、起こすときに `--var MF100_UPLOAD_SECRET:<16 文字以上>` を足し、
# 同じ値を環境変数 UPLOAD_SECRET で渡す（無ければ「秘密が未設定なら 404」だけを確かめる）。
# 清掃（submissions:listOrphanObjects / markObjectsPurged）と取り込み（/internal/import）は MF100_CLEANUP_SECRET、
# ファイル処理は PROCESSING_SECRET を同じ要領で足す（--var と環境変数）
set -euo pipefail
port="${1:-8790}"
base="http://127.0.0.1:$port"
body=$(mktemp)
trap 'rm -f "$body"' EXIT
me='{"subject":"u_manager","name":"統括"}'
creator='{"subject":"u_creator","name":"制作者"}'
approver='{"subject":"u_approver","name":"校了者"}'

# call <関数名> <本人の JSON> <引数の JSON> [追加のヘッダ]
call() { curl -s -o "$body" -w '%{http_code}' -X POST "$base/f/$1" -H 'Content-Type: application/json' -H "X-MF100-Identity: $2" ${4:+-H "$4"} -d "$3"; }
assert() { if [ "$1" != "$2" ]; then echo "FAIL $3: expected $2, got $1: $(cat "$body")"; exit 1; fi; echo "ok   $3"; }
field() { node -e 'const v=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")); const r=process.argv[2].split(".").reduce((o,k)=>o?.[k],v); process.stdout.write(String(r))' "$body" "$1"; }
assert_field() { if [ "$(field "$1")" != "$2" ]; then echo "FAIL $3: $1 expected $2, got $(cat "$body")"; exit 1; fi; echo "ok   $3"; }

assert "$(curl -s -o "$body" -w '%{http_code}' "$base/health")" 200 "health"
assert "$(curl -s -o "$body" -w '%{http_code}' -X POST "$base/f/works:create" -d '{}')" 401 "no identity -> 401"
assert "$(call works:noSuchFunction "$me" '{}')" 404 "unknown function -> 404"
assert "$(call works:create "$me" '{"title":1}')" 400 "invalid args -> 400"
assert_field code invalid_args "invalid args -> code invalid_args"

# 名簿（users）に居ない人は職責に入れられない。先に本人として 1 回呼ぶ（サインインと同じ効き目）。ID は払い出し値なので me:me で知る
assert "$(call me:me "$me" '{}')" 200 "manager signs in (me:me)"
assert "$(call me:me "$creator" '{}')" 200 "creator signs in"
creator_id=$(field value.id)
assert "$(call me:me "$approver" '{}')" 200 "approver signs in"
approver_id=$(field value.id)
assert "$(call works:create "$me" "{\"title\":\"MF100 パンフレット\",\"purpose\":\"案内\",\"category\":\"印刷物\",\"mediaType\":\"pdf\",\"year\":100,\"creatorIds\":[\"$creator_id\"],\"approverId\":\"$approver_id\"}")" 200 "works:create -> 200"
id=$(field value)
assert "$(call works:update "$creator" "{\"workId\":\"$id\",\"patch\":{\"title\":\"改題\"}}")" 403 "creator cannot rename -> 403 (forbidden)"
assert "$(call works:update '{"subject":"stranger"}' '{"workId":"nope","patch":{}}')" 403 "unknown work -> 403 (does not leak existence)"
assert "$(call works:update "$me" "{\"workId\":\"$id\",\"expectedVersion\":99,\"patch\":{\"title\":\"上書き\"}}")" 409 "stale expectedVersion -> 409"
assert_field code version_conflict "version_conflict"
# 公開の関数は本人なしで引ける。query の応答には読んだ表の名前（reads）が付く
assert "$(curl -s -o "$body" -w '%{http_code}' -X POST "$base/f/works:ogSummary" -d "{\"workId\":\"$id\"}")" 200 "works:ogSummary without identity -> 200"
assert_field value.title "MF100 パンフレット" "409 left the title as it was"
node -e 'const r=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).reads; if(!r.includes("works")){console.log("FAIL reads: "+r);process.exit(1)} console.log("ok   query reads "+JSON.stringify(r))' "$body"
assert "$(call notifications:unreadCount "$me" '{}')" 200 "notifications:unreadCount -> 200"
# サービス専用（apps/api が実体を検証してから呼ぶ）は、秘密が無ければ在ることも教えない
assert "$(call submissions:beginUpload "$me" '{"itemId":"x"}')" 404 "service function without key -> 404"
assert "$(call submissions:beginUpload "$me" '{"itemId":"x"}' 'X-MF100-Service-Key: wrong-wrong-wrong-wrong')" 404 "service function with a wrong key -> 404"
if [ -n "${UPLOAD_SECRET:-}" ]; then
  assert "$(call submissions:beginUpload "$me" '{"itemId":"x"}' "X-MF100-Service-Key: $UPLOAD_SECRET")" 404 "service function with the key -> reaches the use case (item not found -> 404)"
  assert_field code upload_item_not_found "reached the use case, not the boundary"
fi
# ファイル処理の台帳（apps/api の Queue / Workflow が呼ぶ /internal/processing）。秘密が無ければ在ることも教えない。
# 合っていれば通る（起こすときに `--var PROCESSING_SECRET:<32 文字以上>` を足し、同じ値を環境変数 PROCESSING_SECRET で渡す）
internal() { curl -s -o "$body" -w '%{http_code}' -X POST "$base/internal/processing" -H 'Content-Type: application/json' ${2:+-H "$2"} -d "$1"; }
assert "$(internal '{"operation":"cleanupCandidates","args":{}}')" 404 "/internal/processing without secret -> 404"
assert "$(internal '{"operation":"cleanupCandidates","args":{}}' 'Authorization: Bearer wrong-wrong-wrong-wrong-wrong-wrong')" 404 "/internal/processing with a wrong secret -> 404"
assert "$(call processing:status "$me" "{\"workId\":\"$id\"}")" 200 "processing:status -> 200"
assert_field value.enabled false "processing disabled unless PROCESSING_ENABLED"
if [ -n "${PROCESSING_SECRET:-}" ]; then
  assert "$(internal '{"operation":"cleanupCandidates","args":{}}' "Authorization: Bearer $PROCESSING_SECRET")" 200 "/internal/processing with the secret -> 200"
  assert "$(cat "$body")" "[]" "cleanupCandidates -> []"
  assert "$(internal '{"operation":"inspect","args":{"jobId":"nope"}}' "Authorization: Bearer $PROCESSING_SECRET")" 409 "inspect of an unknown job -> 409"
  assert_field code processing_rejected "rejected without a reason"
  assert "$(internal '{"operation":"nope"}' "Authorization: Bearer $PROCESSING_SECRET")" 400 "unknown operation -> 400"
fi
# R2 の清掃（apps/api の cron が Bearer MF100_CLEANUP_SECRET で呼ぶ。利用者は要らない）と、データ移行の取り込み口。
# どちらも秘密が無ければ在ることも教えない。合っていれば通る（起こすときに `--var MF100_CLEANUP_SECRET:<16 文字以上>`、同じ値を環境変数 MF100_CLEANUP_SECRET で渡す）
cleanup() { curl -s -o "$body" -w '%{http_code}' -X POST "$base/f/submissions:$1" -H 'Content-Type: application/json' ${3:+-H "$3"} -d "$2"; }
import_rows() { curl -s -o "$body" -w '%{http_code}' -X POST "$base/internal/import" -H 'Content-Type: application/json' ${2:+-H "$2"} -d "$1"; }
assert "$(cleanup listOrphanObjects '{}')" 404 "submissions:listOrphanObjects without secret -> 404"
assert "$(cleanup markObjectsPurged '{"itemIds":[]}' 'Authorization: Bearer wrong-wrong-wrong-wrong')" 404 "submissions:markObjectsPurged with a wrong secret -> 404"
assert "$(import_rows '{"rows":[]}')" 404 "/internal/import without secret -> 404"
if [ -n "${MF100_CLEANUP_SECRET:-}" ]; then
  auth="Authorization: Bearer $MF100_CLEANUP_SECRET"
  assert "$(cleanup listOrphanObjects '{"limit":10}' "$auth")" 200 "submissions:listOrphanObjects with the secret -> 200 (no user needed)"
  assert "$(cat "$body")" '{"value":[]}' "no orphans yet"
  assert "$(cleanup markObjectsPurged '{"itemIds":["comment:nope","attempt:nope","feedback:old","nope"]}' "$auth")" 200 "submissions:markObjectsPurged -> 200"
  assert_field value 0 "unknown ids are not counted"
  # 取り込みの往復: 1 行を入れて finish（派生表の作り直しと確認）まで通し、入れた本人でサインインすると取り込んだ id が返る
  assert "$(import_rows '{"rows":[{"table":"users","id":"smoke_imported_user","doc":{"subject":"u_smoke_imported","name":"取り込み","isSystemAdmin":false}}],"begin":true,"finish":true}' "$auth")" 200 "/internal/import with the secret -> 200"
  assert_field counts.users 1 "one user imported"
  assert_field verify.tables.users 5 "users table counted by verify (4 signed-in + 1 imported)"
  assert "$(call me:me '{"subject":"u_smoke_imported"}' '{}')" 200 "the imported user signs in"
  assert_field value.id smoke_imported_user "me:me returns the imported id"
fi
assert "$(call documents:get "$creator" "{\"workId\":\"$id\"}")" 200 "documents:get -> 200"
# AI 校正: キー（ANTHROPIC_API_KEY など）が無ければ使えず、外へは何も送らない（action も理由を返すだけ）
assert "$(call ai:status "$creator" "{\"workId\":\"$id\"}")" 200 "ai:status -> 200"
assert_field value.available false "AI unavailable without a key"
assert "$(call ai:proofread "$creator" "{\"workId\":\"$id\",\"text\":\"5月祭\"}")" 200 "ai:proofread (action) -> 200"
assert_field value.candidates.length 0 "ai:proofread returns no candidates without a key"
# 書いたテーブル名が WebSocket で届く（Node の WebSocket はヘッダに ASCII しか載せられないので、名前の無い本人で）
node -e '
const h = { "X-MF100-Identity": process.argv[2] };
const ws = new WebSocket(process.argv[1] + "/ws", { headers: h });
ws.onopen = () => fetch(process.argv[1] + "/f/home:setPinned", { method: "POST", headers: { ...h, "Content-Type": "application/json" }, body: JSON.stringify({ workId: process.argv[3], pinned: true }) });
ws.onmessage = (m) => { const c = JSON.parse(m.data).changed; if (!c.includes("pins")) { console.log("FAIL ws: " + m.data); process.exit(1); } console.log("ok   ws change notice " + m.data); process.exit(0); };
setTimeout(() => { console.log("FAIL ws: no message within 5s"); process.exit(1); }, 5000);
' "$base" '{"subject":"u_manager"}' "$id"
assert "$(call home:pinned "$me" "{\"workId\":\"$id\"}")" 200 "home:pinned -> 200"
assert_field value true "pinned"
# あとで動く仕事: 端末を登録して通知を 1 件作ると、alarm が配信の仕事を動かす。VAPID_* を --var で渡して起こしたときだけ、
# wrangler dev のログに delivery_report が出る（端末の宛先は引けない名前なので retry のまま 4 回で job_gave_up になる。外へは送らない）。
# 渡さなかったときは仕事が積まれず、ログには何も出ない
notifier="{\"subject\":\"u_notify_$RANDOM\",\"name\":\"通知\"}"
keys=$(node -e 'const c=require("crypto");const d=c.createECDH("prime256v1");d.generateKeys();console.log(JSON.stringify({p256dh:d.getPublicKey().toString("base64url"),auth:c.randomBytes(16).toString("base64url")}))')
assert "$(call push:subscribe "$notifier" "{\"endpoint\":\"https://smoke-nxdomain.push.services.mozilla.com/x\",\"p256dh\":$(node -p 'JSON.stringify(JSON.parse(process.argv[1]).p256dh)' "$keys"),\"auth\":$(node -p 'JSON.stringify(JSON.parse(process.argv[1]).auth)' "$keys")}")" 200 "push:subscribe -> 200"
assert "$(call notifications:sendTest "$notifier" '{}')" 200 "notifications:sendTest -> 200 (queues a delivery job when VAPID_* are set)"
# cron の入口（wrangler dev の scheduled handler）
assert "$(curl -s -o "$body" -w '%{http_code}' "$base/cdn-cgi/handler/scheduled?cron=0+*+*+*+*")" 200 "scheduled handler (hourly jobs)"
echo "all ok (work $id)"
