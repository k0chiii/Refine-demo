#!/usr/bin/env bash
set -u
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"
export STACK_PR_REPO="$ROOT"
export CHROMIUM_PATH="${CHROMIUM_PATH:-/usr/bin/google-chrome}"
export SKIP_PAMPHLET_COMMENTS=1

CAPTURE_BAK="$(mktemp)"
SEED_BAK="$(mktemp)"
cp "$ROOT/scripts/stack-pr/capture.ts" "$CAPTURE_BAK"
cp "$ROOT/apps/convex/convex/seed.ts" "$SEED_BAK"

restore_capture() {
  cp "$CAPTURE_BAK" "$ROOT/scripts/stack-pr/capture.ts"
  cp "$SEED_BAK" "$ROOT/apps/convex/convex/seed.ts"
}

checkout_sources() {
  git fetch origin "$1"
  git checkout "origin/$1" -- apps packages apps/convex
  restore_capture
}

restore_sources() {
  git checkout HEAD -- apps packages apps/convex
  restore_capture
}

build_demo() {
  echo "  build:demo for $1"
  (cd "$ROOT/apps/web" && NODE_OPTIONS="${NODE_OPTIONS:---max-old-space-size=8192}" pnpm build:demo)
}

run_one() {
  local scene="$1"
  local prefix="$2"
  local skip_plan="${3:-1}"
  local port=$((4500 + RANDOM % 200))
  local req="/tmp/mf100-cap-$$.json"
  node -e "require('fs').writeFileSync('$req', JSON.stringify({shots:{desktop:'$scene'},prefix:'$prefix',opts:{}}));"
  env CAPTURE_PORT="$port" BASE_URL="http://127.0.0.1:$port" \
    SKIP_DEMO_BUILD=1 SKIP_PAMPHLET_COMMENTS=1 SKIP_PLAN_INFO_WARNINGS="$skip_plan" \
    SCREENSHOT_CORPUS="$(dirname "$prefix")" \
    pnpm dlx tsx scripts/stack-pr/capture-cli.ts "$req"
  local st=$?
  rm -f "$req"
  return $st
}

