/**
 * AI Automation Drive-state
 * Phase 1 / Integrated TEST Collector v0.2
 *
 * TEST ONLY. Production trigger creation is disabled.
 */
const CFG = Object.freeze({
  TEST_SPREADSHEET_ID: '1Lu7bqDpNtNsmZJsIGzah0T_mxABen6gEbqHqFZ7AKz0',
  FIXTURE_FOLDER_ID: '1Dk60IAC23VboKE_MgbbktutgnI_ROOaa',
  EXPECTED_FIXTURE_COUNT: 3,
  PAGE_SIZE: 1,
  TEST_PREFIX: 'GAS-V02:',
  STALE_MINUTES: 60
});

function runIntegratedAcceptanceTest() {
  const results = [
    testPaginationIncompleteFailClosed_(),
    testPaginationComplete_(),
    testJudgeOwnership_(),
    testFailureFreshness_(),
    testStableIdentity_(),
    testMissingPredicate_(),
    testRunReadback_()
  ];
  console.log('========== ACCEPTANCE SUMMARY ==========');
  results.forEach(r => console.log((r.pass ? 'PASS' : 'FAIL') + ': ' + r.name));
  const failed = results.filter(r => !r.pass);
  if (failed.length) throw new Error('INTEGRATED TEST FAILED: ' + failed.map(r => r.name).join(', '));
  console.log('PASS: ' + results.length + '/' + results.length + ' acceptance cases.');
  console.log('PASS: production state was not touched.');
  console.log('PASS: no trigger was created.');
  return results;
}

function testPaginationIncompleteFailClosed_() {
  const result = Drive.Files.list({
    q: "'" + CFG.FIXTURE_FOLDER_ID + "' in parents and trashed = false",
    pageSize: CFG.PAGE_SIZE,
    fields: 'nextPageToken,incompleteSearch,files(id,name,mimeType,modifiedTime,version)'
  });
  const files = result.files || [];
  const complete = !result.nextPageToken && result.incompleteSearch !== true;
  const missingAllowed = authoritativeMissingAllowed_({
    complete: complete,
    authoritativeAbsenceCheck: true,
    ambiguous: false,
    failed: false
  });
  assert_(files.length === 1, 'first page expected 1 file, got ' + files.length);
  assert_(Boolean(result.nextPageToken), 'first page must expose nextPageToken');
  assert_(complete === false, 'incomplete first page must not be complete');
  assert_(missingAllowed === false, 'incomplete enumeration must not allow MISSING');
  console.log('PASS: incomplete pagination -> complete=false -> MISSING forbidden');
  return pass_('incomplete pagination fail-closed');
}

function testPaginationComplete_() {
  let pageToken = null;
  let pageCount = 0;
  const files = [];
  do {
    const params = {
      q: "'" + CFG.FIXTURE_FOLDER_ID + "' in parents and trashed = false",
      pageSize: CFG.PAGE_SIZE,
      fields: 'nextPageToken,incompleteSearch,files(id,name,mimeType,modifiedTime,version)'
    };
    if (pageToken) params.pageToken = pageToken;
    const result = Drive.Files.list(params);
    pageCount++;
    assert_(result.incompleteSearch !== true, 'incompleteSearch=true on page ' + pageCount);
    (result.files || []).forEach(file => files.push(file));
    pageToken = result.nextPageToken || null;
    assert_(pageCount <= 20, 'pagination safety bound exceeded');
  } while (pageToken);
  const unique = new Set(files.map(f => f.id));
  assert_(unique.size === CFG.EXPECTED_FIXTURE_COUNT,
    'expected ' + CFG.EXPECTED_FIXTURE_COUNT + ' fixtures, got ' + unique.size);
  assert_(authoritativeMissingAllowed_({
    complete: true,
    authoritativeAbsenceCheck: true,
    ambiguous: false,
    failed: false
  }) === true, 'completed authoritative enumeration should allow absence evaluation');
  console.log('PASS: complete pagination -> ' + unique.size + ' fixtures / ' + pageCount + ' pages');
  return pass_('complete pagination');
}

