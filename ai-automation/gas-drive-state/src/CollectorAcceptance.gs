/**
 * Acceptance for the real bounded TEST collector v0.3.
 * Exercises actual SOURCES -> DRIVE_STATE -> COLLECTION_RUNS paths.
 */
function runCollectorV03Acceptance() {
  const ss = SpreadsheetApp.openById(COLLECTOR_V03.TEST_SPREADSHEET_ID);
  const state = ss.getSheetByName(COLLECTOR_V03.STATE_SHEET);
  const runs = ss.getSheetByName(COLLECTOR_V03.RUN_SHEET);

  v03SeedFailureFreshnessSentinel_(state);
  v03SeedMissingSentinel_(state);

  const beforeRuns = runs.getLastRow();
  const result = runBoundedTestCollectorV03();

  v03AssertAccept_(result.run_status === 'PARTIAL', 'expected PARTIAL because two configured negative fixtures fail closed');
  v03AssertAccept_(result.attempted_count === 5, 'expected 5 enabled SOURCES');
  v03AssertAccept_(result.success_count === 3, 'expected 3 successful bounded sources');
  v03AssertAccept_(result.error_count === 2, 'expected 2 source-local negative fixtures');
  v03AssertAccept_(runs.getLastRow() === beforeRuns + 1, 'COLLECTION_RUNS must append exactly one row');

  const rows = v03Objects_(state);
  const arch = rows.find(r => String(r.state_key) === 'STATE:T-FILE-ARCH');
  v03AssertAccept_(arch && arch.collection_status === 'SUCCESS' && arch.stale_state === 'FRESH', 'exact FILE source did not become FRESH/SUCCESS');
  v03AssertAccept_(arch.judge_classification === 'TEST_CLASS', 'Collector overwrote Judge-owned classification');

  const range = rows.find(r => String(r.state_key) === 'STATE:T-SHEET-SCOUT');
  v03AssertAccept_(range && String(range.source_version_signal).startsWith('range-sha256:'), 'SHEET_RANGE digest not collected');

  const fixtureRows = rows.filter(r => String(r.source_key) === 'T-FOLDER-FIXTURE' && String(r.entity_kind) === 'FILE' &&
    String(r.state_key).startsWith('STATE:T-FOLDER-FIXTURE:'));
  const live = fixtureRows.filter(r => String(r.mechanical_signal) !== 'MISSING');
  v03AssertAccept_(live.length === 3, 'expected exactly 3 live fixture files after complete enumeration');

  const missing = rows.find(r => String(r.state_key) === 'STATE:T-FOLDER-FIXTURE:V03-MISSING-SENTINEL');
  v03AssertAccept_(missing && missing.collection_status === 'NOT_FOUND' && missing.mechanical_signal === 'MISSING' && missing.stale_state === 'FRESH',
    'actual complete enumeration did not create authoritative MISSING transition');

  const bad = rows.find(r => String(r.state_key) === 'STATE:T-BAD-CONFIG');
  v03AssertAccept_(bad && bad.collection_status === 'ERROR' && bad.stale_state === 'UNKNOWN', 'bad config must be ERROR/UNKNOWN');
  v03AssertAccept_(bad.observed_name === 'V03-LAST-KNOWN-SENTINEL', 'failure overwrote last-known observed fact');
  v03AssertAccept_(bad.last_collection_success_at, 'failure erased previous success timestamp');

  const ambig = rows.find(r => String(r.state_key) === 'STATE:T-AMBIG-ROUTE');
  v03AssertAccept_(ambig && ambig.collection_status === 'AMBIGUOUS' && ambig.mechanical_signal === 'ROUTE_INVALID', 'ambiguous route did not fail closed');

  console.log('PASS: v0.3 actual bounded collector acceptance.');
  console.log('PASS: actual SOURCES -> DRIVE_STATE -> COLLECTION_RUNS.');
  console.log('PASS: actual MISSING transition after complete bounded enumeration.');
  console.log('PASS: actual source failure preserved last-known facts and forced UNKNOWN.');
  console.log('NOTE: concurrent LockService overlap remains a separate empirical probe.');
  return result;
}

function v03SeedFailureFreshnessSentinel_(sheet) {
  const key = 'STATE:T-BAD-CONFIG';
  const found = v03FindUniqueState_(sheet,key);
  const patch = {
    observed_name:'V03-LAST-KNOWN-SENTINEL',
    observed_mime_type:'application/test',
    observed_modified_at:'2026-09-19T00:00:00Z',
    source_version_signal:'sentinel-prior-version',
    collected_at:'2026-09-19T00:00:00Z',
    collection_status:'SUCCESS',
    last_collection_success_at:'2026-09-19T00:00:00Z',
    last_collection_error_at:'', last_collection_error_code:'', last_collection_error:'',
    stale_after_minutes:60, stale_state:'STALE', mechanical_signal:'NONE',
    mechanical_signal_detail:'acceptance sentinel before configured failure'
  };
  if (found) v03PatchExisting_(sheet,found.__row,patch);
  else v03UpsertState_(sheet,{state_key:key,source_key:'T-BAD-CONFIG',entity_kind:'FILE',entity_key:'',source_ref:'',authority_ref:''},patch);
}

function v03SeedMissingSentinel_(sheet) {
  const key = 'STATE:T-FOLDER-FIXTURE:V03-MISSING-SENTINEL';
  const found = v03FindUniqueState_(sheet,key);
  const patch = {
    observed_name:'V03 missing sentinel', observed_mime_type:'application/test',
    observed_modified_at:'2026-09-19T00:00:00Z', source_version_signal:'sentinel-present',
    collected_at:'2026-09-19T00:00:00Z', collection_status:'SUCCESS',
    last_collection_success_at:'2026-09-19T00:00:00Z',
    last_collection_error_at:'', last_collection_error_code:'', last_collection_error:'',
    stale_after_minutes:60, stale_state:'STALE', mechanical_signal:'NONE',
    mechanical_signal_detail:'seeded prior-known entity absent from bounded fixture folder'
  };
  const identity={state_key:key,source_key:'T-FOLDER-FIXTURE',entity_kind:'FILE',
    entity_key:'V03-MISSING-SENTINEL',source_ref:'V03-MISSING-SENTINEL',authority_ref:''};
  if (found) v03PatchExisting_(sheet,found.__row,patch);
  else v03UpsertState_(sheet,identity,patch);
}

function v03AssertAccept_(condition,message) {
  if (!condition) throw new Error('V03 ACCEPTANCE FAIL: '+message);
}
