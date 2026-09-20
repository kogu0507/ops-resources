# AI Automation — GAS Drive-state CI/CD

Status: bootstrap candidate. This repository path is a technical delivery substrate; Google Drive remains the project authority.

## Target flow

ChatGPT -> GitHub branch/PR -> CI checks -> manual Dev deploy -> Dev verification -> Human Gate -> separately approved Prod deploy -> verification -> Drive checkpoint.

## Safety

- No Apps Script target ID or OAuth token is committed.
- Dev uses GitHub Environment `development`; Prod uses `production`.
- Dev and Prod use separate clasp credential/mapping secret names.
- Exact target identity is checked against an independently configured Environment variable before any `clasp push`.
- Clasp `rootDir` is fixed to `src`.
- Deploy preflight rejects files outside the explicit bootstrap push allowlist.
- Dev deploy is manual (`workflow_dispatch`).
- Prod deploy workflow remains `.disabled` until a later Human Gate.
- `clasp push` replaces the whole target project source, so exact-target verification precedes status/push.
- Rollback is a Git commit/ref redeploy to the same independently verified target, followed by verification/readback.

## Required one-time Dev setup

Create GitHub Environment `development` and configure:
- secret `CLASPRC_JSON_DEV`
- secret `CLASP_JSON_DEV` = exactly `{"scriptId":"<DEV_SCRIPT_ID>","rootDir":"src"}`
- variable `EXPECTED_DEV_SCRIPT_ID` = Dev Script ID entered independently from the mapping secret

The Dev credential must be a Dev-only credential profile. Production credentials are not created during bootstrap.

## Production isolation

Before enabling production:
- create/use a separate production deployment credential profile, preferably a separate Google deployment identity whose access is limited to the Prod Apps Script project;
- configure only Environment `production` with `CLASPRC_JSON_PROD`, `CLASP_JSON_PROD`, and `EXPECTED_PROD_SCRIPT_ID`;
- require the separate Production Human Gate;
- add post-push verification/readback before activation.

## Repository layout

- `src/` — only files eligible for Apps Script push during bootstrap.
- `src/appsscript.json` — manifest; clasp `rootDir` is fixed to `src`.
- `scripts/validate-deploy-target.mjs` — exact target/rootDir/push allowlist guard.
- `.github/workflows/gas-dev-deploy.yml` — manual Dev deploy using `development`.
- `.github/workflows/gas-prod-deploy.yml.disabled` — non-runnable Prod template using `production`.


## Dev implementation v0.3

The next bounded TEST iteration adds a real collector path, still pinned to the dedicated TEST spreadsheet.

Entrypoints:
- `runBoundedTestCollectorV03()` — reads enabled TEST `SOURCES`, collects bounded Drive/Sheet state, updates only Collector-owned `DRIVE_STATE` fields, and appends one `COLLECTION_RUNS` row.
- `runCollectorV03Acceptance()` — seeds bounded TEST sentinels, invokes the real collector, and verifies actual source failure freshness plus an actual MISSING transition after a complete bounded folder enumeration.

Supported v0.3 TEST source kinds:
- exact `FILE` metadata
- bounded `SHEET_RANGE`
- non-recursive `FOLDER_BOUNDED`
- synthetic ambiguous `REGISTRY` negative fixture only

Safety:
- write target is hard-pinned to TEST spreadsheet `1Lu7bqDpNtNsmZJsIGzah0T_mxABen6gEbqHqFZ7AKz0`
- no trigger creation
- no production Sheet writes
- exact Drive IDs / bounded ranges only
- source-local fail-closed behavior
- complete folder enumeration required before MISSING
- newer source failure forces UNKNOWN while retaining last-known facts
- Judge-owned fields are never included in Collector patch allowlist
- concurrent LockService overlap still requires a separate empirical two-invocation probe before production scheduling
