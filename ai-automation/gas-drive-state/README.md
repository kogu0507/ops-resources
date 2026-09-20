# AI Automation — GAS Drive-state

Google Drive is the project authority. This repository is the technical source/deployment substrate for the bounded Drive-state collector.

## Current status — 2026-09-20

**Operational baseline: Dev-only, verified, Production frozen.**

Verified Dev path:
- GitHub main -> manual GitHub Actions -> clasp -> exact Dev Apps Script target
- bounded collector v0.3
- SOURCES -> DRIVE_STATE -> COLLECTION_RUNS
- run-level Sheets batchUpdate commit
- fresh post-commit readback
- fail-closed source failure / UNKNOWN handling
- complete bounded enumeration before MISSING
- Collector/Judge field ownership separation
- empirical two-invocation ScriptLock overlap: contender returns SKIPPED / LOCK_HELD and performs no run write

No Production collector is running.
No recurring Drive-state trigger exists.
Do not enable the disabled Production workflow without a new explicit Human Gate.

## Known targets

Dev Apps Script:
- script ID: `1Txo4FJmWuJtq76e2v3nLrcw2fv1MlMTHJZnFj_lSvhE_7AZVr4UjC2zs`

Dedicated TEST spreadsheet:
- ID: `1Lu7bqDpNtNsmZJsIGzah0T_mxABen6gEbqHqFZ7AKz0`

Frozen, never-run Production observation spreadsheet:
- title: `FROZEN｜AI Automation Drive-state v0.1｜2026-09-20`
- ID: `1isIOjxGeJ-h0y_KvnWUqg-zzmK5cbvkLjaVJoon2ssU`
- contains schema + four configured SOURCES only
- DRIVE_STATE / COLLECTION_RUNS contain no Production run data
- must remain inert until explicit resume

## Repository layout

- `src/Collector.gs` — bounded Dev collector implementation
- `src/CollectorAcceptance.gs` — Dev acceptance harness
- `src/LockProbe.gs` — retained empirical overlap probe; not a scheduled runtime component
- `src/Acceptance.gs` / `src/Smoke.gs` — bootstrap/contract verification helpers
- `src/appsscript.json` — Apps Script manifest
- `scripts/validate-deploy-target.mjs` — exact target/rootDir/push allowlist guard
- `.github/workflows/gas-dev-deploy.yml` — manual Dev deploy
- `.github/workflows/gas-prod-deploy.yml.disabled` — inert historical Production template; not approved for activation

The source tree is intentionally not reorganized further during closeout. The verified Dev build is more valuable than cosmetic restructuring.

## Dev deployment contract

GitHub Environment `development` supplies:
- secret `CLASPRC_JSON_DEV`
- secret `CLASP_JSON_DEV`
- variable `EXPECTED_DEV_SCRIPT_ID`

Deployment fails closed if the clasp mapping target differs from the independently configured expected script ID.

Dev deploy remains manual via `workflow_dispatch`.

## Production freeze

The earlier Production Pilot P0-A path was frozen after a late prerequisite discovery around credential/account topology.

Freeze means:
- do not create a Production Apps Script project
- do not create Production clasp/GitHub credentials
- do not run the frozen Production spreadsheet
- do not create a recurring trigger
- do not broaden source scope

The frozen spreadsheet is preserved only as an inert artifact so the interrupted work is explicit rather than ambiguous.

## No-new-account operating direction

If this work is resumed, the preferred option to evaluate first is **same Google owner account + separate Prod Apps Script target + no unattended GitHub Production credential**.

That means:
- keep Dev and Prod Apps Script projects separate
- use the existing Google account as the runtime owner for both
- keep GitHub Actions for Dev only
- perform infrequent Production code deployment manually from the existing authenticated local/browser context after Human Gate
- keep exact Prod script/spreadsheet IDs pinned and verify them before any manual deployment
- enable any recurring Production trigger only under a later separate Human Gate

Why this is the leading no-new-account option:
- no new Google account
- no long-lived Production OAuth credential stored in GitHub
- Dev/Prod runtime targets remain separate
- deployment is less automated, but Production code changes are expected to be infrequent
- the main residual risk is that the same Google identity owns both environments; target-ID guards reduce accidental cross-target deployment but do not create identity-level blast-radius isolation

Alternative to evaluate only if manual Production deployment becomes too burdensome:
- same Google account + separate GitHub `production` Environment/secret/mapping/expected target
- this restores automated/manual-dispatch CI deployment but has a broader credential blast radius because one Google identity can access multiple Apps Script projects

Do **not** default back to “smallest pilot first.” On resume, compare:
1. smallest pilot,
2. bounded direct-to-useful implementation,
3. reuse/extension of existing infrastructure,

against user time budget, human-step budget, account/credential constraints, urgency, rollback cost, and failure impact.

## Resume prerequisite

Before any Production materialization or Human Gate, perform one end-to-end prerequisite audit covering:
- accounts and deployment identities
- credentials and where they are stored
- ownership/permissions
- billing/auth requirements
- UI-only human steps
- external limits
- rollback and decommission path
- expected number of Human Gates and manual actions

No implementation should begin if an unavoidable prerequisite is still likely to surface later.
