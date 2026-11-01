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
  rsync -a --delete "$ROOT/docs/stack-pr-screenshots/$rel/" "docs/stack-pr-screenshots/$rel/" 2>/dev/null || \
    cp -a "$ROOT/docs/stack-pr-screenshots/$rel/." "docs/stack-pr-screenshots/$rel/"
  git add "docs/stack-pr-screenshots/$rel"
  if git diff --cached --quiet; then
    echo "  nothing to commit"
  else
    git commit -m "$msg"
    git push -u origin "$branch"
  fi
}

push_dir cursor/stack-075-ui-home-view-switcher-v2-8b5a 075 "docs: refresh stack-pr 075 view-switcher screenshots"
push_dir cursor/stack-q68-copy-next-revision-8b5a q68 "docs: refresh q68 works-list screenshots"
push_dir cursor/stack-q62c-drop-shortcut-sheet-8b5a 061 "docs: refresh 061 editor shortcut screenshots"
push_dir cursor/stack-fix-deadline-diamond-8b5a 062 "docs: refresh 062 deadline header screenshots"
push_dir cursor/stack-q75c-detail-no-activity-8b5a q75 "docs: refresh q75 detail screenshots"
push_dir cursor/stack-q74c-detail-no-submission-8b5a q74 "docs: refresh q74 detail screenshots"
push_dir cursor/stack-077-ui-delay-color-tokens-8b5a 077 "docs: refresh stack-pr 077 delay-color screenshots"
push_dir cursor/stack-078-ui-kpi-row-mock-8b5a 078 "docs: stack-pr 078 dashboard screenshots"
push_dir cursor/stack-079-ui-graphs-stage-bureau-8b5a 079 "docs: stack-pr 079 dashboard screenshots"
push_dir cursor/stack-080-ui-sns-band-visibility-8b5a 080 "docs: stack-pr 080 dashboard screenshots"
push_dir cursor/stack-q71-plan-info-warn-8b5a q71 "docs: refresh q71 plan-info warn screenshots"
push_dir cursor/stack-q72-plan-info-recheck-8b5a q72 "docs: refresh q72 plan-info recheck screenshots"
push_dir cursor/stack-q73a-detail-preview-8b5a q73 "docs: refresh q73 detail preview screenshots"

git checkout "$ORIG"
echo done
