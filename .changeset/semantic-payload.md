---
"semantic-inspector": minor
---

Add an opt-in `semantic` prop. When enabled, clicking an element copies a multi-line block with
its visible text label, sibling index (N of M among same tag + `data-comp`), `data-comp` component
path, and key attributes (`id`, `data-testid`, `name`, `href`, `type`) in addition to
`Component — file:line:col`. Default output and the hover overlay are unchanged; signals are
computed at click time only. A custom `formatText` now receives the richer `SemanticInfo` object.
