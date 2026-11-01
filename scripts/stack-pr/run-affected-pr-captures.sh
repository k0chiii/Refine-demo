#!/usr/bin/env bash
set -u
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"
export STACK_PR_REPO="$ROOT"
export CHROMIUM_PATH="${CHROMIUM_PATH:-/usr/bin/google-chrome}"
export SKIP_PAMPHLET_COMMENTS=1

CAPTURE_BAK="$(mktemp)"
SEED_BAK="$(mktemp)"
BACKEND_BAK="$(mktemp)"
cp "$ROOT/scripts/stack-pr/capture.ts" "$CAPTURE_BAK"
cp "$ROOT/apps/convex/convex/seed.ts" "$SEED_BAK"
cp "$ROOT/apps/web/src/demo/backend.ts" "$BACKEND_BAK"

restore_capture() {
  cp "$CAPTURE_BAK" "$ROOT/scripts/stack-pr/capture.ts"
  cp "$SEED_BAK" "$ROOT/apps/convex/convex/seed.ts"
  cp "$BACKEND_BAK" "$ROOT/apps/web/src/demo/backend.ts"
}

checkout_sources() {
  git fetch origin "$1"
  local ref="origin/$1"
  comm -23 \
    <(git ls-files apps packages apps/convex | sort -u) \
    <(git ls-tree -r --name-only "$ref" -- apps packages apps/convex 2>/dev/null | sort -u) \
    | while read -r f; do
        [[ -z "$f" ]] && continue
        git rm -f -- "$f" 2>/dev/null || rm -f -- "$f"
      done
  git clean -fd apps packages apps/convex 2>/dev/null || true
  git checkout "$ref" -- apps packages apps/convex
  restore_capture
  while read -r junk; do
    [[ -z "$junk" ]] && continue
    if ! git cat-file -e "$ref:$junk" 2>/dev/null; then
      rm -f "$junk"
    fi
  done <<'JUNK'
apps/convex/convex/emergencyReview.test.ts
apps/web/e2e/specs/stack-pr-c30a-capture.spec.ts
apps/web/e2e/specs/stack-pr-e090-capture.spec.ts
apps/web/src/features/notifications/notificationRowMenu.tsx
apps/web/src/features/review/UrgentReviewChip.tsx
apps/web/src/features/review/urgentReview.test.ts
apps/web/src/features/work/TransferCreatorsDialog.tsx
packages/application/src/__tests__/emergencyReview.test.ts
packages/domain/src/__tests__/submitDeadline.test.ts
packages/domain/src/revision/submitDeadline.ts
JUNK
}

restore_sources() {
  git checkout HEAD -- apps packages apps/convex
  restore_capture
}

trap restore_sources EXIT

build_demo() {
  local label="$1"
  local cache_key="${2:-$label}"
  local cache_root="${STACK_PR_DEMO_CACHE:-/tmp/mf100-dist-cache}"
  local cached="$cache_root/$cache_key/dist-demo"
  echo "  build:demo for $label"
  if [[ -f "$cached/index.html" ]]; then
    rm -rf "$ROOT/apps/web/dist-demo"
    mkdir -p "$ROOT/apps/web/dist-demo"
    cp -a "$cached/." "$ROOT/apps/web/dist-demo/"
    echo "  build:demo cache hit $cache_key"
    return 0
  fi
  local attempt
  for attempt in 1 2 3; do
    if (cd "$ROOT/apps/web" && NODE_OPTIONS="${NODE_OPTIONS:---max-old-space-size=4096}" VP_CACHE=0 pnpm build:demo); then
      mkdir -p "$cache_root/$cache_key"
      rm -rf "$cache_root/$cache_key/dist-demo"
      cp -a "$ROOT/apps/web/dist-demo" "$cache_root/$cache_key/dist-demo"
      return 0
    fi
    echo "  build failed (attempt $attempt), retrying after cleanup" >&2
    rm -rf "$ROOT/apps/web/dist-demo" "$ROOT/apps/web/node_modules/.vite" 2>/dev/null || true
    sync
    sleep 8
  done
  return 1
}

