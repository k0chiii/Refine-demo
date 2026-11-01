#!/usr/bin/env bash
# Batch before/after captures for PRs #170–#173, #200–#204, #201.
# Keeps scripts/stack-pr/capture.ts from the current branch; only swaps app source for demo builds.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"
export STACK_PR_REPO="$ROOT"
export CHROMIUM_PATH="${CHROMIUM_PATH:-/usr/bin/google-chrome}"
export SKIP_PAMPHLET_COMMENTS=1
export SKIP_PLAN_INFO_WARNINGS=1

CAPTURE_TS="$ROOT/scripts/stack-pr/capture.ts"
CAPTURE_BAK="$(mktemp)"
cp "$CAPTURE_TS" "$CAPTURE_BAK"

restore_capture() {
  cp "$CAPTURE_BAK" "$CAPTURE_TS"
}

build_demo() {
  echo "  build:demo on $(git rev-parse --short HEAD)…"
  (cd "$ROOT/apps/web" && NODE_OPTIONS="${NODE_OPTIONS:---max-old-space-size=8192}" pnpm build:demo)
}

run_one() {
  local scene="$1"
  local prefix="$2"
  local clip="${3:-}"
  local port=$((4500 + RANDOM % 200))
  local req="/tmp/mf100-cap-$$.json"
  local opts="{}"
  if [[ -n "$clip" ]]; then
    opts=$(node -e "console.log(JSON.stringify({clipSelector: process.argv[1]}))" "$clip")
  fi
  node -e "
    const fs=require('fs');
    fs.writeFileSync('$req', JSON.stringify({
      shots: { desktop: '$scene' },
      prefix: '$prefix',
      opts: $opts
    }));
  "
  env CAPTURE_PORT="$port" BASE_URL="http://127.0.0.1:$port" \
    SKIP_DEMO_BUILD=1 \
    SCREENSHOT_CORPUS="$(dirname "$prefix")" \
    pnpm dlx tsx scripts/stack-pr/capture-cli.ts "$req"
  rm -f "$req"
}

capture_pair() {
  local pr="$1"
  local before_ref="$2"
  local after_ref="$3"
  local before_scene="$4"
  local after_scene="$5"
  local out_id="$6"
  local clip="${7:-}"
  local out="$ROOT/docs/stack-pr-screenshots/$out_id"
  mkdir -p "$out/before" "$out/after"

  echo "=== PR #$pr BEFORE ref=$before_ref scene=$before_scene ==="
  git fetch origin "$before_ref" "$after_ref" 2>/dev/null || git fetch origin
  git checkout -f "origin/$before_ref"
  restore_capture
  build_demo
  run_one "$before_scene" "$out/before/shot" "$clip"

  echo "=== PR #$pr AFTER ref=$after_ref scene=$after_scene ==="
  git checkout -f "origin/$after_ref"
  restore_capture
  build_demo
  run_one "$after_scene" "$out/after/shot" "$clip"
}

PRS=("${@:-170 171 172 173 200 201 202 204}")

for pr in "${PRS[@]}"; do
  case "$pr" in
    170)
      capture_pair 170 \
        cursor/stack-076-detail-route-shell-v2-8b5a \
        cursor/stack-077-ui-delay-color-tokens-8b5a \
        dashboard-manager \
        dashboard-backlog-delay \
        077 \
        "#ov-backlog"
      ;;
    171)
      capture_pair 171 \
        cursor/stack-077-ui-delay-color-tokens-8b5a \
        cursor/stack-078-ui-kpi-row-mock-8b5a \
        dashboard-manager \
        dashboard-manager \
        078
      ;;
    172)
      capture_pair 172 \
        cursor/stack-078-ui-kpi-row-mock-8b5a \
        cursor/stack-079-ui-graphs-stage-bureau-8b5a \
        dashboard-manager \
        dashboard-manager \
        079
      ;;
    173)
      capture_pair 173 \
        cursor/stack-079-ui-graphs-stage-bureau-8b5a \
        cursor/stack-080-ui-sns-band-visibility-8b5a \
        dashboard-approver \
        dashboard-approver \
        080
      ;;
    200)
      capture_pair 200 \
        cursor/stack-q69-plan-info-schema-8b5a \
        cursor/stack-q71-plan-info-warn-8b5a \
        q71-comments-web-clean \
        q71-plan-info-warn \
        q71
      ;;
    201)
      capture_pair 201 \
        cursor/stack-q69-plan-info-schema-8b5a \
        cursor/stack-q70-plan-info-ui-8b5a \
        q70-work-form-no-plan \
        q70-work-form-plan \
        q70
      ;;
    202)
      capture_pair 202 \
        cursor/stack-q71-plan-info-warn-8b5a \
        cursor/stack-q72-plan-info-recheck-8b5a \
        q72-plan-info-before-warn \
        q72-plan-info-recheck \
        q72
      ;;
    204)
      capture_pair 204 \
        cursor/stack-086-ui-detail-shell-mock-8b5a \
        cursor/stack-q73a-detail-preview-8b5a \
        dashboard-detail \
        detail-preview-73 \
        q73
      ;;
    *)
      echo "unknown PR $pr" >&2
      exit 1
      ;;
  esac
done

git checkout -f cursor/stack-q73a-detail-preview-8b5a 2>/dev/null || true
restore_capture
rm -f "$CAPTURE_BAK"
echo "done"
