#!/usr/bin/env bash
# wrangler dev で起こした本物の Worker + Durable Object に対して、HTTP の境界からユースケースを 1 周させる。
# 使い方: apps/cloudflare で `pnpm dev --port 8790 --var MF100_SYSTEM_ADMIN_SUBJECTS:u_admin` を起こしてから `scripts/smoke.sh 8790`
# （管理者は、全制作物の一覧（exportWorkStats）で巻き戻しを確かめるのに要る）
set -euo pipefail
port="${1:-8790}"
base="http://127.0.0.1:$port"
me='{"subject":"u_manager","name":"統括"}'
creator='{"subject":"u_creator","name":"制作者"}'

call() { curl -s -o /tmp/smoke.body -w '%{http_code}' -X POST "$base/u/$1" -H 'Content-Type: application/json' -H "X-MF100-Identity: $2" -d "{\"args\":$3}"; }
assert() { if [ "$1" != "$2" ]; then echo "FAIL $3: expected $2, got $1: $(cat /tmp/smoke.body)"; exit 1; fi; echo "ok   $3"; }

assert "$(curl -s -o /tmp/smoke.body -w '%{http_code}' "$base/health")" 200 "health"
assert "$(curl -s -o /tmp/smoke.body -w '%{http_code}' -X POST "$base/u/createWork" -d '{"args":[]}')" 401 "no identity -> 401"
assert "$(call noSuchUsecase "$me" '[]')" 404 "unknown usecase -> 404"
# 名簿（users）に居ない人は職責に入れられない。先に本人として 1 回呼ぶ（サインインと同じ効き目）
assert "$(call listMyNotifications "$creator" '[]')" 200 "creator signs in"
assert "$(call listMyNotifications '{"subject":"u_approver","name":"校了者"}' '[]')" 200 "approver signs in"
assert "$(call createWork "$me" '[{"title":"MF100 パンフレット","purpose":"案内","category":"印刷物","mediaType":"pdf","year":100,"creatorIds":["u_creator"],"approverId":"u_approver"}]')" 200 "createWork -> 200"
id=$(node -e 'process.stdout.write(JSON.parse(require("fs").readFileSync("/tmp/smoke.body","utf8")).id)')
assert "$(call updateWork "$creator" "[{\"workId\":\"$id\",\"patch\":{\"title\":\"改題\"}}]")" 403 "creator cannot rename -> 403 (forbidden)"
assert "$(call updateWork '{"subject":"stranger"}' '[{"workId":"nope","patch":{}}]')" 403 "unknown work -> 403 (does not leak existence)"
# 途中で DomainError になった呼び出しは何も残さない（Durable Object の storage.transaction の巻き戻し）
assert "$(call importWorks "$me" '[{"rows":[{"title":"巻き戻し 1","purpose":"p","category":"印刷物","mediaType":"pdf","year":100,"creatorIds":["u_creator"],"approverId":"u_approver"},{"title":"","purpose":"p","category":"印刷物","mediaType":"pdf","year":100,"creatorIds":["u_creator"],"approverId":"u_approver"}]}]')" 400 "importWorks with a bad 2nd row -> 400"
assert "$(call exportWorkStats '{"subject":"u_admin","name":"管理者"}' '[{}]')" 200 "exportWorkStats as admin"
if grep -q "巻き戻し 1" /tmp/smoke.body; then echo "FAIL rollback: 1st row survived the failed import"; exit 1; fi; echo "ok   failed import left nothing behind"
# サービス専用（apps/api が実体を検証してから呼ぶ）は公開の口に無い
assert "$(call completeItemUpload "$me" '[{"attemptId":"x","size":1,"sha256":"forged"}]')" 404 "service-only usecase is not public"
# 書いたテーブル名が WebSocket で届く（Node の WebSocket はヘッダに ASCII しか載せられないので、名前の無い本人で）
node -e '
const h = { "X-MF100-Identity": process.argv[2] };
const ws = new WebSocket(process.argv[1] + "/ws", { headers: h });
ws.onopen = () => fetch(process.argv[1] + "/u/setWorkPinned", { method: "POST", headers: { ...h, "Content-Type": "application/json" }, body: JSON.stringify({ args: [{ workId: process.argv[3], pinned: true }] }) });
ws.onmessage = (m) => { const c = JSON.parse(m.data).changed; if (!c.includes("pins")) { console.log("FAIL ws: " + m.data); process.exit(1); } console.log("ok   ws change notice " + m.data); process.exit(0); };
setTimeout(() => { console.log("FAIL ws: no message within 5s"); process.exit(1); }, 5000);
' "$base" '{"subject":"u_manager"}' "$id"
# cron の入口（wrangler dev の scheduled handler）
assert "$(curl -s -o /tmp/smoke.body -w '%{http_code}' "$base/cdn-cgi/handler/scheduled?cron=0+*+*+*+*")" 200 "scheduled handler (hourly jobs)"
echo "all ok (work $id)"
