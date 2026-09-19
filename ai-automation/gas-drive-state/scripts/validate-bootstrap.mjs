import fs from 'node:fs';

const root = 'ai-automation/gas-drive-state';
const required = [
  `${root}/README.md`,
  `${root}/package.json`,
  `${root}/appsscript.json`,
  `${root}/src/Smoke.gs`,
  `${root}/src/Acceptance.gs`,
  '.github/workflows/gas-dev-deploy.yml',
  '.github/workflows/gas-prod-deploy.yml.disabled'
];

for (const file of required) {
  if (!fs.existsSync(file)) throw new Error(`missing required file: ${file}`);
}

JSON.parse(fs.readFileSync(`${root}/package.json`, 'utf8'));
const manifest = JSON.parse(fs.readFileSync(`${root}/appsscript.json`, 'utf8'));

const scopes = new Set(manifest.oauthScopes || []);
for (const requiredScope of [
  'https://www.googleapis.com/auth/drive.readonly',
  'https://www.googleapis.com/auth/spreadsheets'
]) {
  if (!scopes.has(requiredScope)) throw new Error(`missing required OAuth scope: ${requiredScope}`);
}

const advanced = manifest?.dependencies?.enabledAdvancedServices || [];
if (!advanced.some(x => x.userSymbol === 'Drive' && x.serviceId === 'drive' && x.version === 'v3')) {
  throw new Error('Drive v3 Advanced Service declaration missing');
}

const smoke = fs.readFileSync(`${root}/src/Smoke.gs`, 'utf8');
const acceptance = fs.readFileSync(`${root}/src/Acceptance.gs`, 'utf8');
if (!smoke.includes('HUMAN GATE REQUIRED') || !acceptance.includes('HUMAN GATE REQUIRED')) {
  throw new Error('production trigger guard missing');
}
if (!acceptance.includes('runIntegratedAcceptanceTest')) {
  throw new Error('integrated acceptance entrypoint missing');
}

if (fs.existsSync('.github/workflows/gas-prod-deploy.yml')) {
  throw new Error('production deploy workflow must remain disabled during bootstrap');
}

const trackedSensitive = [
  `${root}/.clasprc.json`,
  `${root}/.clasp.json`,
  `${root}/.clasp.dev.json`,
  `${root}/.clasp.prod.json`
];
for (const file of trackedSensitive) {
  if (fs.existsSync(file)) throw new Error(`sensitive clasp config must not be committed: ${file}`);
}

console.log('bootstrap validation PASS');
