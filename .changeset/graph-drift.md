---
"semantic-inspector": minor
---

Add `semantic-inspector check` CLI: detects drift between `.semantic-inspector/annotations.json` and
the current source via static Babel analysis. Verdicts (resolved/moved/missing/ambiguous/
unverifiable), `--json` report for AI agents, `--fix` to relock moved entries, and a non-zero exit to
gate CI.
