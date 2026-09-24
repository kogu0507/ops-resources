/**
 * DEV-only bounded command runner.
 *
 * Purpose:
 * - remove recurring Apps Script editor "select function -> Run" steps;
 * - accept commands only from one exact Dev command Sheet;
 * - execute only a finite hard-coded allowlist;
 * - process at most one READY command per tick;
 * - record durable DONE/FAILED result back to the same row.
 *
 * Production execution is intentionally impossible because every public entrypoint
 * calls requireDevRuntimeForTestMutation_(), which checks the exact Dev script ID.
 */
const DEV_COMMAND_RUNNER = Object.freeze({
  spreadsheetId: '1ugAXhNMvEcZ89V0QCb3iEfxevxwUMmZhzF3WKN2CPmY',
  sheetName: 'COMMANDS',
  handler: 'runDevCommandQueueTick',
  cadenceMinutes: 5,
  header: Object.freeze([
    'command_id',
    'action',
    'requested_at',
    'state',
    'claimed_at',
    'finished_at',
    'result_json',
    'requested_by',
    'notes'
  ])
});

function getDevCommandRunnerPreflight() {
  requireDevRuntimeForTestMutation_();

  const sheet = devCommandSheet_();
  devCommandAssertHeader_(sheet);

  const all = ScriptApp.getProjectTriggers();
  const matches = all.filter(t => t.getHandlerFunction() === DEV_COMMAND_RUNNER.handler);

  const result = {
    status: 'PASS',
    spreadsheetId: DEV_COMMAND_RUNNER.spreadsheetId,
    sheetName: DEV_COMMAND_RUNNER.sheetName,
    handler: DEV_COMMAND_RUNNER.handler,
    cadenceMinutes: DEV_COMMAND_RUNNER.cadenceMinutes,
    matchingTriggers: matches.length,
    projectTriggerCount: all.length,
    preflight: matches.length === 0 && all.length === 0
      ? 'READY'
      : (matches.length === 1 && all.length === 1
        ? 'ALREADY_INSTALLED'
        : 'BLOCKED_TRIGGER_STATE')
  };
  console.log(JSON.stringify(result));
  return result;
}

function installDevCommandRunnerTrigger() {
  requireDevRuntimeForTestMutation_();

  const preflight = getDevCommandRunnerPreflight();
  if (preflight.preflight === 'ALREADY_INSTALLED') return preflight;
  if (preflight.preflight !== 'READY') {
    throw new Error('DEV_COMMAND_RUNNER_TRIGGER_STATE_BLOCKED');
  }

  const created = ScriptApp.newTrigger(DEV_COMMAND_RUNNER.handler)
    .timeBased()
    .everyMinutes(DEV_COMMAND_RUNNER.cadenceMinutes)
    .create();
  const createdId = created.getUniqueId();

  const all = ScriptApp.getProjectTriggers();
  const matches = all.filter(t => t.getHandlerFunction() === DEV_COMMAND_RUNNER.handler);
  const verified = all.length === 1 &&
    matches.length === 1 &&
    matches[0].getUniqueId() === createdId;

  if (!verified) {
    all.filter(t => t.getUniqueId() === createdId).forEach(t => ScriptApp.deleteTrigger(t));
    throw new Error('DEV_COMMAND_RUNNER_TRIGGER_CREATE_VERIFY_FAILED');
  }

  const result = {
    status: 'PASS',
    triggerUniqueId: createdId,
    handler: DEV_COMMAND_RUNNER.handler,
    cadenceMinutes: DEV_COMMAND_RUNNER.cadenceMinutes
  };
  console.log(JSON.stringify(result));
  return result;
}

function removeDevCommandRunnerTrigger() {
  requireDevRuntimeForTestMutation_();

  const all = ScriptApp.getProjectTriggers();
  const matches = all.filter(t => t.getHandlerFunction() === DEV_COMMAND_RUNNER.handler);
  if (all.length !== 1 || matches.length !== 1) {
    throw new Error('DEV_COMMAND_RUNNER_TRIGGER_IDENTITY_MISMATCH');
  }

  const id = matches[0].getUniqueId();
  ScriptApp.deleteTrigger(matches[0]);

  const remaining = ScriptApp.getProjectTriggers();
  if (remaining.some(t => t.getUniqueId() === id)) {
    throw new Error('DEV_COMMAND_RUNNER_TRIGGER_DELETE_VERIFY_FAILED');
  }

  const result = {status: 'PASS', removedTriggerUniqueId: id};
  console.log(JSON.stringify(result));
  return result;
}

