#!/usr/bin/env bash
# wrangler dev で起こした本物の Worker + Durable Object に対して、HTTP の境界からユースケースを 1 周させる。
# 使い方: apps/cloudflare で `pnpm exec wrangler dev --port 8790` を起こしてから `scripts/smoke.sh 8790`
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
echo "all ok (work $id)"
