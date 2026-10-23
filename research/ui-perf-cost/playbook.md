# Playbook: behavior-preserving perf/cost (figure-it-out)

## Done predicate
- `pnpm check` / targeted tests green.
- Existing UI surfaces still reachable (no feature deletion).
- Incomplete `workSummaries` still produce the same dashboard/list results via fallback.
- No production backfill mutation executed.

## Out of scope
- Removing compare / ProcessingTools / notation CMS / SNS / live viewers.
- Merging make/works/write IA.
- Convex Insights (operator).
- Pages preview disable (Cloudflare console).
- Production data backfill.

## Units (parallel seams)
1. Frontend weight: SW precache shell-only; drop idle full-route preload; Editor lazy; PDF modern; OCR trim; warmPdf only when needed.
2. Convex summaries: extend workSummaries; sync on write; list + dashboard + submitTargets use when complete, else fallback.
3. Edge: head_sampling_rate; Stream token reuse if safe; multipart complete without full re-read if safe; COST.md note.

## Verification
- Domain/application tests for dashboard/list/submit.
- Web typecheck + existing unit tests for changed modules.
- Optional e2e smoke only if web routes touched heavily.
