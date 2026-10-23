# Design decisions

Contextual decisions for harness tasks, with their reasons and scope. Binding, checkable
requirements go to `design/rules.json`; this file keeps the reasoning, accepted exceptions, and
rejected ideas so later reviews do not repeat them. Newest first.

## 2026-10-24 — NATIVE-SELECT adopted

- Decision: Screens use `Select` (SelectTrigger/SelectValue/SelectContent/SelectItem) for one
  choice from a list, never `NativeSelect` (`NATIVE-SELECT`, MUST, scope `design.components`).
- Evidence: Proposal `design/proposals/native-select.json` and its copy of the pre-fix
  `apps/deck/app/features/deck/components/ActionFields.tsx`, whose every choice used
  NativeSelect. The maintainer asked for the design-system Select instead of the browser-native
  popup.
- Decided by: Harineko0 (accepted, chose MUST for all apps with a detector over a SHOULD note or a
  deck-only fix). Applied through `pnpm design:feedback apply native-select`.
- Detector: the existing kinds could not express it (`import-policy` matches module paths, and
  NativeSelect ships from `@gdgjp/design-system`), so the harness gained
  `jsx-forbidden-component` (`harness/core.mjs`, `harness/source-check.mjs`).
- Verified on the next run: `design:resolve scenario.profile-edit` returns the rule;
  `design:check-source` exits 1 on the proposal's copy and 0 on the fixed deck file and on
  `Select.stories.tsx`; `harness.test.mjs` covers a NativeSelect and a Select case.
- Known limit: NativeSelect itself stays exported, and its own stories and the design-system
  source are reported if checked. Forms that post the value pass `name` to `Select` (Radix
  renders a hidden native select).
- Open: other apps' NativeSelect usages are app changes, not part of this decision.

## 2026-10-23 — INPUT-LABEL adopted

- Decision: Every Input and Textarea needs an enclosing FormField/Field or its own
  aria-label/aria-labelledby; a placeholder is not a label (`INPUT-LABEL`, MUST).
- Evidence: Proposal `design/proposals/input-label.json` and its scan copy. A repository scan
  found `apps/tinyurl/app/routes/tags/tags.tsx:126`, a search field labelled only by
  `placeholder="Search..."`.
- Decided by: Harineko0 (accepted). Applied through `pnpm design:feedback apply input-label`.
- Verified on the next run: `design:resolve` and the restarted MCP server return the rule;
  `design:check-source` on tags.tsx exits 1 at 126:15; a copy with `aria-label` passes; the
  profile-edit story (Input inside FormField) passes.
- Known limit: the detector matches JSX tags only, so a local wrapper that renders FormField
  (for example `Control` in `apps/img/.../url-builder-card.tsx`) is reported as a false
  positive. `design:check` only inspects scenario files, so app CI is unaffected.
- Open: fixing the tinyurl search field is an app change, not part of this decision.
- Process note: the first proposal was refused at apply time because a formatter run changed the
  bytes of `design/*.json` after it was written. JSON contracts are now hashed canonically, and
  the same proposal was re-created and re-decided with the same content.

## 2026-10-23 — Harness established on the profile-edit pilot

- Decision: The harness starts with one scenario (`scenario.profile-edit`) on the `edit-form`
  pattern, rendered as the story `Patterns/Profile Edit`.
- Context: Requested by the design-system maintainer (Harineko0). Knowledge stays inside
  `packages/design-system/`; Agent Skills live in the monorepo `.agents/skills/`.
- Change: DESIGN.md front-matter is now generated from `src/styles/tokens.css`
  (`pnpm design:tokens`) so the token file stays the only hand-edited value source. The
  generated output was byte-identical to the previous hand-written front-matter.
- Scope: Edit forms. Other patterns (lists, dialogs, wizards) need their own pattern and scenario.
- Status/owner: Accepted by the maintainer as the harness scope; individual rules below are
  recorded with their own decisions.

## Edit-form feedback placement

- Decision: Save results (success and failure) render as a persistent `Alert` inside the form
  card above the fields, not as a toast.
- Reason: DESIGN.md reserves Toast for short-lived results and requires resolvable errors to stay
  visible; a failed save must stay on screen while the user retries.
- Rejected alternative: Toast-only success with an inline error — two channels for one outcome
  and the success message disappears before narrow-screen users scroll back.
- Status: Proposed by the harness author; open for the maintainer's confirmation.

## Primary/secondary contrast exclusion in axe

- Decision: `A11Y-AXE` excludes `.gdg-button-primary` and `.gdg-button-secondary` from axe, as the
  existing library spec does.
- Reason: DESIGN.md documents white-on-brand contrast (about 3.56:1 / 3.8:1) as a known
  limitation of action surfaces held to the 3:1 control threshold.
- Exception scope: Only these two button surfaces. Widening the exclusion needs a new entry here.
