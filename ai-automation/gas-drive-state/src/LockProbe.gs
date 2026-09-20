/**
 * Empirical LockService overlap probe for the bounded TEST collector.
 *
 * Manual TEST only.
 * No trigger creation.
 * No production writes.
 *
 * Procedure:
 * 1) Start holdCollectorLockForOverlapProbe() in one Apps Script tab.
 * 2) While it is sleeping, run runCollectorLockContenderProbe() in another tab.
 * 3) Contender must PASS with SKIPPED / LOCK_HELD and no COLLECTION_RUNS append.
 */
function holdCollectorLockForOverlapProbe() {
  const lock = LockService.getScriptLock();
  const acquired = lock.tryLock(1000);
  if (!acquired) {
    throw new Error('LOCK PROBE SETUP FAIL: holder could not acquire ScriptLock');
  }
  const started = new Date().toISOString();
  try {
    console.log(JSON.stringify({
      probe:'lock-holder',
      status:'LOCK_ACQUIRED',
      started_at:started,
      hold_ms:20000
    }));
    Utilities.sleep(20000);
    console.log(JSON.stringify({
      probe:'lock-holder',
      status:'HOLD_COMPLETE',
      finished_at:new Date().toISOString()
    }));
    return {status:'HOLD_COMPLETE', started_at:started};
  } finally {
    lock.releaseLock();
    console.log('PASS: lock-holder released ScriptLock.');
  }
}

function runCollectorLockContenderProbe() {
  const before = v03LockProbeFreshRunCount_();
  const started = new Date().toISOString();
  const result = runBoundedTestCollectorV03();
  const after = v03LockProbeFreshRunCount_();

  if (!result || result.run_status !== 'SKIPPED' || result.reason !== 'LOCK_HELD') {
    throw new Error('LOCK PROBE FAIL: contender expected SKIPPED / LOCK_HELD, got ' + JSON.stringify(result));
  }
  if (after !== before) {
    throw new Error('LOCK PROBE FAIL: COLLECTION_RUNS changed during lock-held skip; before=' + before + ' after=' + after);
  }

  console.log(JSON.stringify({
    probe:'collector-contender',
    status:'PASS',
    started_at:started,
    finished_at:new Date().toISOString(),
    collector_result:result,
    collection_runs_before:before,
    collection_runs_after:after
  }));
  console.log('PASS: concurrent contender returned SKIPPED / LOCK_HELD.');
  console.log('PASS: lock-held contender performed no COLLECTION_RUNS write.');
  return result;
}

function v03LockProbeFreshRunCount_() {
  const response = Sheets.Spreadsheets.Values.get(
    COLLECTOR_V03.TEST_SPREADSHEET_ID,
    "'" + COLLECTOR_V03.RUN_SHEET.replace(/'/g, "''") + "'!A:A",
    {valueRenderOption:'UNFORMATTED_VALUE'}
  );
  const values = response.values || [];
  return Math.max(0, values.length - 1);
}