run_one() {
  local scene="$1"
  local prefix="$2"
  local skip_plan="${3:-1}"
  local clip="${4:-}"
  local seed_backlog="${5:-0}"
  local open_switcher="${6:-0}"
  local expand_overview="${7:-}"
  local seed_confidentiality="${8:-1}"
  local port=$((4500 + RANDOM % 200))
  local req="/tmp/mf100-cap-$$.json"
  CLIP="$clip" SCENE="$scene" PREFIX="$prefix" OPEN_SW="$open_switcher" EXPAND_OV="$expand_overview" REQ="$req" node <<'NODE'
const fs = require("fs");
const clip = process.env.CLIP || "";
const scene = process.env.SCENE || "";
const prefix = process.env.PREFIX || "";
const openSwitcher = process.env.OPEN_SW || "";
const expandOverview = process.env.EXPAND_OV || "";
const req = process.env.REQ || "";
const o = {};
if (clip) o.clipSelector = clip;
if (openSwitcher === "1") o.openViewSwitcher = true;
if (expandOverview === "0") o.expandOverview = false;
fs.writeFileSync(req, JSON.stringify({ shots: { desktop: scene }, prefix, opts: o }));
NODE
  env CAPTURE_PORT="$port" BASE_URL="http://127.0.0.1:$port" \
    SKIP_DEMO_BUILD=1 SKIP_PAMPHLET_COMMENTS=1 SKIP_PLAN_INFO_WARNINGS="$skip_plan" \
    SEED_BACKLOG_CAPTURE="$seed_backlog" \
    SEED_CONFIDENTIALITY="$seed_confidentiality" \
    SCREENSHOT_CORPUS="$ROOT/docs/stack-pr-screenshots" \
    pnpm dlx tsx scripts/stack-pr/capture-cli.ts "$req"
  local st=$?
  rm -f "$req"
  return $st
}

validate_pair() {
  local before="$1"
  local after="$2"
  if [[ ! -f "$before" || ! -f "$after" ]]; then
    echo "missing pair: $before $after" >&2
    return 1
  fi
  pnpm dlx tsx -e "
    import { assertBeforeAfterDistinct } from './scripts/stack-pr/screenshot-validate.ts';
    assertBeforeAfterDistinct('${before}', '${after}');
  "
}

