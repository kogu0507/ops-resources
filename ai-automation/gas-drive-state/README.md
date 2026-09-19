# AI Automation — GAS Drive-state CI/CD

Status: bootstrap candidate. This repository path is a technical delivery substrate; Google Drive remains the project authority.

## Target flow

ChatGPT -> GitHub branch/PR -> CI checks -> manual Dev deploy -> Dev verification -> Human Gate -> separately approved Prod deploy -> verification -> Drive checkpoint.

## Safety

- No production Apps Script ID or OAuth token is committed.
- `.clasprc.json` and clasp project mappings are supplied only as GitHub Secrets.
- Dev deploy is manual (`workflow_dispatch`) during bootstrap.
- Prod deploy workflow is stored disabled until a later Human Gate.
- Deployments use `clasp push`; they replace Apps Script project source, so target identity must be checked before enabling secrets.
- Rollback is a Git commit/ref redeploy, followed by readback/verification.

## Required one-time setup

1. Enable Apps Script API for the Google account used by clasp.
2. Create/choose a dedicated Dev Apps Script project.
3. Run `clasp login` once on a trusted local machine and capture `~/.clasprc.json`.
4. Add GitHub Actions secrets:
   - `CLASPRC_JSON`: contents of `~/.clasprc.json`
   - `CLASP_JSON_DEV`: JSON containing the exact Dev `scriptId` and `rootDir`.
5. Run the Dev deployment workflow manually and verify the exact target.
6. Prod credentials/mapping remain unset until Human Gate.

## Repository layout

- `src/` — Apps Script source.
- `appsscript.json` — manifest.
- `.github/workflows/gas-dev-deploy.yml` — manual Dev deploy.
- `.github/workflows/gas-prod-deploy.yml.disabled` — non-runnable production template.
- `.claspignore` — deploy allowlist boundary.
