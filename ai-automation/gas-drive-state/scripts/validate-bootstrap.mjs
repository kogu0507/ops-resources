import fs from 'node:fs';
import vm from 'node:vm';

const root = 'ai-automation/gas-drive-state';
const required = [
  `${root}/README.md`,
  `${root}/package.json`,
  `${root}/src/appsscript.json`,
  `${root}/src/Smoke.gs`,
  `${root}/src/Acceptance.gs`,
  `${root}/src/Collector.gs`,
  `${root}/src/CollectorAcceptance.gs`,
  `${root}/src/LockProbe.gs`,
  `${root}/src/MechanicalHealth.gs`,
  `${root}/version.json`,
  `${root}/scripts/validate-deploy-target.mjs`,
  '.github/workflows/gas-dev-deploy.yml',
  '.github/workflows/gas-prod-deploy.yml.disabled'
];
for (const file of required) if (!fs.existsSync(file)) throw new Error(`missing required file: ${file}`);

JSON.parse(fs.readFileSync(`${root}/package.json`, 'utf8'));
const manifest = JSON.parse(fs.readFileSync(`${root}/src/appsscript.json`, 'utf8'));
const scopes = new Set(manifest.oauthScopes || []);
for (const requiredScope of ['https://www.googleapis.com/auth/drive.readonly','https://www.googleapis.com/auth/spreadsheets','https://www.googleapis.com/auth/script.external_request']) {
  if (!scopes.has(requiredScope)) throw new Error(`missing required OAuth scope: ${requiredScope}`);
}
const advanced = manifest?.dependencies?.enabledAdvancedServices || [];
if (!advanced.some(x => x.userSymbol === 'Drive' && x.serviceId === 'drive' && x.version === 'v3')) throw new Error('Drive v3 Advanced Service declaration missing');
if (!advanced.some(x => x.userSymbol === 'Sheets' && x.serviceId === 'sheets' && x.version === 'v4')) throw new Error('Sheets v4 Advanced Service declaration missing');

const smoke = fs.readFileSync(`${root}/src/Smoke.gs`, 'utf8');
const acceptance = fs.readFileSync(`${root}/src/Acceptance.gs`, 'utf8');
const collector = fs.readFileSync(`${root}/src/Collector.gs`, 'utf8');
const collectorAcceptance = fs.readFileSync(`${root}/src/CollectorAcceptance.gs`, 'utf8');
const lockProbe = fs.readFileSync(`${root}/src/LockProbe.gs`, 'utf8');
const mechanicalHealth = fs.readFileSync(`${root}/src/MechanicalHealth.gs`, 'utf8');
const mechanicalVersion = JSON.parse(fs.readFileSync(`${root}/version.json`, 'utf8'));

for (const [name, source] of [
  ['Smoke.gs', smoke],
  ['Acceptance.gs', acceptance],
  ['Collector.gs', collector],
  ['CollectorAcceptance.gs', collectorAcceptance],
  ['LockProbe.gs', lockProbe],
  ['MechanicalHealth.gs', mechanicalHealth]
]) {
  new vm.Script(source, {filename:name});
}

