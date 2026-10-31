#!/usr/bin/env bash
set -euo pipefail
ROOT="$(git rev-parse --show-toplevel)"
WEB="$ROOT/apps/web"
STAGING="/tmp/c30a-screenshots-staging"
CAP_SPEC_BACKUP="/tmp/stack-pr-c30a-capture.spec.ts"
cp "$WEB/e2e/specs/stack-pr-c30a-capture.spec.ts" "$CAP_SPEC_BACKUP"
cd "$ROOT"
rm -rf "$STAGING"
mkdir -p "$STAGING"

build_demo() {
  pnpm --filter @mf100/web build:demo
}

run_capture() {
  local pr=$1 phase=$2 ref=$3
  echo "=== PR #$pr $phase @ $ref ==="
  rm -rf "$ROOT/docs/stack-pr-screenshots/c30a-pr${pr}"
  rm -f "$WEB/e2e/specs/stack-pr-c30a-capture.spec.ts"
  git checkout -q "$ref"
  mkdir -p "$WEB/e2e/specs"
  cp "$CAP_SPEC_BACKUP" "$WEB/e2e/specs/stack-pr-c30a-capture.spec.ts"
  pkill -f "vp preview --mode demo --outDir dist-demo --port 4173" 2>/dev/null || true
  sleep 2
  build_demo
  (cd "$WEB" && setsid sh -c 'pnpm exec vp preview --mode demo --outDir dist-demo --port 4173 --host 127.0.0.1 --strictPort' >e2e/out/preview.log 2>&1 &)
  for i in $(seq 1 90); do
    curl -sf -o /dev/null http://127.0.0.1:4173/ && break
    sleep 1
  done
  curl -sf -o /dev/null http://127.0.0.1:4173/ || { echo "preview failed"; exit 1; }
  local out="$STAGING/c30a-pr${pr}/${phase}"
  mkdir -p "$out"
  cd "$WEB"
  BASE_URL=http://127.0.0.1:4173 E2E_PREBUILT=1 \
  STACK_PR_C30A="$pr" STACK_PR_C30A_PHASE="$phase" OUT_DIR="$out" \
    pnpm exec playwright test stack-pr-c30a-capture.spec.ts --project=chromium
}

START_BRANCH="$(git branch --show-current)"
trap 'git checkout -q "$START_BRANCH"' EXIT

run_capture 86 before origin/develop
run_capture 86 after origin/cursor/transfer-work-creators-c30a
run_capture 87 before origin/cursor/transfer-work-creators-c30a
run_capture 87 after origin/cursor/slides-pdf-bundle-c30a
run_capture 88 before origin/cursor/slides-pdf-bundle-c30a
run_capture 88 after origin/cursor/notifications-and-copy-c30a

git checkout -q "$START_BRANCH"
rm -rf "$ROOT/docs/stack-pr-screenshots/c30a-pr"*
mkdir -p "$ROOT/docs/stack-pr-screenshots"
cp -a "$STAGING"/. "$ROOT/docs/stack-pr-screenshots/"

node "$ROOT/scripts/stack-pr/screenshot-validate.mjs"
