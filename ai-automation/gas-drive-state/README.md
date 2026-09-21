# AI Automation — GAS Drive-state

Google Drive is the project authority. This repository is the technical source/deployment substrate for the bounded Drive-state collector.

## Current status — 2026-09-20

**Operational baseline: Dev verified; Production targets materialized but runtime remains inert.**

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
Production spreadsheet + standalone Apps Script target now exist under the same intended owner, but no Production source has been deployed and no trigger exists.
Do not enable the disabled Production workflow; current preferred path remains manual exact-target Production materialization with readback verification.

## Known targets

Dev Apps Script:
- script ID: `1Txo4FJmWuJtq76e2v3nLrcw2fv1MlMTHJZnFj_lSvhE_7AZVr4UjC2zs`

Dedicated TEST spreadsheet:
- ID: `1Lu7bqDpNtNsmZJsIGzah0T_mxABen6gEbqHqFZ7AKz0`

Current Production targets — materialized 2026-09-22, still inert:
- spreadsheet title: `AI Automation Drive-state v0.1`
- spreadsheet ID: `19t_taz3ss_HXRCOncPv1AXhQjjmCOwf0EPh1g9Q3wVY`
- Apps Script ID: `1r3y9O0_Du-QAoxKiJRP5nCSnLzrMo5IFTV3m1ex2KsvQCFNR5d0qoLBL`
- both owned by the same intended existing Google account
- no Production source deployed yet
- no Production run data or recurring trigger yet

Historical frozen Production observation spreadsheet:
- title: `FROZEN｜AI Automation Drive-state v0.1｜2026-09-20`
- ID: `1isIOjxGeJ-h0y_KvnWUqg-zzmK5cbvkLjaVJoon2ssU`
- retained as historical inert artifact; not the current Production target

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

Current Production boundary:
- exact Production targets are now materialized and pinned
- do not create Production clasp/GitHub credentials by default
- do not execute the Production collector yet
- do not create a recurring trigger yet
- do not broaden source scope
- Production source update requires exact-target preflight + immediate readback verification

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

## M2-A candidate — read-only Mechanical Layer

This branch adds a bounded read-only candidate only:
- public GitHub version marker fetch with no GitHub credential
- runtime-vs-canonical version status: MATCH / UPDATE_AVAILABLE / CHECK_FAILED
- exact Drive metadata reads only
- bounded composite Health Check return object

Authorization impact:
- adds Apps Script scope `script.external_request` for public GitHub fetches
- does not add Drive write scope
- does not add trigger-creation scope
- Dev deployment may therefore require Google reauthorization before execution

Still excluded:
- Drive create/copy/update/delete
- trigger creation
- automatic Apps Script source self-update
- Production deployment or scheduling


## M2-B candidate — trigger preflight + TEST-only contract

This branch adds a bounded scheduler candidate:
- authorization preflight for `script.scriptapp`
- exact inspection of the dedicated TEST handler only
- TEST-only hourly trigger create/verify/delete acceptance
- fail closed if a matching TEST trigger already exists
- exact cleanup by handler + trigger unique ID
- Production trigger installation remains hard-disabled behind a Human Gate

Authorization impact:
- adds Apps Script scope `https://www.googleapis.com/auth/script.scriptapp`
- this may require one additional Google authorization interaction in Dev
- no Drive write scope is added

Canonical version behavior:
- GitHub `main` is the canonical version source
- before merge, a newer Dev candidate should report `UPDATE_AVAILABLE`
- after merge + main redeploy, matching builds should report `MATCH`

Still excluded:
- Production trigger creation
- recurring Production scheduling
- Drive create/copy/update/delete
- automatic GAS source self-update


## M2-C candidate — bounded Drive create/copy

This branch tests the narrow write surface needed for mechanical Drive create/copy:
- adds `https://www.googleapis.com/auth/drive.file`
- keeps existing `drive.readonly`
- does not add full `https://www.googleapis.com/auth/drive`
- create/copy require exact inputs and immediate readback
- TEST acceptance creates one temporary Google Doc and copies the exact dedicated TEST spreadsheet
- cleanup uses reversible `trashed=true` only; permanent deletion is forbidden

Important scope question under test:
- `drive.file` is officially accepted by Drive API create/copy methods
- the Dev acceptance will verify whether the existing `drive.readonly + drive.file` combination is sufficient to copy the exact pre-existing TEST spreadsheet
- if that copy is denied, do not widen automatically to full Drive scope; reopen the scope/design decision

Still excluded:
- Production Drive mutation
- permanent deletion
- arbitrary folder traversal/search
- permission/sharing changes
- automatic GAS source self-update


### M2-C bounded write target
Dev acceptance is pinned to dedicated non-production folder:
- TEST｜GAS Mechanical M2-C Drive Write
- folder ID: `1F7DC2PbwGH02sm7Fo4YbqF8-2juK1wPc`

The acceptance creates/copies only into this folder, verifies exact IDs, then moves only the two artifacts created by that run to Trash. Trash cleanup is reversible; permanent delete remains forbidden.


## M2-D candidate — post-deploy Dev source drift verification

Goal:
- verify that GitHub source and the exact Dev Apps Script project are materially identical after every Dev deploy.

Implementation:
- reuse the existing development clasp credential and exact Dev script ID.
- after `clasp push`, create an isolated temporary clasp project pointing at the same exact script ID.
- `clasp pull` the Dev project into a temporary directory.
- compare all canonical GAS source files plus `appsscript.json`.
- normalize only line endings/final newline for source files and object-key order for manifest JSON.
- fail the deploy workflow if any source file differs, is missing, or an unexpected pulled file exists.
- remove temporary credential/project/readback files in the workflow cleanup step.

Why this shape:
- no new Google account or credential.
- no additional Apps Script UI operation.
- no Production access.
- no scheduler added.
- drift verification becomes part of the existing deploy contract instead of another human step.

Production remains unchanged.
