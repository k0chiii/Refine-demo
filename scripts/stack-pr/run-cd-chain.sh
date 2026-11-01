#!/usr/bin/env bash
set -euo pipefail
ROOT=/workspace/wt-cd-stack
MANIFEST="$ROOT/scripts/stack-pr/manifest-dashboard-cd.json"
cp /workspace/scripts/stack-pr/manifest-dashboard-cd.json "$MANIFEST"

cd "$ROOT"
PARENT="cursor/stack-077-ui-delay-color-tokens-8b5a"
git fetch origin "$PARENT"

for id in 078 079 080 081 082 083 084 085 086 087 088; do
  entry=$(node -e "const m=require('$MANIFEST'); const e=m.find(x=>x.id==='$id'); console.log(JSON.stringify(e));")
  slug=$(node -e "console.log(JSON.parse(process.argv[1]).slug)" "$entry")
  title=$(node -e "console.log(JSON.parse(process.argv[1]).title)" "$entry")
  branch="cursor/stack-${id}-${slug}-8b5a"
  echo "=== $id $branch from $PARENT ==="
  git fetch origin "$PARENT" || true
  git checkout -B "$branch" "origin/$PARENT" 2>/dev/null || git checkout -B "$branch" "$PARENT"
  node scripts/stack-pr/cd-edits.mjs "$id"
  pnpm exec vp check --fix
  pnpm check
  pnpm typecheck
  pnpm test
  pnpm --filter @mf100/web e2e:smoke
  git add -A
  git commit -m "$title"
  git push -u origin "$branch"
  PARENT="$branch"
done