function runDevCommandQueueTick() {
  requireDevRuntimeForTestMutation_();

  const lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) {
    const skipped = {status: 'SKIPPED', reason: 'LOCK_HELD'};
    console.log(JSON.stringify(skipped));
    return skipped;
  }

  try {
    const sheet = devCommandSheet_();
    devCommandAssertHeader_(sheet);

    const lastRow = sheet.getLastRow();
    if (lastRow < 2) {
      const idle = {status: 'NO_ACTION', reason: 'NO_COMMANDS'};
      console.log(JSON.stringify(idle));
      return idle;
    }

    const values = sheet.getRange(2, 1, lastRow - 1, DEV_COMMAND_RUNNER.header.length).getValues();
    let selected = null;

    for (let i = 0; i < values.length; i++) {
      const row = values[i];
      if (String(row[3] || '').trim() === 'READY') {
        selected = {rowNumber: i + 2, values: row};
        break;
      }
    }

    if (!selected) {
      const idle = {status: 'NO_ACTION', reason: 'NO_READY_COMMAND'};
      console.log(JSON.stringify(idle));
      return idle;
    }

    const commandId = String(selected.values[0] || '').trim();
    const action = String(selected.values[1] || '').trim();
    if (!commandId) throw new Error('DEV_COMMAND_ID_REQUIRED');
    if (!action) throw new Error('DEV_COMMAND_ACTION_REQUIRED');

    const claimedAt = new Date().toISOString();
    sheet.getRange(selected.rowNumber, 4, 1, 2).setValues([['CLAIMED', claimedAt]]);
    SpreadsheetApp.flush();

    let result;
    try {
      result = devCommandExecuteAllowed_(action);
      const finishedAt = new Date().toISOString();
      sheet.getRange(selected.rowNumber, 4).setValue('DONE');
      sheet.getRange(selected.rowNumber, 6, 1, 2)
        .setValues([[finishedAt, JSON.stringify({ok: true, action: action, result: result})]]);
      SpreadsheetApp.flush();

      const done = {status: 'DONE', command_id: commandId, action: action};
      console.log(JSON.stringify(done));
      return done;
    } catch (e) {
      const finishedAt = new Date().toISOString();
      const failure = {
        ok: false,
        action: action,
        error: String(e && e.message ? e.message : e)
      };
      sheet.getRange(selected.rowNumber, 4).setValue('FAILED');
      sheet.getRange(selected.rowNumber, 6, 1, 2)
        .setValues([[finishedAt, JSON.stringify(failure)]]);
      SpreadsheetApp.flush();

      console.error(JSON.stringify(failure));
      return {status: 'FAILED', command_id: commandId, action: action, error: failure.error};
    }
  } finally {
    lock.releaseLock();
  }
}

function devCommandExecuteAllowed_(action) {
  switch (action) {
    case 'CI_CD_SMOKE':
      return ciCdSmoke();
    case 'COLLECTOR_V03_ACCEPTANCE':
      return runCollectorV03Acceptance();
    case 'OPERATIONS_BOARD_HEALTH_READ_ACCEPTANCE':
      return runOperationsBoardHealthDevReadAcceptance();
    case 'OPERATIONS_BOARD_UNCHANGED_DEDUP_ACCEPTANCE':
      return runOperationsBoardUnchangedHealthDedupAcceptance();
    default:
      throw new Error('DEV_COMMAND_ACTION_NOT_ALLOWED: ' + action);
  }
}

function devCommandSheet_() {
  const ss = SpreadsheetApp.openById(DEV_COMMAND_RUNNER.spreadsheetId);
  const sheet = ss.getSheetByName(DEV_COMMAND_RUNNER.sheetName);
  if (!sheet) throw new Error('DEV_COMMAND_SHEET_MISSING');
  return sheet;
}

function devCommandAssertHeader_(sheet) {
  const actual = sheet.getRange(1, 1, 1, DEV_COMMAND_RUNNER.header.length)
    .getValues()[0]
    .map(v => String(v || '').trim());

  const expected = DEV_COMMAND_RUNNER.header.slice();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error('DEV_COMMAND_HEADER_MISMATCH');
  }
}
