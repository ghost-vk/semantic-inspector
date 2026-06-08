---
"semantic-inspector": minor
---

Add `semantic-inspector check` CLI: detects drift between `.semantic-inspector/annotations.json` and
the current source via static Babel analysis. Verdicts (resolved/moved/missing/ambiguous/
unverifiable), `--json` report for AI agents, `--fix` to relock moved entries, and a non-zero exit to
gate CI.

The scan caps per-file size (~2 MB) before parsing so a single huge source file can't drive Babel to
an out-of-memory crash of the CI gate; files over the cap or that fail to parse are skipped and
counted. The `--json` report and the human table both surface a `skipped` count so a partial scan is
never mistaken for an authoritative one. The `--json` schema is now documented in the README.