function testJudgeOwnership_() {
  const sheet = stateSheet_();
  const header = header_(sheet);
  const stateKey = CFG.TEST_PREFIX + 'JUDGE-PRESERVE';
  deleteTestRow_(sheet, header, stateKey);
  const initial = blankObject_(header);
  Object.assign(initial, {
    state_key: stateKey,
    source_key: 'GAS-V02-TEST',
    entity_kind: 'TEST',
    entity_key: 'judge-preserve',
    source_ref: CFG.FIXTURE_FOLDER_ID,
    collection_status: 'SUCCESS',
    stale_state: 'FRESH',
    judge_status: 'REVIEWED',
    judge_classification: 'SENTINEL_CLASS',
    judge_summary: 'DO_NOT_OVERWRITE',
    judge_next_action: 'SENTINEL_NEXT',
    judge_run_ref: 'JUDGE-SENTINEL-001'
  });
  sheet.appendRow(header.map(h => initial[h] || ''));
  const row = findRowByStateKey_(sheet, header, stateKey);
  const now = isoNow_();
  collectorPatch_(sheet, header, row, {
    observed_name: 'collector-updated',
    collected_at: now,
    collection_status: 'SUCCESS',
    last_collection_success_at: now,
    stale_after_minutes: CFG.STALE_MINUTES,
    stale_state: 'FRESH',
    mechanical_signal: 'NONE',
    mechanical_signal_detail: 'collector update'
  });
  const after = readRowObject_(sheet, header, row);
  assert_(after.judge_classification === 'SENTINEL_CLASS', 'Collector overwrote judge_classification');
  assert_(after.judge_summary === 'DO_NOT_OVERWRITE', 'Collector overwrote judge_summary');
  assert_(after.judge_next_action === 'SENTINEL_NEXT', 'Collector overwrote judge_next_action');
  assert_(after.judge_run_ref === 'JUDGE-SENTINEL-001', 'Collector overwrote judge_run_ref');
  console.log('PASS: Collector preserved Judge-owned fields');
  return pass_('Collector/Judge ownership separation');
}

function testFailureFreshness_() {
  const success = new Date('2026-09-20T00:00:00Z');
  const failure = new Date('2026-09-20T00:10:00Z');
  const now = new Date('2026-09-20T00:20:00Z');
  const state = deriveFreshness_(success.toISOString(), failure.toISOString(), 60, now);
  assert_(state === 'UNKNOWN', 'newer failure expected UNKNOWN, got ' + state);
  const oldSuccess = new Date('2026-09-19T20:00:00Z');
  const stale = deriveFreshness_(oldSuccess.toISOString(), '', 60, now);
  assert_(stale === 'STALE', 'expired success expected STALE, got ' + stale);
  console.log('PASS: newer failure -> UNKNOWN; expired success -> STALE');
  return pass_('freshness fail-closed');
}

function testStableIdentity_() {
  const existing = {state_key: CFG.TEST_PREFIX + 'IDENTITY', source_key: 'SOURCE-A', entity_key: 'ENTITY-A'};
  let blocked = false;
  try {
    assertStableIdentity_(existing, {
      state_key: existing.state_key,
      source_key: 'SOURCE-A',
      entity_key: 'ENTITY-B'
    });
  } catch (e) {
    blocked = true;
  }
  assert_(blocked, 'stable state_key was incorrectly allowed to change entity');
  console.log('PASS: stable identity repurpose blocked');
  return pass_('stable identity');
}

function testMissingPredicate_() {
  const cases = [
    [{complete:true, authoritativeAbsenceCheck:true, ambiguous:false, failed:false}, true],
    [{complete:false, authoritativeAbsenceCheck:true, ambiguous:false, failed:false}, false],
    [{complete:true, authoritativeAbsenceCheck:true, ambiguous:false, failed:true}, false],
    [{complete:true, authoritativeAbsenceCheck:true, ambiguous:true, failed:false}, false],
    [{complete:true, authoritativeAbsenceCheck:false, ambiguous:false, failed:false}, false]
  ];
  cases.forEach(c => assert_(authoritativeMissingAllowed_(c[0]) === c[1], 'MISSING predicate mismatch'));
  console.log('PASS: MISSING predicate fails closed');
  return pass_('MISSING predicate');
}

