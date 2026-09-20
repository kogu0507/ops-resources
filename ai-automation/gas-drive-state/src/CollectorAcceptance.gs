/**
 * Acceptance for the real bounded TEST collector v0.3.
 * Self-contained: seeds and cleans its own sentinel state.
 *
 * IMPORTANT: collector runtime commits through the Advanced Sheets API.
 * Post-commit assertions therefore read back through the Advanced Sheets API,
 * not the pre-existing SpreadsheetApp object, to avoid stale service caches.
 */
function runCollectorV03Acceptance() {
  const ss = SpreadsheetApp.openById(COLLECTOR_V03.TEST_SPREADSHEET_ID);
  const state = ss.getSheetByName(COLLECTOR_V03.STATE_SHEET);

  const archSnapshot = v03TestSnapshotFields_(state, 'STATE:T-FILE-ARCH', [
    'judge_status','judge_classification','judge_summary','judge_next_action',
    'judge_authority_checked_at','judge_updated_at','judge_run_ref'
  ]);
  const badSnapshot = v03TestSnapshotFields_(state, 'STATE:T-BAD-CONFIG', [
    'observed_name','observed_mime_type','observed_modified_at','source_version_signal',
    'collected_at','collection_status','last_collection_success_at','last_collection_error_at',
    'last_collection_error_code','last_collection_error','stale_after_minutes','stale_state',
    'mechanical_signal','mechanical_signal_detail'
  ]);

  v03TestDeleteRowsByStateKey_(state, 'STATE:T-FOLDER-FIXTURE:V03-MISSING-SENTINEL');

  try {
    v03TestPatchByStateKey_(state, 'STATE:T-FILE-ARCH', {
      judge_status:'REVIEWED',
      judge_classification:'V03_SENTINEL_CLASS',
      judge_summary:'V03_DO_NOT_OVERWRITE',
      judge_next_action:'V03_SENTINEL_NEXT',
      judge_run_ref:'V03-JUDGE-SENTINEL'
    });

    v03TestPatchByStateKey_(state, 'STATE:T-BAD-CONFIG', {
      observed_name:'V03-LAST-KNOWN-SENTINEL',
      observed_mime_type:'application/test',
      observed_modified_at:'2026-09-19T00:00:00Z',
      source_version_signal:'sentinel-prior-version',
      collected_at:'2026-09-19T00:00:00Z',
      collection_status:'SUCCESS',
      last_collection_success_at:'2026-09-19T00:00:00Z',
      last_collection_error_at:'',
      last_collection_error_code:'',
      last_collection_error:'',
      stale_after_minutes:60,
      stale_state:'STALE',
      mechanical_signal:'NONE',
      mechanical_signal_detail:'self-contained v0.3 acceptance failure sentinel'
    });

    v03TestAppendState_(state, {
      state_key:'STATE:T-FOLDER-FIXTURE:V03-MISSING-SENTINEL',
      source_key:'T-FOLDER-FIXTURE',
      entity_kind:'FILE',
      entity_key:'V03-MISSING-SENTINEL',
      source_ref:'V03-MISSING-SENTINEL',
      authority_ref:'',
      observed_name:'V03 missing sentinel',
      observed_mime_type:'application/test',
      observed_modified_at:'2026-09-19T00:00:00Z',
      source_version_signal:'sentinel-present',
      collected_at:'2026-09-19T00:00:00Z',
      collection_status:'SUCCESS',
      last_collection_success_at:'2026-09-19T00:00:00Z',
      last_collection_error_at:'',
      last_collection_error_code:'',
      last_collection_error:'',
      stale_after_minutes:60,
      stale_state:'STALE',
      mechanical_signal:'NONE',
      mechanical_signal_detail:'self-contained prior-known entity absent from bounded fixture folder',
      judge_status:'UNREVIEWED'
    });

    SpreadsheetApp.flush();
    const beforeRuns = v03TestFreshObjects_(COLLECTOR_V03.RUN_SHEET).length;
    const result = runBoundedTestCollectorV03();

    v03AssertAccept_(result.run_status === 'PARTIAL',
      'expected PARTIAL because two configured negative fixtures fail closed');
    v03AssertAccept_(result.attempted_count === 5, 'expected 5 enabled SOURCES');
    v03AssertAccept_(result.success_count === 3, 'expected 3 successful bounded sources');
    v03AssertAccept_(result.error_count === 2, 'expected 2 source-local negative fixtures');

    const freshRuns = v03TestFreshObjects_(COLLECTOR_V03.RUN_SHEET);
    v03AssertAccept_(freshRuns.length === beforeRuns + 1,
      'COLLECTION_RUNS must append exactly one row');
    v03AssertAccept_(String(freshRuns[freshRuns.length-1].run_id) === String(result.run_id),
      'fresh run readback must match returned run_id');

    const rows = v03TestFreshObjects_(COLLECTOR_V03.STATE_SHEET);
    const arch = v03TestUnique_(rows, 'STATE:T-FILE-ARCH');
    v03AssertAccept_(arch.collection_status === 'SUCCESS' && arch.stale_state === 'FRESH',
      'exact FILE source did not become FRESH/SUCCESS');
    v03AssertAccept_(arch.judge_status === 'REVIEWED', 'Collector overwrote judge_status');
    v03AssertAccept_(arch.judge_classification === 'V03_SENTINEL_CLASS',
      'Collector overwrote Judge classification');
    v03AssertAccept_(arch.judge_summary === 'V03_DO_NOT_OVERWRITE',
      'Collector overwrote Judge summary');
    v03AssertAccept_(arch.judge_next_action === 'V03_SENTINEL_NEXT',
      'Collector overwrote Judge next action');
    v03AssertAccept_(arch.judge_run_ref === 'V03-JUDGE-SENTINEL',
      'Collector overwrote Judge run ref');

    const range = v03TestUnique_(rows, 'STATE:T-SHEET-SCOUT');
    v03AssertAccept_(String(range.source_version_signal).startsWith('range-sha256:'),
      'SHEET_RANGE digest not collected');

    const fixtureRows = rows.filter(r =>
      String(r.source_key) === 'T-FOLDER-FIXTURE' &&
      String(r.entity_kind) === 'FILE' &&
      String(r.state_key).startsWith('STATE:T-FOLDER-FIXTURE:')
    );
    const live = fixtureRows.filter(r => String(r.mechanical_signal) !== 'MISSING');
    v03AssertAccept_(live.length === 3,
      'expected exactly 3 live fixture files after complete enumeration');

    const missing = v03TestUnique_(rows, 'STATE:T-FOLDER-FIXTURE:V03-MISSING-SENTINEL');
    v03AssertAccept_(missing.collection_status === 'NOT_FOUND' &&
      missing.mechanical_signal === 'MISSING' &&
      missing.stale_state === 'FRESH',
      'actual complete enumeration did not create authoritative MISSING transition');

    const bad = v03TestUnique_(rows, 'STATE:T-BAD-CONFIG');
    v03AssertAccept_(bad.collection_status === 'ERROR' && bad.stale_state === 'UNKNOWN',
      'bad config must be ERROR/UNKNOWN');
    v03AssertAccept_(bad.observed_name === 'V03-LAST-KNOWN-SENTINEL',
      'failure overwrote last-known observed fact');
    v03AssertAccept_(Boolean(bad.last_collection_success_at),
      'failure erased previous success timestamp');
    v03AssertAccept_(bad.mechanical_signal !== 'MISSING',
      'failed source manufactured MISSING');

    const ambig = v03TestUnique_(rows, 'STATE:T-AMBIG-ROUTE');
    v03AssertAccept_(ambig.collection_status === 'AMBIGUOUS' &&
      ambig.mechanical_signal === 'ROUTE_INVALID',
      'ambiguous route did not fail closed');

    console.log('PASS: v0.3 actual bounded collector acceptance.');
    console.log('PASS: post-commit assertions used fresh Advanced Sheets API readback.');
    console.log('PASS: actual SOURCES -> DRIVE_STATE -> COLLECTION_RUNS.');
    console.log('PASS: actual MISSING transition only after complete bounded enumeration.');
    console.log('PASS: actual source failure preserved last-known facts, forced UNKNOWN, and did not create MISSING.');
    console.log('PASS: Judge ownership sentinel was seeded by this acceptance run and preserved.');
    console.log('PASS: acceptance sentinel cleanup will restore prior TEST state.');
    console.log('NOTE: concurrent LockService overlap remains a separate empirical probe.');
    return result;
  } finally {
    v03TestRestoreSnapshot_(state, archSnapshot);
    v03TestRestoreSnapshot_(state, badSnapshot);
    v03TestDeleteRowsByStateKey_(state, 'STATE:T-FOLDER-FIXTURE:V03-MISSING-SENTINEL');
    SpreadsheetApp.flush();
  }
}

