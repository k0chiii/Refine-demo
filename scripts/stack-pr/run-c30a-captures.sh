#!/usr/bin/env bash
set -euo pipefail
ROOT="$(git rev-parse --show-toplevel)"
WEB="$ROOT/apps/web"
cd "$ROOT"

build_demo() {
  pnpm --filter @mf100/web build:demo
}

run_capture() {
  local pr=$1 phase=$2 ref=$3
  echo "=== PR #$pr $phase @ $ref ==="
  git checkout -q "$ref"
  build_demo
  mkdir -p "$WEB/e2e/out"
  if ! pgrep -f "vp preview --mode demo" >/dev/null 2>&1; then
    (cd "$WEB" && setsid sh -c 'pnpm exec vp preview --mode demo --outDir dist-demo --port 4173 --host 127.0.0.1 --strictPort' >e2e/out/preview.log 2>&1 &)
    for i in $(seq 1 90); do
      curl -sf -o /dev/null http://127.0.0.1:4173/ && break
      sleep 1
    done
  fi
  local out="$ROOT/docs/stack-pr-screenshots/c30a-pr${pr}/${phase}"
  mkdir -p "$out"
  cd "$WEB"
  STACK_PR_C30A="$pr" STACK_PR_C30A_PHASE="$phase" OUT_DIR="$out" \
    pnpm exec playwright test e2e/specs/stack-pr-c30a-capture.spec.ts --project=chromium
}

START_BRANCH="$(git branch --show-current)"
trap 'git checkout -q "$START_BRANCH"' EXIT

run_capture 86 before origin/develop
run_capture 86 after origin/cursor/transfer-work-creators-c30a
run_capture 87 before origin/cursor/transfer-work-creators-c30a
run_capture 87 after origin/cursor/slides-pdf-bundle-c30a
run_capture 88 before origin/cursor/slides-pdf-bundle-c30a
run_capture 88 after origin/cursor/notifications-and-copy-c30a

node "$ROOT/scripts/stack-pr/screenshot-validate.mjs"
