import fs from 'node:fs';

const root = 'ai-automation/gas-drive-state';
const required = [
  `${root}/README.md`,
  `${root}/package.json`,
  `${root}/src/appsscript.json`,
  `${root}/src/Smoke.gs`,
  `${root}/src/Acceptance.gs`,
  `${root}/src/Collector.gs`,
  `${root}/src/CollectorAcceptance.gs`,
  `${root}/scripts/validate-deploy-target.mjs`,
  '.github/workflows/gas-dev-deploy.yml',
  '.github/workflows/gas-prod-deploy.yml.disabled'
];
for (const file of required) if (!fs.existsSync(file)) throw new Error(`missing required file: ${file}`);

JSON.parse(fs.readFileSync(`${root}/package.json`, 'utf8'));
const manifest = JSON.parse(fs.readFileSync(`${root}/src/appsscript.json`, 'utf8'));
const scopes = new Set(manifest.oauthScopes || []);
for (const requiredScope of ['https://www.googleapis.com/auth/drive.readonly','https://www.googleapis.com/auth/spreadsheets']) {
  if (!scopes.has(requiredScope)) throw new Error(`missing required OAuth scope: ${requiredScope}`);
}
const advanced = manifest?.dependencies?.enabledAdvancedServices || [];
if (!advanced.some(x => x.userSymbol === 'Drive' && x.serviceId === 'drive' && x.version === 'v3')) throw new Error('Drive v3 Advanced Service declaration missing');

const smoke = fs.readFileSync(`${root}/src/Smoke.gs`, 'utf8');
const acceptance = fs.readFileSync(`${root}/src/Acceptance.gs`, 'utf8');
const collector = fs.readFileSync(`${root}/src/Collector.gs`, 'utf8');
const collectorAcceptance = fs.readFileSync(`${root}/src/CollectorAcceptance.gs`, 'utf8');

if (!smoke.includes('HUMAN GATE REQUIRED') || !acceptance.includes('HUMAN GATE REQUIRED')) throw new Error('production trigger guard missing');
if (!acceptance.includes('runIntegratedAcceptanceTest')) throw new Error('integrated acceptance entrypoint missing');
if (!collector.includes('runBoundedTestCollectorV03')) throw new Error('v0.3 collector entrypoint missing');
if (!collectorAcceptance.includes('runCollectorV03Acceptance')) throw new Error('v0.3 acceptance entrypoint missing');

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
