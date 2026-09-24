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
  `${root}/src/TriggerPreflight.gs`,
  `${root}/src/DriveMutation.gs`,
  `${root}/src/DirectoryContract.gs`,
  `${root}/src/DevCommandRunner.gs`,
  `${root}/version.json`,
  `${root}/scripts/validate-deploy-target.mjs`,
  `${root}/scripts/prepare-drift-project.mjs`,
  `${root}/scripts/compare-gas-source.mjs`,
  '.github/workflows/gas-dev-deploy.yml',
  '.github/workflows/gas-prod-deploy.yml.disabled'
];
for (const file of required) if (!fs.existsSync(file)) throw new Error(`missing required file: ${file}`);

JSON.parse(fs.readFileSync(`${root}/package.json`, 'utf8'));
const manifest = JSON.parse(fs.readFileSync(`${root}/src/appsscript.json`, 'utf8'));
const scopes = new Set(manifest.oauthScopes || []);
for (const requiredScope of ['https://www.googleapis.com/auth/drive.readonly','https://www.googleapis.com/auth/drive.file','https://www.googleapis.com/auth/spreadsheets','https://www.googleapis.com/auth/script.external_request','https://www.googleapis.com/auth/script.scriptapp']) {
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
const triggerPreflight = fs.readFileSync(`${root}/src/TriggerPreflight.gs`, 'utf8');
const driveMutation = fs.readFileSync(`${root}/src/DriveMutation.gs`, 'utf8');
const directoryContract = fs.readFileSync(`${root}/src/DirectoryContract.gs`, 'utf8');
const devCommandRunner = fs.readFileSync(`${root}/src/DevCommandRunner.gs`, 'utf8');
const mechanicalVersion = JSON.parse(fs.readFileSync(`${root}/version.json`, 'utf8'));

for (const [name, source] of [
  ['Smoke.gs', smoke],
  ['Acceptance.gs', acceptance],
  ['Collector.gs', collector],
  ['CollectorAcceptance.gs', collectorAcceptance],
  ['LockProbe.gs', lockProbe],
  ['MechanicalHealth.gs', mechanicalHealth],
  ['TriggerPreflight.gs', triggerPreflight],
  ['DriveMutation.gs', driveMutation],
  ['DirectoryContract.gs', directoryContract],
  ['DevCommandRunner.gs', devCommandRunner]
]) {
  new vm.Script(source, {filename:name});
}

if (!smoke.includes('HUMAN GATE REQUIRED') || !acceptance.includes('HUMAN GATE REQUIRED')) throw new Error('production trigger guard missing');
if (!acceptance.includes('runIntegratedAcceptanceTest')) throw new Error('integrated acceptance entrypoint missing');
if (!collector.includes('runBoundedTestCollectorV03')) throw new Error('TEST collector entrypoint missing');
if (!collector.includes('runBoundedProductionCollectorV03')) throw new Error('Production collector entrypoint missing');
if (!collector.includes('requireDevRuntimeForTestMutation_')) throw new Error('shared Dev-only TEST mutation guard missing');
if (!collector.includes('RUNTIME_TARGET_MISMATCH')) throw new Error('exact runtime target mismatch guard missing');
if (!collector.includes('1Txo4FJmWuJtq76e2v3nLrcw2fv1MlMTHJZnFj_lSvhE_7AZVr4UjC2zs')) throw new Error('approved Dev script ID binding missing');
if (!collector.includes('1r3y9O0_Du-QAoxKiJRP5nCSnLzrMo5IFTV3m1ex2KsvQCFNR5d0qoLBL')) throw new Error('approved Prod script ID binding missing');
if (!collector.includes('19t_taz3ss_HXRCOncPv1AXhQjjmCOwf0EPh1g9Q3wVY')) throw new Error('approved Prod spreadsheet ID binding missing');
if (!collectorAcceptance.includes('runCollectorV03Acceptance')) throw new Error('v0.3 acceptance entrypoint missing');
if (!collector.includes('OPERATIONS_BOARD_STRUCTURAL_HEALTH_V1')) throw new Error('Board structural-health selector missing');
if (!collector.includes('1NrhZCPLXOK4TKZqKBg3YEmYl1D7Qtgfx')) throw new Error('Board parser must remain pinned to exact OPERATIONS-BOARD file ID');
if (!collector.includes('OPERATIONS_BOARD_MAX_BYTES: 262144')) throw new Error('Board byte bound missing');
if (!collector.includes('OPERATIONS_BOARD_MAX_ROWS: 200')) throw new Error('Board row bound missing');
if (!collector.includes('OPERATIONS_BOARD_MAX_ELIGIBLE_ROWS: 20')) throw new Error('Board eligible-row bound missing');
if (!collector.includes("kind === 'FILE' && mode === 'BOUNDED_CONTENT'")) throw new Error('FILE BOUNDED_CONTENT dispatch missing');
if (!collector.includes('v03ParseOperationsBoardHealth_')) throw new Error('Board structural-health parser missing');
if (!collector.includes('DriveApp.getFileById')) throw new Error('Board exact content read path missing');
if (!collectorAcceptance.includes('runOperationsBoardHealthDevReadAcceptance')) throw new Error('Board exact-read Dev acceptance entrypoint missing');
if (!collectorAcceptance.includes('runOperationsBoardUnchangedHealthDedupAcceptance')) throw new Error('Board unchanged-health dedup acceptance entrypoint missing');
if (collector.includes('missing_fields:parsed.missingFields')) throw new Error('Board health must not fail on non-identity field blanks');


{
  const context = {console};
  vm.createContext(context);
  new vm.Script(collector, {filename:'Collector.gs'}).runInContext(context);
  const parse = context.v03ParseOperationsBoardHealth_;
  if (typeof parse !== 'function') throw new Error('Board parser not callable in machine validation');

  const clean = [
    '| ID | 優先 | 状態 | 実行 | タスク |',
    '|---|---|---|---|---|',
    '| O-001 | P1 | READY | AI単独 | clean |',
    '| O-002 | P2 | WATCH | 一緒に判断 | escaped \\| pipe |'
  ].join('\n');
  const cleanResult = parse(clean, {maxRows:10});
  if (!cleanResult.healthy || cleanResult.eligibleRowCount !== 2) throw new Error('Board parser clean fixture failed');

  const duplicate = [
    '| ID | 優先 | 状態 | 実行 | タスク |',
    '|---|---|---|---|---|',
    '| O-050 | P2 | READY | AI単独 | a |',
    '| O-051 | P2 | READY | AI単独 | b |',
    '| O-050 | P1 | WATCH | 一緒に判断 | c |',
    '| O-051 | P2 | READY | AI単独 | d |'
  ].join('\n');
  const dupResult = parse(duplicate, {maxRows:10});
  if (dupResult.healthy) throw new Error('Board parser duplicate fixture must fail health');
  if (JSON.stringify(dupResult.duplicateIds) !== JSON.stringify(['O-050','O-051'])) {
    throw new Error('Board parser duplicate fixture did not report exact IDs');
  }

  const nonIdentityBlank = [
    '| ID | 優先 | 状態 | 実行 | タスク |',
    '|---|---|---|---|---|',
    '| O-777 |  | READY |  |  |'
  ].join('\n');
  const nonIdentityBlankResult = parse(nonIdentityBlank, {maxRows:10});
  if (!nonIdentityBlankResult.healthy) {
    throw new Error('Board health must remain identity-focused when non-identity cells are blank');
  }

  const missing = [
    '| ID | 優先 | 状態 | 実行 | タスク |',
    '|---|---|---|---|---|',
    '|  | P1 | READY | AI単独 | missing |'
  ].join('\n');
  const missingResult = parse(missing, {maxRows:10});
  if (missingResult.healthy || !missingResult.invalidRows.some(x => x.reason === 'MISSING_ID')) {
    throw new Error('Board parser missing-ID fixture failed');
  }

  let rowBoundClosed = false;
  try {
    parse(duplicate, {maxRows:2});
  } catch (e) {
    rowBoundClosed = Boolean(e && e.v03code === 'BOARD_ROW_LIMIT');
  }
  if (!rowBoundClosed) throw new Error('Board parser row bound did not fail closed');


}

if (!lockProbe.includes('holdCollectorLockForOverlapProbe')) throw new Error('lock holder probe entrypoint missing');
if (!lockProbe.includes('runCollectorLockContenderProbe')) throw new Error('lock contender probe entrypoint missing');
if (!lockProbe.includes("run_status !== 'SKIPPED'") || !lockProbe.includes("reason !== 'LOCK_HELD'")) throw new Error('lock contender assertion missing');
if (!mechanicalHealth.includes('checkMechanicalCanonicalVersion')) throw new Error('M2-A version check entrypoint missing');
if (!mechanicalHealth.includes('readExactDriveMetadata')) throw new Error('M2-A exact Drive read entrypoint missing');
if (!mechanicalHealth.includes('runMechanicalHealthCheck')) throw new Error('M2-A health entrypoint missing');
if (!mechanicalHealth.includes('runMechanicalM2AAcceptance')) throw new Error('M2-A consolidated acceptance entrypoint missing');
if (!mechanicalHealth.includes('raw.githubusercontent.com/kogu0507/ops-resources/main/ai-automation/gas-drive-state/version.json')) throw new Error('Mechanical canonical version URL must point to main');
if (!mechanicalHealth.includes("status: 'MATCH'") && !mechanicalHealth.includes("'MATCH' : 'UPDATE_AVAILABLE'")) throw new Error('M2-A version status contract missing');
if (/ScriptApp\.newTrigger|Drive\.Files\.(create|copy|update|delete|remove)/.test(mechanicalHealth)) throw new Error('MechanicalHealth source must remain Drive-read-only and trigger-free');
if (!triggerPreflight.includes('getMechanicalTriggerAuthorizationPreflight')) throw new Error('M2-B authorization preflight missing');
if (!triggerPreflight.includes('runMechanicalM2BTriggerAcceptance')) throw new Error('M2-B TEST trigger acceptance missing');
if (!triggerPreflight.includes("everyHours(1)")) throw new Error('M2-B TEST trigger cadence must remain hourly');
if (!triggerPreflight.includes('cadenceHours: 1')) throw new Error('Production trigger cadence must remain hourly');
if (!triggerPreflight.includes('ScriptApp.deleteTrigger')) throw new Error('M2-B TEST trigger cleanup missing');
if (!triggerPreflight.includes('requireProductionRuntimeForTriggerMutation_')) throw new Error('Production trigger exact-project guard missing');
if (!triggerPreflight.includes('getProductionCollectorTriggerPreflight')) throw new Error('Production trigger preflight missing');
if (!triggerPreflight.includes('installProductionCollectorHourlyTrigger')) throw new Error('Production trigger installer missing');
if (!triggerPreflight.includes('removeProductionCollectorHourlyTrigger')) throw new Error('Production no-arg trigger removal entrypoint missing');
if (!triggerPreflight.includes('removeProductionCollectorTriggerById')) throw new Error('Production exact-ID trigger removal helper missing');
if (!triggerPreflight.includes("handler: 'runScheduledProductionCollectorV03'")) throw new Error('Production trigger handler must be exact collector entrypoint');
if (!triggerPreflight.includes('BLOCKED_EXISTING_PRODUCTION_TRIGGER')) throw new Error('Production duplicate-trigger fail-close missing');
if (!triggerPreflight.includes('BLOCKED_UNEXPECTED_PROJECT_TRIGGER')) throw new Error('Production unexpected-trigger fail-close missing');
if (!triggerPreflight.includes('PRODUCTION_TRIGGER_CREATE_VERIFY_FAILED')) throw new Error('Production trigger post-create verification missing');
if (!triggerPreflight.includes('PRODUCTION_TRIGGER_IDENTITY_MISMATCH')) throw new Error('Production trigger exact-ID removal guard missing');
if (/Drive\.Files\.(create|copy|update|delete|remove)/.test(triggerPreflight)) throw new Error('M2-B trigger source must not mutate Drive');
if (!directoryContract.includes('runDirectoryContractFixtureAcceptance')) throw new Error('directory contract fixture acceptance missing');
if (!directoryContract.includes('runDirectoryContractDevProbe')) throw new Error('directory contract Dev probe missing');
if (!directoryContract.includes("mode:'DETECT_ONLY'")) throw new Error('directory contract PoC must remain DETECT_ONLY');

if (!devCommandRunner.includes('1ugAXhNMvEcZ89V0QCb3iEfxevxwUMmZhzF3WKN2CPmY')) throw new Error('Dev command runner exact Sheet ID missing');
if (!devCommandRunner.includes("sheetName: 'COMMANDS'")) throw new Error('Dev command runner exact sheet name missing');
if (!devCommandRunner.includes("handler: 'runDevCommandQueueTick'")) throw new Error('Dev command runner handler binding missing');
if (!devCommandRunner.includes('cadenceMinutes: 5')) throw new Error('Dev command runner cadence contract missing');
if (!devCommandRunner.includes('staleClaimMinutes: 30')) throw new Error('Dev command runner stale-claim bound missing');
for (const entrypoint of ['getDevCommandRunnerPreflight','installDevCommandRunnerTrigger','removeDevCommandRunnerTrigger','runDevCommandQueueTick']) {
  const marker = `function ${entrypoint}()`;
  const start = devCommandRunner.indexOf(marker);
  if (start < 0) throw new Error(`Dev command runner entrypoint missing: ${entrypoint}`);
  const body = devCommandRunner.slice(start, start + 500);
  if (!body.includes('requireDevRuntimeForTestMutation_();')) throw new Error(`Dev runtime guard missing at entrypoint: ${entrypoint}`);
}
for (const action of ['CI_CD_SMOKE','COLLECTOR_V03_ACCEPTANCE','OPERATIONS_BOARD_HEALTH_READ_ACCEPTANCE','OPERATIONS_BOARD_UNCHANGED_DEDUP_ACCEPTANCE']) {
  if (!devCommandRunner.includes(`case '${action}'`)) throw new Error(`Dev command allowlist action missing: ${action}`);
}
if (!devCommandRunner.includes("throw new Error('DEV_COMMAND_ACTION_NOT_ALLOWED: ' + action)")) throw new Error('Dev command allowlist default deny missing');
if (!devCommandRunner.includes("reason: 'DUPLICATE_COMMAND_ID'")) throw new Error('Dev command duplicate-ID fail-close missing');
if (!devCommandRunner.includes("error: 'STALE_CLAIM_UNKNOWN_OUTCOME'")) throw new Error('Dev command stale-claim terminal evidence missing');
if (!devCommandRunner.includes("retry: 'FORBIDDEN_AUTOMATICALLY'")) throw new Error('Dev command stale-claim blind-retry prohibition missing');
if (!devCommandRunner.includes("reason: 'IN_FLIGHT_CLAIM'")) throw new Error('Dev command in-flight claim gate missing');
if (!devCommandRunner.includes("if (!lock.tryLock(1000))")) throw new Error('Dev command overlap lock missing');
if (!devCommandRunner.includes("if (String(row[3] || '').trim() === 'READY')")) throw new Error('Dev command READY selector missing');
if (/runBoundedProductionCollectorV03|runScheduledProductionCollectorV03|installProductionCollectorHourlyTrigger/.test(devCommandRunner)) throw new Error('Dev command runner must not expose Production action');

{
  const context = {console};
  vm.createContext(context);
  new vm.Script(devCommandRunner, {filename:'DevCommandRunner.gs'}).runInContext(context);
  const findDuplicates = context.devCommandFindDuplicateIds_;
  const inspectClaims = context.devCommandInspectClaims_;
  if (typeof findDuplicates !== 'function' || typeof inspectClaims !== 'function') {
    throw new Error('Dev command pure validation helpers not callable');
  }
  const dupRows = [
    ['CMD-1','CI_CD_SMOKE','','READY'],
    ['CMD-1','CI_CD_SMOKE','','DONE']
  ];
  if (JSON.stringify(findDuplicates(dupRows)) !== JSON.stringify(['CMD-1'])) throw new Error('Dev command duplicate-ID fixture failed');
  if (findDuplicates([['CMD-1'],['CMD-2']]).length !== 0) throw new Error('Dev command unique-ID fixture failed');
  const now = new Date('2026-09-24T00:30:00Z');
  const stale = inspectClaims([['CMD-1','','','CLAIMED','2026-09-23T23:00:00Z']], now, 30);
  if (!stale.stale || stale.inFlight) throw new Error('Dev command stale-claim fixture failed');
  const active = inspectClaims([['CMD-1','','','CLAIMED','2026-09-24T00:20:00Z']], now, 30);
  if (active.stale || !active.inFlight) throw new Error('Dev command in-flight claim fixture failed');
}

if (!directoryContract.includes('requireDevRuntimeForTestMutation_();')) throw new Error('directory contract probe must remain Dev-guarded');
if (/Drive\\.Files\\.(create|copy|update|delete|remove)|DriveApp\\.(create|move|setTrashed)/.test(directoryContract)) throw new Error('directory contract PoC must remain Drive-read-only');

{
  const context = {console};
  vm.createContext(context);
  new vm.Script(directoryContract, {filename:'DirectoryContract.gs'}).runInContext(context);
  const evaluate = context.evaluateDirectoryContractSnapshot_;
  if (typeof evaluate !== 'function') throw new Error('directory contract evaluator not callable');
  const result = evaluate([{id:'1',name:'README.md',mimeType:'text/markdown',trashed:false}], {allowedMimeTypes:['text/markdown'],allowedExtensions:['.md'],requiredNames:['README.md']});
  if (!result.healthy) throw new Error('directory contract clean machine fixture failed');
  const bad = evaluate([{id:'1',name:'x.txt',mimeType:'text/plain',trashed:false}], {allowedMimeTypes:['text/markdown'],allowedExtensions:['.md'],requiredNames:['README.md']});
  if (bad.healthy || !bad.violations.some(x => x.code === 'MIME_NOT_ALLOWED') || !bad.violations.some(x => x.code === 'REQUIRED_FILE_MISSING')) throw new Error('directory contract negative machine fixture failed');
}

if (!driveMutation.includes('createMechanicalDriveFile')) throw new Error('M2-C create primitive missing');
if (!driveMutation.includes('copyMechanicalDriveFile')) throw new Error('M2-C copy primitive missing');
if (!driveMutation.includes('runMechanicalM2CAcceptance')) throw new Error('M2-C acceptance missing');
if (!driveMutation.includes('getMechanicalM2CWriteAuthorizationPreflight')) throw new Error('M2-C authorization/target preflight missing');
if (!driveMutation.includes('1F7DC2PbwGH02sm7Fo4YbqF8-2juK1wPc')) throw new Error('M2-C must remain pinned to dedicated TEST write folder');
if (!driveMutation.includes("cleanupMode: 'TRASH_ONLY_REVERSIBLE'")) throw new Error('M2-C cleanup must remain reversible trash-only');
if (!driveMutation.includes('https://www.googleapis.com/auth/drive.file')) throw new Error('M2-C must document drive.file scope');
if (/Drive\.Files\.(remove|delete)\s*\(/.test(driveMutation)) throw new Error('M2-C permanent deletion forbidden');
if (!/Drive\.Files\.update\([\s\S]*?\{trashed:\s*true\}/.test(driveMutation)) throw new Error('M2-C reversible trash cleanup missing');
if (!driveMutation.includes('createdFileId') || !driveMutation.includes('copiedFileId')) throw new Error('M2-C must preserve created artifact IDs for cleanup even when readback fails');
if (!driveMutation.includes("event: 'M2C_CREATED_ARTIFACT'") || !driveMutation.includes("event: 'M2C_COPIED_ARTIFACT'")) throw new Error('M2-C must log exact TEST artifact IDs before cleanup');
if (!/Drive\.Files\.update\([\s\S]*?null,[\s\S]*?fields:\s*'id,trashed'/.test(driveMutation)) throw new Error('M2-C Drive v3 trash update must pass null mediaData before optionalArgs');
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

for (const [name, source, entrypoint] of [
  ['Acceptance.gs', acceptance, 'runIntegratedAcceptanceTest'],
  ['CollectorAcceptance.gs', collectorAcceptance, 'runCollectorV03Acceptance'],
  ['TriggerPreflight.gs', triggerPreflight, 'runMechanicalM2BTriggerAcceptance'],
  ['DriveMutation.gs', driveMutation, 'runMechanicalM2CAcceptance']
]) {
  const marker = 'function ' + entrypoint + '() {';
  const start = source.indexOf(marker);
  if (start < 0) throw new Error(name + ' TEST mutation entrypoint missing: ' + entrypoint);
  const prefix = source.slice(start, start + 220);
  if (!prefix.includes('requireDevRuntimeForTestMutation_();')) {
    throw new Error(name + ' TEST mutation entrypoint must guard Dev runtime before mutation: ' + entrypoint);
  }
}

const requiredTestId = '1Lu7bqDpNtNsmZJsIGzah0T_mxABen6gEbqHqFZ7AKz0';
if (!collector.includes(requiredTestId)) throw new Error('collector must remain pinned to dedicated TEST spreadsheet');
if (/ScriptApp\.newTrigger|\.create\(\)/.test(collector + collectorAcceptance)) throw new Error('trigger creation forbidden in TEST collector source');

if (fs.existsSync(`${root}/appsscript.json`)) throw new Error('manifest must exist only under fixed rootDir src/');
if (fs.existsSync('.github/workflows/gas-prod-deploy.yml')) throw new Error('production deploy workflow must remain disabled during bootstrap');

const devWorkflow = fs.readFileSync('.github/workflows/gas-dev-deploy.yml','utf8');
if (!devWorkflow.includes('push:')) throw new Error('automatic Dev deploy push trigger missing');
if (!devWorkflow.includes('branches:')) throw new Error('automatic Dev deploy main branch filter missing');
if (!devWorkflow.includes('- main')) throw new Error('automatic Dev deploy must remain pinned to main');
if (!devWorkflow.includes('paths:')) throw new Error('automatic Dev deploy path filter missing');
if (!devWorkflow.includes('ai-automation/gas-drive-state/src/**')) throw new Error('automatic Dev deploy source path filter missing');
if (!devWorkflow.includes('ai-automation/gas-drive-state/.claspignore')) throw new Error('automatic Dev deploy claspignore path filter missing');
if (!devWorkflow.includes('workflow_dispatch:')) throw new Error('manual Dev deploy recovery path missing');
if (!devWorkflow.includes('environment: development')) throw new Error('development Environment boundary missing');
if (!devWorkflow.includes('CLASPRC_JSON_DEV')) throw new Error('Dev-specific credential secret missing');
if (!devWorkflow.includes('EXPECTED_DEV_SCRIPT_ID')) throw new Error('independent Dev target variable missing');
if (!devWorkflow.includes('validate-deploy-target.mjs')) throw new Error('Dev exact-target preflight missing');
if (!devWorkflow.includes('prepare-drift-project.mjs .clasp.dev.json .gas-drift/pulled')) throw new Error('Dev readback workspace preparation missing');
if (!devWorkflow.includes('(cd .gas-drift/pulled && ../../node_modules/.bin/clasp pull)')) throw new Error('Dev GAS readback pull missing');
if (!devWorkflow.includes('compare-gas-source.mjs "$PWD/src" "$PWD/.gas-drift/pulled"')) throw new Error('Dev source drift comparison missing');

const prodWorkflow = fs.readFileSync('.github/workflows/gas-prod-deploy.yml.disabled','utf8');
if (!prodWorkflow.includes('environment: production')) throw new Error('production Environment boundary missing');
if (!prodWorkflow.includes('CLASPRC_JSON_PROD')) throw new Error('Prod-specific credential secret missing');
if (!prodWorkflow.includes('EXPECTED_PROD_SCRIPT_ID')) throw new Error('independent Prod target variable missing');

for (const file of [`${root}/.clasprc.json`,`${root}/.clasp.json`,`${root}/.clasp.dev.json`,`${root}/.clasp.prod.json`]) {
  if (fs.existsSync(file)) throw new Error(`sensitive clasp config must not be committed: ${file}`);
}
console.log('bootstrap validation PASS');