function v03TestFreshObjects_(sheetName) {
  const response = Sheets.Spreadsheets.Values.get(
    COLLECTOR_V03.TEST_SPREADSHEET_ID,
    "'" + String(sheetName).replace(/'/g, "''") + "'!A:AZ",
    {valueRenderOption:'UNFORMATTED_VALUE'}
  );
  const values = response.values || [];
  if (!values.length) return [];
  const header = values[0].map(String);
  return values.slice(1).map((row,i) => {
    const obj = {__row:i+2};
    header.forEach((h,j) => obj[h] = row[j] === undefined ? '' : row[j]);
    return obj;
  }).filter(r => Object.keys(r).some(k => k !== '__row' && r[k] !== ''));
}

function v03TestObjects_(sheet) {
  const values = sheet.getDataRange().getValues();
  const header = values[0].map(String);
  return values.slice(1).map((row,i) => {
    const obj = {__row:i+2};
    header.forEach((h,j) => obj[h] = row[j]);
    return obj;
  }).filter(r => Object.keys(r).some(k => k !== '__row' && r[k] !== ''));
}

function v03TestUnique_(rows, stateKey) {
  const matches = rows.filter(r => String(r.state_key) === String(stateKey));
  if (matches.length !== 1) {
    throw new Error('V03 ACCEPTANCE FIXTURE ERROR: expected one row for '+stateKey+', got '+matches.length);
  }
  return matches[0];
}

function v03TestSnapshotFields_(sheet, stateKey, fields) {
  const rows = v03TestObjects_(sheet);
  const row = v03TestUnique_(rows, stateKey);
  const values = {};
  fields.forEach(f => values[f] = row[f]);
  return {stateKey:stateKey, fields:fields, values:values};
}

function v03TestRestoreSnapshot_(sheet, snapshot) {
  if (!snapshot) return;
  v03TestPatchByStateKey_(sheet, snapshot.stateKey, snapshot.values);
}

function v03TestPatchByStateKey_(sheet, stateKey, patch) {
  const rows = v03TestObjects_(sheet);
  const row = v03TestUnique_(rows, stateKey);
  const header = v03Header_(sheet);
  Object.keys(patch).forEach(k => {
    const col = header.indexOf(k);
    if (col < 0) throw new Error('V03 ACCEPTANCE FIXTURE ERROR: missing field '+k);
    sheet.getRange(row.__row,col+1).setValue(patch[k]);
  });
}

function v03TestAppendState_(sheet, values) {
  const header = v03Header_(sheet);
  sheet.appendRow(header.map(h => values[h] === undefined ? '' : values[h]));
}

function v03TestDeleteRowsByStateKey_(sheet, stateKey) {
  const rows = v03TestObjects_(sheet)
    .filter(r => String(r.state_key) === String(stateKey))
    .sort((a,b) => b.__row - a.__row);
  rows.forEach(r => sheet.deleteRow(r.__row));
}

function v03AssertAccept_(condition,message) {
  if (!condition) throw new Error('V03 ACCEPTANCE FAIL: '+message);
}
