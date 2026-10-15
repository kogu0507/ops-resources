# Issue #26 — M0 audit and offline handoff

Audit date: 2026-10-15 JST. M0 is a read-only repository/environment audit; it does not prove live API connectivity or deployment readiness.

## Authority and scope

- Development specification: [GitHub Issue #26](https://github.com/kogu0507/ops-resources/issues/26), fetched through the GitHub connector.
- Measurement authority: [MEASUREMENT-FACTS-SPEC.md](https://drive.google.com/file/d/1Sz3_ryrqJUhXk5Q8-tXEDpCpxzgx2kY7/view).
- Design authority: [DESIGN-NOTES — site/note/analytics recurring work, 2026-10-10](https://docs.google.com/document/d/1qjhGFz8l7crlPzkjD32AP7eR0nw2hxtW6WMBppFddtI/edit), especially sections IV/V.
- The Drive documents remain authoritative; this record does not replace or reproduce them. Parent coordination owns the fresh authority reads and their reconciliation with implementation.
- Implementation is an independent project under `ai-automation/gas-site-analytics/`. The existing Drive-state project, deployment mappings, targets, credentials, and workflows remain outside the write scope.

## Base and repository evidence

Remote-default base: `6505b845944a416aca63f74da5228758e85a62c6`.

The base checkout contains no tracked `AGENTS.md` or `CODEX-HANDOFF.md`. The supplied repository instructions and original workspace's local `CODEX-HANDOFF.md` were read. The latter is a derived pointer, not current task-state authority. The isolated working checkout was clean at the end of M0 (`git --work-tree=. status --short`).

### Existing workflow isolation

- `.github/workflows/gas-dev-deploy.yml:3-14`: push deployment is restricted to `main` and explicit paths: Drive-state `src/**`, `scripts/**`, `package.json`, `package-lock.json`, `.claspignore`, and the exact Dev workflow file.
- `.github/workflows/gas-dev-deploy.yml:25-29`: the deployment uses the `development` environment and runs from `ai-automation/gas-drive-state`.
- `.github/workflows/gas-dev-deploy.yml:48-64`: existing environment secrets materialize the Dev clasp mapping; the existing exact-target preflight precedes `clasp push`.
- `.github/workflows/gas-bootstrap-ci.yml:3-9`: existing PR-only validation is selected by `gas-drive-state/**` or `gas-*.yml` / `gas-*.disabled` workflow changes.
- `.github/workflows/gas-prod-deploy.yml.disabled:1-4`: Production template is intentionally inert and must remain disabled.

Consequently, adding files only under `ai-automation/gas-site-analytics/**` does not select the existing Dev deployment or existing bootstrap PR check. No workflow, CI/CD enablement, clasp mapping, or deployment is required for M1. Final review must verify that the actual diff stays inside the new directory; path isolation depends on that condition.

### Reusable design patterns, without coupling projects

- `gas-drive-state/src/Collector.gs:51`: a script lock serializes collection.
- `gas-drive-state/src/Collector.gs:154`: queue updates and commit them through one Sheets `spreadsheets.batchUpdate` request.
- `gas-drive-state/scripts/validate-deploy-target.mjs`: exact target, root directory, and push-file allowlist validation.
- `gas-drive-state/scripts/validate-bootstrap.mjs`: Node compilation and mocked GAS execution.

These are design references only. No existing source, IDs, OAuth configuration, or credentials should be imported into the analytics project. In particular, existing Drive and trigger scopes are unrelated to the analytics collector.

## M0 verification and limits

Executed on the identical base checkout with Node `v22.22.3`:

```text
node ai-automation/gas-drive-state/scripts/validate-bootstrap.mjs
runtime-health-pack-v0.1.2: PASS, cases=28
bootstrap validation PASS
```

This proves only that the existing offline bootstrap checks passed on the audited base. It is not evidence for analytics correctness, real GSC/GA4 access, current Production behavior, or live Dev integration.

No live analytics site/property/spreadsheet/script IDs were inferred. No credentials or OAuth tokens were read or added for this collector. Production changes = 0; auth changes = 0; billing changes = 0; trigger changes = 0. No API enablement, live analytics query, Sheet creation/write, `clasp push`, or deployment was performed during M0.

## M1 handoff

M1 implementation is complete for offline review: **43 tests PASS / 0 FAIL** on Node v22.22.3, using `node --test ai-automation/gas-site-analytics/test/collector.test.mjs`. Parent coordination independently reran the suite. The fixtures simulate Google responses; no real measurements were obtained. Final independent review is recorded in [M1-REVIEW.md](M1-REVIEW.md).

Implemented GSC total/query/page and GA4 path/title views/active-users plus session acquisition reports, compatibility checks, bounded pagination, strict normalization, source-local 28-day windows, metadata and semantic keys, one atomic Sheets replacement, stale-row clearing, and exact readback. The entry point defaults to disabled and checks the dedicated Script ID before network activity. The final changes are confined to this new project directory; existing source, workflows, and deployment configuration remain unchanged. The README contains the bounded next-DEV handoff prompt and approval prerequisites.

Required offline checks include request generation and normalization for GSC totals/query/page and GA4 page/session-source reports; bounded paging; authentication/quota/timeout and malformed-response handling; empty and delayed data; partial failure; semantic-key idempotency; stale-row removal on replacement; duplicate detection; and readback mismatch. Query/page row sums must not stand in for GSC totals, and URL user rows must not be summed into a people count. Final review must verify existing Drive-state files and all workflows remain unchanged.

## Deferred live validation / Human Gate

The user must approve the next bounded live step before any authentication grant, API enablement, real-account connection, deployment, Sheet creation/write, or trigger operation. Preparation can be completed offline first.

The next gate needs the intended existing Google identity, one exact GSC site and its permission, one exact GA4 property and its permission/timezone, and dedicated new Dev Apps Script/Sheet destinations. Verify the requested minimal read scopes (`webmasters.readonly`, `analytics.readonly`) plus the necessary Sheets write and external-request scopes. Do not widen scopes automatically if access is denied.

After explicit approval, validate only the approved isolated Dev targets: API availability, exact target guards, metadata and timezone/finalization assumptions, report dimension/metric compatibility, bounded real responses, write/readback, and same-key rerun behavior. Record empirical observations separately from mock test evidence. Production deployment and recurring scheduling remain separately gated. No FTP mirror is needed for GAS source.