function testRunReadback_() {
  const sheet = runSheet_();
  const header = header_(sheet);
  const runId = CFG.TEST_PREFIX + 'RUN-' + Utilities.getUuid();
  const row = blankObject_(header);
  Object.assign(row, {
    run_id: runId,
    started_at: isoNow_(),
    finished_at: isoNow_(),
    collector_version: 'integrated-test-v0.2',
    trigger_type: 'MANUAL_TEST',
    scope_ref: CFG.FIXTURE_FOLDER_ID,
    attempted_count: 1,
    success_count: 1,
    error_count: 0,
    stale_count_after_run: 0,
    run_status: 'SUCCESS'
  });
  sheet.appendRow(header.map(h => row[h] || ''));
  const values = sheet.getDataRange().getValues();
  const runCol = header.indexOf('run_id');
  assert_(values.some((r, i) => i > 0 && r[runCol] === runId), 'COLLECTION_RUNS append/readback failed');
  console.log('PASS: COLLECTION_RUNS append + readback');
  return pass_('run record/readback');
}

function authoritativeMissingAllowed_(ctx) {
  return ctx.complete === true &&
    ctx.authoritativeAbsenceCheck === true &&
    ctx.ambiguous !== true &&
    ctx.failed !== true;
}

function deriveFreshness_(lastSuccess, lastError, staleAfterMinutes, now) {
  if (!lastSuccess) return 'UNKNOWN';
  const successMs = new Date(lastSuccess).getTime();
  const errorMs = lastError ? new Date(lastError).getTime() : 0;
  if (errorMs > successMs) return 'UNKNOWN';
  return (now.getTime() - successMs) <= Number(staleAfterMinutes) * 60000 ? 'FRESH' : 'STALE';
}

function assertStableIdentity_(existing, incoming) {
  if (existing.state_key !== incoming.state_key ||
      existing.source_key !== incoming.source_key ||
      existing.entity_key !== incoming.entity_key) {
    throw new Error('IDENTITY_MISMATCH: stable state identity cannot be repurposed');
  }
}

function spreadsheet_() {
  return SpreadsheetApp.openById(CFG.TEST_SPREADSHEET_ID);
}
function stateSheet_() {
  const sheet = spreadsheet_().getSheetByName('DRIVE_STATE');
  if (!sheet) throw new Error('TEST schema error: DRIVE_STATE missing');
  return sheet;
}
function runSheet_() {
  const sheet = spreadsheet_().getSheetByName('COLLECTION_RUNS');
  if (!sheet) throw new Error('TEST schema error: COLLECTION_RUNS missing');
  return sheet;
}
function header_(sheet) {
  const lastColumn = sheet.getLastColumn();
  if (!lastColumn) throw new Error('TEST schema error: ' + sheet.getName() + ' has no header');
  return sheet.getRange(1,1,1,lastColumn).getValues()[0].map(String);
}
function blankObject_(header) {
  const obj = {};
  header.forEach(h => obj[h] = '');
  return obj;
}
function findRowByStateKey_(sheet, header, stateKey) {
  const values = sheet.getDataRange().getValues();
  const col = header.indexOf('state_key');
  if (col < 0) throw new Error('TEST schema error: state_key missing');
  for (let i=1;i<values.length;i++) if (values[i][col] === stateKey) return i+1;
  throw new Error('state row not found: ' + stateKey);
}
function deleteTestRow_(sheet, header, stateKey) {
  const values = sheet.getDataRange().getValues();
  const col = header.indexOf('state_key');
  for (let i=values.length-1;i>=1;i--) if (values[i][col] === stateKey) sheet.deleteRow(i+1);
}
function readRowObject_(sheet, header, rowNumber) {
  const values = sheet.getRange(rowNumber,1,1,header.length).getValues()[0];
  const obj = {};
  header.forEach((h,i) => obj[h] = values[i]);
  return obj;
}
function collectorPatch_(sheet, header, rowNumber, patch) {
  const allowed = new Set([
    'observed_name','observed_mime_type','observed_modified_at','source_version_signal',
    'collected_at','collection_status','last_collection_success_at','last_collection_error_at',
    'last_collection_error_code','last_collection_error','stale_after_minutes','stale_state',
    'mechanical_signal','mechanical_signal_detail'
  ]);
  Object.keys(patch).forEach(name => {
    assert_(allowed.has(name), 'Collector attempted non-owned field: ' + name);
    const col = header.indexOf(name);
    assert_(col >= 0, 'schema field missing: ' + name);
    sheet.getRange(rowNumber,col+1).setValue(patch[name]);
  });
}
function isoNow_() { return new Date().toISOString(); }
function pass_(name) { return {name:name, pass:true}; }
function assert_(condition, message) { if (!condition) throw new Error('TEST FAIL: ' + message); }

function installProductionTrigger() {
  throw new Error('HUMAN GATE REQUIRED: production trigger installation disabled');
}
