#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"
ORIG="$(git branch --show-current)"

push_dir() {
  local branch="$1"
  local rel="$2"
  local msg="$3"
  if [[ ! -d "$ROOT/docs/stack-pr-screenshots/$rel" ]]; then
    echo "skip $branch (no $rel)"
    return 0
  fi
  echo "== $branch :: docs/stack-pr-screenshots/$rel"
  git fetch origin "$branch"
  git checkout "$branch"
  mkdir -p "docs/stack-pr-screenshots/$rel"
  rsync -a --delete "$ROOT/docs/stack-pr-screenshots/$rel/" "docs/stack-pr-screenshots/$rel/"
  git add "docs/stack-pr-screenshots/$rel"
  if git diff --cached --quiet; then
    echo "  nothing to commit"
  else
    git commit -m "$msg"
    git push -u origin "$branch"
  fi
}

push_dir cursor/stack-077-ui-delay-color-tokens-8b5a 077 "docs: refresh stack-pr 077 delay-color screenshots"
push_dir cursor/stack-078-ui-kpi-row-mock-8b5a 078 "docs: stack-pr 078 dashboard screenshots"
push_dir cursor/stack-079-ui-graphs-stage-bureau-8b5a 079 "docs: stack-pr 079 dashboard screenshots"
push_dir cursor/stack-080-ui-sns-band-visibility-8b5a 080 "docs: stack-pr 080 dashboard screenshots"
push_dir cursor/stack-q71-plan-info-warn-8b5a q71 "docs: refresh q71 plan-info warn screenshots"
push_dir cursor/stack-q70-plan-info-ui-8b5a q70 "docs: refresh q70 plan-info UI screenshots"
push_dir cursor/stack-q72-plan-info-recheck-8b5a q72 "docs: refresh q72 plan-info recheck screenshots"
push_dir cursor/stack-q73a-detail-preview-8b5a q73 "docs: refresh q73 detail preview screenshots"

git checkout "$ORIG"
echo done
