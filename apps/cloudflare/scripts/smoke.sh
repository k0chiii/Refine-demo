#!/usr/bin/env bash
# wrangler dev で起こした本物の Worker + Durable Object に対して、HTTP の境界から関数を 1 周させる。
# 使い方: apps/cloudflare で `pnpm dev --port 8790` を起こしてから `scripts/smoke.sh 8790`
# サービス認証の「合っていれば通る」まで見るなら、起こすときに `--var MF100_UPLOAD_SECRET:<16 文字以上>` を足し、
# 同じ値を環境変数 UPLOAD_SECRET で渡す（無ければ「秘密が未設定なら 404」だけを確かめる）
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
# cron の入口（wrangler dev の scheduled handler）
assert "$(curl -s -o "$body" -w '%{http_code}' "$base/cdn-cgi/handler/scheduled?cron=0+*+*+*+*")" 200 "scheduled handler (hourly jobs)"
echo "all ok (work $id)"