capture_pair() {
  local pr="$1" before_ref="$2" after_ref="$3" before_scene="$4" after_scene="$5" out_id="$6"
  local before_skip="${7:-1}" after_skip="${8:-1}"
  local out="$ROOT/docs/stack-pr-screenshots/$out_id"
  mkdir -p "$out"
  rm -f "$out/before-desktop.png" "$out/after-desktop.png" "$out"/*.dom.txt

  echo "=== PR #$pr BEFORE $before_ref $before_scene ==="
  checkout_sources "$before_ref"
  build_demo "$before_ref"
  run_one "$before_scene" "$out/before-desktop" "$before_skip" || return 1

  echo "=== PR #$pr AFTER $after_ref $after_scene ==="
  checkout_sources "$after_ref"
  build_demo "$after_ref"
  run_one "$after_scene" "$out/after-desktop" "$after_skip" || return 1

  restore_sources
  return 0
}

: > /tmp/pr-capture-failures.log
PRS=("$@")
if [[ ${#PRS[@]} -eq 0 ]]; then PRS=(170 171 172 173 200 201 202 203 204 205); fi

for pr in "${PRS[@]}"; do
  st=0
  case "$pr" in
    170)
      capture_pair 170 cursor/stack-076-detail-route-shell-v2-8b5a cursor/stack-077-ui-delay-color-tokens-8b5a \
        dashboard-manager dashboard-backlog-delay 077 1 1 || st=$?
      ;;
    171)
      capture_pair 171 cursor/stack-077-ui-delay-color-tokens-8b5a cursor/stack-078-ui-kpi-row-mock-8b5a \
        dashboard-manager dashboard-manager 078 || st=$?
      ;;
    172)
      capture_pair 172 cursor/stack-078-ui-kpi-row-mock-8b5a cursor/stack-079-ui-graphs-stage-bureau-8b5a \
        dashboard-manager dashboard-manager 079 || st=$?
      ;;
    173)
      capture_pair 173 cursor/stack-079-ui-graphs-stage-bureau-8b5a cursor/stack-080-ui-sns-band-visibility-8b5a \
        dashboard-approver dashboard-approver 080 || st=$?
      ;;
    200)
      mkdir -p "$ROOT/docs/stack-pr-screenshots/q71/before" "$ROOT/docs/stack-pr-screenshots/q71/after"
      rm -f "$ROOT/docs/stack-pr-screenshots/q71/before"/* "$ROOT/docs/stack-pr-screenshots/q71/after"/*
      checkout_sources cursor/stack-q69-plan-info-schema-8b5a && build_demo q69 && \
        run_one q71-comments-web-clean "$ROOT/docs/stack-pr-screenshots/q71/before/plan-info-no-warn" 1 || st=$?
      checkout_sources cursor/stack-q71-plan-info-warn-8b5a && build_demo q71 && \
        run_one q71-plan-info-warn "$ROOT/docs/stack-pr-screenshots/q71/after/plan-info-warn" 0 || st=$?
      restore_sources
      ;;
    201)
      mkdir -p "$ROOT/docs/stack-pr-screenshots/q70/before" "$ROOT/docs/stack-pr-screenshots/q70/after"
      rm -f "$ROOT/docs/stack-pr-screenshots/q70/before"/* "$ROOT/docs/stack-pr-screenshots/q70/after"/*
      checkout_sources cursor/stack-q69-plan-info-schema-8b5a && build_demo q69 && \
        run_one q70-work-form-no-plan "$ROOT/docs/stack-pr-screenshots/q70/before/work-form-no-plan" 1 || st=$?
      checkout_sources cursor/stack-q70-plan-info-ui-8b5a && build_demo q70 && \
        run_one q70-work-form-plan "$ROOT/docs/stack-pr-screenshots/q70/after/work-form-plan" 1 && \
        run_one q70-info-tab-plan "$ROOT/docs/stack-pr-screenshots/q70/after/info-tab-plan" 1 || st=$?
      restore_sources
      ;;
    202)
      mkdir -p "$ROOT/docs/stack-pr-screenshots/q72/before" "$ROOT/docs/stack-pr-screenshots/q72/after"
      rm -f "$ROOT/docs/stack-pr-screenshots/q72/before"/* "$ROOT/docs/stack-pr-screenshots/q72/after"/*
      checkout_sources cursor/stack-q71-plan-info-warn-8b5a && build_demo q71 && \
        run_one q72-plan-info-before-warn "$ROOT/docs/stack-pr-screenshots/q72/before/before-recheck" 0 || st=$?
      checkout_sources cursor/stack-q72-plan-info-recheck-8b5a && build_demo q72 && \
        run_one q72-plan-info-recheck "$ROOT/docs/stack-pr-screenshots/q72/after/after-recheck" 0 || st=$?
      restore_sources
      ;;
    203)
      mkdir -p "$ROOT/docs/stack-pr-screenshots/q75/after"
      rm -f "$ROOT/docs/stack-pr-screenshots/q75/after"/*
      checkout_sources cursor/stack-q75c-detail-no-activity-8b5a && build_demo q75 && \
        run_one detail-preview-73 "$ROOT/docs/stack-pr-screenshots/q75/after/detail-no-activity" 1 || st=$?
      restore_sources
      ;;
    204)
      mkdir -p "$ROOT/docs/stack-pr-screenshots/q73/before" "$ROOT/docs/stack-pr-screenshots/q73/after"
      rm -f "$ROOT/docs/stack-pr-screenshots/q73/before"/* "$ROOT/docs/stack-pr-screenshots/q73/after"/*
      checkout_sources cursor/stack-086-ui-detail-shell-mock-8b5a && build_demo 086 && \
        run_one dashboard-detail "$ROOT/docs/stack-pr-screenshots/q73/before/detail-shell" 1 || st=$?
      checkout_sources cursor/stack-q73a-detail-preview-8b5a && build_demo q73 && \
        run_one detail-preview-73 "$ROOT/docs/stack-pr-screenshots/q73/after/detail-preview" 1 || st=$?
      restore_sources
      ;;
    205)
      mkdir -p "$ROOT/docs/stack-pr-screenshots/q74/before" "$ROOT/docs/stack-pr-screenshots/q74/after"
      rm -f "$ROOT/docs/stack-pr-screenshots/q74/before"/* "$ROOT/docs/stack-pr-screenshots/q74/after"/*
      checkout_sources cursor/stack-q73a-detail-preview-8b5a && build_demo q73b && \
        run_one detail-preview-73 "$ROOT/docs/stack-pr-screenshots/q74/before/detail-preview" 1 || st=$?
      checkout_sources cursor/stack-q74c-detail-no-submission-8b5a && build_demo q74 && \
        run_one detail-preview-73 "$ROOT/docs/stack-pr-screenshots/q74/after/detail-preview" 1 || st=$?
      restore_sources
      ;;
    *) echo "unknown PR $pr"; st=1 ;;
  esac
  if [[ $st -ne 0 ]]; then echo "PR $pr failed" | tee -a /tmp/pr-capture-failures.log; fi
done

restore_sources
rm -f "$CAPTURE_BAK" "$SEED_BAK"
echo done