capture_pair() {
  local pr="$1" before_ref="$2" after_ref="$3" before_scene="$4" after_scene="$5" out_id="$6"
  local before_skip="${7:-1}" after_skip="${8:-1}"
  local clip="${9:-}"
  local seed="${10:-0}"
  local after_clip="${11:-$clip}"
  local out="$ROOT/docs/stack-pr-screenshots/$out_id"
  mkdir -p "$out"
  rm -f "$out/before-desktop.png" "$out/after-desktop.png" "$out"/*.dom.txt

  echo "=== PR #$pr BEFORE $before_ref $before_scene ==="
  checkout_sources "$before_ref"
  build_demo "$before_ref" "$before_ref"
  run_one "$before_scene" "$out/before" "$before_skip" "$clip" "$seed" || return 1

  echo "=== PR #$pr AFTER $after_ref $after_scene ==="
  checkout_sources "$after_ref"
  build_demo "$after_ref" "$after_ref"
  run_one "$after_scene" "$out/after" "$after_skip" "$after_clip" "$seed" || return 1

  validate_pair "$out/before-desktop.png" "$out/after-desktop.png" || return 1
  restore_sources
  return 0
}

: > /tmp/pr-capture-failures.log
PRS=("$@")
if [[ ${#PRS[@]} -eq 0 ]]; then
  PRS=(167 170 171 172 173 194 196 198 200 201 202 203 204 205)
fi

for pr in "${PRS[@]}"; do
  st=0
  case "$pr" in
    167)
      mkdir -p "$ROOT/docs/stack-pr-screenshots/075"
      rm -f "$ROOT/docs/stack-pr-screenshots/075/before-desktop.png" "$ROOT/docs/stack-pr-screenshots/075/after-desktop.png"
      checkout_sources cursor/stack-073-domain-danger-kpi-v2-8b5a && build_demo 073 && \
        run_one 27-make-creator "$ROOT/docs/stack-pr-screenshots/075/before" 1 "" 0 || st=$?
      checkout_sources cursor/stack-075-ui-home-view-switcher-v2-8b5a && build_demo 075 && \
        run_one 27-make-creator "$ROOT/docs/stack-pr-screenshots/075/after" 1 "" 0 || st=$?
      validate_pair "$ROOT/docs/stack-pr-screenshots/075/before-desktop.png" "$ROOT/docs/stack-pr-screenshots/075/after-desktop.png" || st=$?
      restore_sources
      ;;
    170)
      mkdir -p "$ROOT/docs/stack-pr-screenshots/077"
      rm -f "$ROOT/docs/stack-pr-screenshots/077/before-desktop.png" "$ROOT/docs/stack-pr-screenshots/077/after-desktop.png"
      checkout_sources cursor/stack-076-detail-route-shell-v2-8b5a && build_demo 076 076 && \
        run_one dashboard-backlog-delay "$ROOT/docs/stack-pr-screenshots/077/before" 1 'section[aria-labelledby="ov-backlog"]' 1 || st=$?
      checkout_sources cursor/stack-077-ui-delay-color-tokens-8b5a && build_demo 077 077 && \
        run_one dashboard-backlog-delay "$ROOT/docs/stack-pr-screenshots/077/after" 1 'section[aria-labelledby="ov-backlog"]' 1 || st=$?
      validate_pair "$ROOT/docs/stack-pr-screenshots/077/before-desktop.png" "$ROOT/docs/stack-pr-screenshots/077/after-desktop.png" || st=$?
      restore_sources
      ;;
    171)
      capture_pair 171 cursor/stack-077-ui-delay-color-tokens-8b5a cursor/stack-078-ui-kpi-row-mock-8b5a \
        dashboard-manager dashboard-manager 078 1 1 "" 1 || st=$?
      ;;
    172)
      capture_pair 172 cursor/stack-078-ui-kpi-row-mock-8b5a cursor/stack-079-ui-graphs-stage-bureau-8b5a \
        dashboard-manager dashboard-manager 079 1 1 "" 1 'section[aria-labelledby="ov-stages"]' || st=$?
      ;;
    173)
      mkdir -p "$ROOT/docs/stack-pr-screenshots/080"
      rm -f "$ROOT/docs/stack-pr-screenshots/080/before-desktop.png" "$ROOT/docs/stack-pr-screenshots/080/after-desktop.png"
      checkout_sources cursor/stack-079-ui-graphs-stage-bureau-8b5a && build_demo 079 && \
        run_one 27-make-creator "$ROOT/docs/stack-pr-screenshots/080/before" 1 "" 0 || st=$?
      checkout_sources cursor/stack-080-ui-sns-band-visibility-8b5a && build_demo 080 && \
        run_one 27-make-creator "$ROOT/docs/stack-pr-screenshots/080/after" 1 "" 0 || st=$?
      validate_pair "$ROOT/docs/stack-pr-screenshots/080/before-desktop.png" "$ROOT/docs/stack-pr-screenshots/080/after-desktop.png" || st=$?
      restore_sources
      ;;
    194)
      mkdir -p "$ROOT/docs/stack-pr-screenshots/q68/before" "$ROOT/docs/stack-pr-screenshots/q68/after"
      rm -f "$ROOT/docs/stack-pr-screenshots/q68/before"/* "$ROOT/docs/stack-pr-screenshots/q68/after"/*
      checkout_sources develop && build_demo develop && \
        run_one q68-works-before "$ROOT/docs/stack-pr-screenshots/q68/before/02-works-list" 1 ".works-table" 1 0 "" 0 || st=$?
      checkout_sources cursor/stack-q68-copy-next-revision-8b5a && build_demo q68 && \
        run_one q68-works-after "$ROOT/docs/stack-pr-screenshots/q68/after/02-works-list" 1 ".works-table" 1 0 "" 1 || st=$?
      validate_pair "$ROOT/docs/stack-pr-screenshots/q68/before/02-works-list-desktop.png" \
        "$ROOT/docs/stack-pr-screenshots/q68/after/02-works-list-desktop.png" || st=$?
      restore_sources
      ;;
    196)
      mkdir -p "$ROOT/docs/stack-pr-screenshots/061"
      rm -f "$ROOT/docs/stack-pr-screenshots/061/before-desktop.png" "$ROOT/docs/stack-pr-screenshots/061/after-desktop.png"
      checkout_sources cursor/stack-q68-copy-next-revision-8b5a && build_demo q68b && \
        run_one editor-shortcut-open "$ROOT/docs/stack-pr-screenshots/061/before" 1 "" 0 || st=$?
      checkout_sources cursor/stack-q62c-drop-shortcut-sheet-8b5a && build_demo q62 && \
        run_one editor-shortcut-closed "$ROOT/docs/stack-pr-screenshots/061/after" 1 "" 0 || st=$?
      validate_pair "$ROOT/docs/stack-pr-screenshots/061/before-desktop.png" \
        "$ROOT/docs/stack-pr-screenshots/061/after-desktop.png" || st=$?
      restore_sources
      ;;
    198)
      mkdir -p "$ROOT/docs/stack-pr-screenshots/062"
      rm -f "$ROOT/docs/stack-pr-screenshots/062/before-desktop.png" "$ROOT/docs/stack-pr-screenshots/062/after-desktop.png"
      checkout_sources develop && build_demo develop198 && \
        run_one works-deadline-header-before "$ROOT/docs/stack-pr-screenshots/062/before" 1 ".works-table" 0 0 "" 0 || st=$?
      checkout_sources cursor/stack-fix-deadline-diamond-8b5a && build_demo fix198 && \
        run_one works-deadline-header-after "$ROOT/docs/stack-pr-screenshots/062/after" 1 ".works-table" 0 0 "" 1 || st=$?
      validate_pair "$ROOT/docs/stack-pr-screenshots/062/before-desktop.png" \
        "$ROOT/docs/stack-pr-screenshots/062/after-desktop.png" || st=$?
      restore_sources
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
      checkout_sources cursor/stack-q72-plan-info-recheck-8b5a && build_demo q72 q72 && \
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
      mkdir -p "$ROOT/docs/stack-pr-screenshots/q73/after" "$ROOT/docs/stack-pr-screenshots/q74/after"
      rm -f "$ROOT/docs/stack-pr-screenshots/q74/after"/*
      checkout_sources cursor/stack-q73a-detail-preview-8b5a && build_demo q73ref && \
        run_one detail-preview-73 "$ROOT/docs/stack-pr-screenshots/q73/after/detail-preview" 1 || st=$?
      checkout_sources cursor/stack-q74c-detail-no-submission-8b5a && build_demo q74 && \
        run_one detail-preview-73 "$ROOT/docs/stack-pr-screenshots/q74/after/detail-preview" 1 || st=$?
      validate_pair "$ROOT/docs/stack-pr-screenshots/q73/after/detail-preview-desktop.png" \
        "$ROOT/docs/stack-pr-screenshots/q74/after/detail-preview-desktop.png" || st=$?
      restore_sources
      ;;
    *) echo "unknown PR $pr"; st=1 ;;
  esac
  if [[ $st -ne 0 ]]; then echo "PR $pr failed" | tee -a /tmp/pr-capture-failures.log; fi
done

restore_sources
trap - EXIT
rm -f "$CAPTURE_BAK" "$SEED_BAK" "$BACKEND_BAK"
fail=0
if [[ -s /tmp/pr-capture-failures.log ]]; then fail=1; fi
AUDIT_DIRS=(075 077 078 079 080 q68 061 062 q70 q71 q72 q75 q74 q73)
for d in "${AUDIT_DIRS[@]}"; do
  dir="$ROOT/docs/stack-pr-screenshots/$d"
  if [[ -d "$dir" ]]; then
    node scripts/stack-pr/screenshot-validate.mjs "$dir" || fail=1
  fi
done
if [[ $fail -ne 0 ]]; then
  echo "capture batch had failures" >&2
  exit 1
fi
echo done
