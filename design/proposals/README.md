# Design feedback proposals

Pending and rejected lessons live here. They are records for maintainers, not guidance: the
harness loader, resolver, MCP server, and Skills never read this directory as policy. Only
`pnpm design:feedback apply` moves an **accepted** proposal into `design/rules.json`.

A draft (any path) has this shape; `rule` must be one of the source-rule kinds in
`harness/core.mjs` (`sourceRuleSchema`):

```json
{
  "id": "input-label",
  "observation": "What happened, where, in which task.",
  "scope": "Which scenario, component, pattern, or all screens this affects, and why.",
  "evidence": ["path/to/reproducing-file.tsx", "test-results/design/<run>/report.md"],
  "target": "design/rules.json",
  "rule": { "id": "INPUT-LABEL", "kind": "jsx-requires-context", "...": "..." }
}
```

`propose` copies the evidence into `design/proposals/<id>/` and hashes it, so later fixes to the
artifact cannot change what was reviewed. `decide` binds the decision to the proposal digest;
editing a decided proposal invalidates it. `apply` refuses when the design authority changed
after the proposal was written.