if (!smoke.includes('HUMAN GATE REQUIRED') || !acceptance.includes('HUMAN GATE REQUIRED')) throw new Error('production trigger guard missing');
if (!acceptance.includes('runIntegratedAcceptanceTest')) throw new Error('integrated acceptance entrypoint missing');
if (!collector.includes('runBoundedTestCollectorV03')) throw new Error('v0.3 collector entrypoint missing');
if (!collectorAcceptance.includes('runCollectorV03Acceptance')) throw new Error('v0.3 acceptance entrypoint missing');
if (!lockProbe.includes('holdCollectorLockForOverlapProbe')) throw new Error('lock holder probe entrypoint missing');
if (!lockProbe.includes('runCollectorLockContenderProbe')) throw new Error('lock contender probe entrypoint missing');
if (!lockProbe.includes("run_status !== 'SKIPPED'") || !lockProbe.includes("reason !== 'LOCK_HELD'")) throw new Error('lock contender assertion missing');
if (!mechanicalHealth.includes('checkMechanicalCanonicalVersion')) throw new Error('M2-A version check entrypoint missing');
if (!mechanicalHealth.includes('readExactDriveMetadata')) throw new Error('M2-A exact Drive read entrypoint missing');
if (!mechanicalHealth.includes('runMechanicalHealthCheck')) throw new Error('M2-A health entrypoint missing');
if (!mechanicalHealth.includes("status: 'MATCH'") && !mechanicalHealth.includes("'MATCH' : 'UPDATE_AVAILABLE'")) throw new Error('M2-A version status contract missing');
if (/ScriptApp\.newTrigger|Drive\.Files\.(create|copy|update|delete|remove)/.test(mechanicalHealth)) throw new Error('M2-A source must remain read-only and trigger-free');
const versionMatch = mechanicalHealth.match(/version:\s*'([^']+)'/);
if (!versionMatch || mechanicalVersion.version !== versionMatch[1]) throw new Error('M2-A runtime/version.json mismatch');
if (/ScriptApp\.newTrigger|\.create\(\)/.test(lockProbe)) throw new Error('trigger creation forbidden in lock probe');
if (!collector.includes('v03FailureTargets_')) throw new Error('source-wide failure freshness guard missing');
if (!collector.includes('Sheets.Spreadsheets.batchUpdate')) throw new Error('run-level atomic Sheets batchUpdate missing');
if (!collector.includes('NOT_FOUND_OR_INACCESSIBLE')) throw new Error('ambiguous Drive 404/access-loss guard missing');
if (/v03LooksNotFound_/.test(collector)) throw new Error('unsafe 404-to-MISSING helper must not exist');
if (!collectorAcceptance.includes('V03_SENTINEL_CLASS')) throw new Error('acceptance must seed its own Judge sentinel');
if (!collectorAcceptance.includes('finally')) throw new Error('acceptance cleanup/finally missing');
if (!collectorAcceptance.includes('v03TestDeleteRowsByStateKey_')) throw new Error('acceptance sentinel cleanup helper missing');
if (!collectorAcceptance.includes('Sheets.Spreadsheets.Values.get')) throw new Error('acceptance fresh Sheets API readback missing');
if (!collectorAcceptance.includes('post-commit assertions used fresh Advanced Sheets API readback')) throw new Error('fresh-read acceptance evidence log missing');

const requiredTestId = '1Lu7bqDpNtNsmZJsIGzah0T_mxABen6gEbqHqFZ7AKz0';
if (!collector.includes(requiredTestId)) throw new Error('collector must remain pinned to dedicated TEST spreadsheet');
if (/ScriptApp\.newTrigger|\.create\(\)/.test(collector + collectorAcceptance)) throw new Error('trigger creation forbidden in TEST collector source');

if (fs.existsSync(`${root}/appsscript.json`)) throw new Error('manifest must exist only under fixed rootDir src/');
if (fs.existsSync('.github/workflows/gas-prod-deploy.yml')) throw new Error('production deploy workflow must remain disabled during bootstrap');

const devWorkflow = fs.readFileSync('.github/workflows/gas-dev-deploy.yml','utf8');
if (!devWorkflow.includes('environment: development')) throw new Error('development Environment boundary missing');
if (!devWorkflow.includes('CLASPRC_JSON_DEV')) throw new Error('Dev-specific credential secret missing');
if (!devWorkflow.includes('EXPECTED_DEV_SCRIPT_ID')) throw new Error('independent Dev target variable missing');
if (!devWorkflow.includes('validate-deploy-target.mjs')) throw new Error('Dev exact-target preflight missing');

const prodWorkflow = fs.readFileSync('.github/workflows/gas-prod-deploy.yml.disabled','utf8');
if (!prodWorkflow.includes('environment: production')) throw new Error('production Environment boundary missing');
if (!prodWorkflow.includes('CLASPRC_JSON_PROD')) throw new Error('Prod-specific credential secret missing');
if (!prodWorkflow.includes('EXPECTED_PROD_SCRIPT_ID')) throw new Error('independent Prod target variable missing');

for (const file of [`${root}/.clasprc.json`,`${root}/.clasp.json`,`${root}/.clasp.dev.json`,`${root}/.clasp.prod.json`]) {
  if (fs.existsSync(file)) throw new Error(`sensitive clasp config must not be committed: ${file}`);
}
console.log('bootstrap validation PASS');
