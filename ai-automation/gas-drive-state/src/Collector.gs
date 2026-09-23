/**
 * Phase 1 bounded TEST collector v0.3.
 * TEST spreadsheet only. No trigger creation. No production writes.
 *
 * All DRIVE_STATE changes plus the COLLECTION_RUNS append are committed
 * in one Google Sheets spreadsheets.batchUpdate request.
 */
const COLLECTOR_V03 = Object.freeze({
  VERSION: 'collector-v0.6.0-dev-board-health',
  DEV_SCRIPT_ID: '1Txo4FJmWuJtq76e2v3nLrcw2fv1MlMTHJZnFj_lSvhE_7AZVr4UjC2zs',
  PROD_SCRIPT_ID: '1r3y9O0_Du-QAoxKiJRP5nCSnLzrMo5IFTV3m1ex2KsvQCFNR5d0qoLBL',
  TEST_SPREADSHEET_ID: '1Lu7bqDpNtNsmZJsIGzah0T_mxABen6gEbqHqFZ7AKz0',
  PROD_SPREADSHEET_ID: '19t_taz3ss_HXRCOncPv1AXhQjjmCOwf0EPh1g9Q3wVY',
  SOURCE_SHEET: 'SOURCES',
  STATE_SHEET: 'DRIVE_STATE',
  RUN_SHEET: 'COLLECTION_RUNS',
  MAX_PAGES: 20,
  OPERATIONS_BOARD_SELECTOR: 'OPERATIONS_BOARD_STRUCTURAL_HEALTH_V1',
  OPERATIONS_BOARD_FILE_ID: '1NrhZCPLXOK4TKZqKBg3YEmYl1D7Qtgfx',
  OPERATIONS_BOARD_MAX_BYTES: 262144,
  OPERATIONS_BOARD_MAX_ROWS: 200,
  OPERATIONS_BOARD_MAX_ELIGIBLE_ROWS: 20
});

function requireDevRuntimeForTestMutation_() {
  const currentScriptId = ScriptApp.getScriptId();
  if (currentScriptId !== COLLECTOR_V03.DEV_SCRIPT_ID) {
    throw v03Error_(
      'RUNTIME_TARGET_MISMATCH',
      'TEST-only mutation requires exact approved Dev Apps Script project'
    );
  }
  return currentScriptId;
}

function runBoundedTestCollectorV03() {
  return v03RunForTarget_('DEV_TEST');
}

function runBoundedProductionCollectorV03() {
  return v03RunForTarget_('PRODUCTION');
}

function runScheduledProductionCollectorV03() {
  return v03RunForTarget_('PRODUCTION_SCHEDULED');
}

function v03RunForTarget_(targetKey) {
  try {
    const target = v03ResolveRuntimeTarget_(targetKey);
    const lock = LockService.getScriptLock();
    if (!lock.tryLock(1)) {
      console.log('SKIPPED: collector lock already held; no writes performed.');
      return {run_status:'SKIPPED', reason:'LOCK_HELD'};
    }
    try {
      return v03Run_(target);
    } finally {
      lock.releaseLock();
    }
  } catch (e) {
    try {
      console.error(JSON.stringify({
        event:'COLLECTOR_RUN_UNCOMMITTED_FAILURE',
        collector_version:COLLECTOR_V03.VERSION,
        target_key:String(targetKey || ''),
        error_name:String(e && e.name ? e.name : 'Error'),
        error_message:String(e && e.message ? e.message : e),
        error_stack:String(e && e.stack ? e.stack : '')
      }));
    } catch (_) {
      // Logging failure must never replace the primary exception.
    }
    throw e;
  }
}

function v03ResolveRuntimeTarget_(targetKey) {
  const currentScriptId = ScriptApp.getScriptId();
  const targets = {
    DEV_TEST: {
      scriptId: COLLECTOR_V03.DEV_SCRIPT_ID,
      spreadsheetId: COLLECTOR_V03.TEST_SPREADSHEET_ID,
      triggerType: 'MANUAL_TEST',
      scopeRef: 'TEST:SOURCES enabled rows'
    },
    PRODUCTION: {
      scriptId: COLLECTOR_V03.PROD_SCRIPT_ID,
      spreadsheetId: COLLECTOR_V03.PROD_SPREADSHEET_ID,
      triggerType: 'MANUAL_PRODUCTION',
      scopeRef: 'PRODUCTION:SOURCES enabled rows'
    },
    PRODUCTION_SCHEDULED: {
      scriptId: COLLECTOR_V03.PROD_SCRIPT_ID,
      spreadsheetId: COLLECTOR_V03.PROD_SPREADSHEET_ID,
      triggerType: 'TIME_TRIGGER_HOURLY',
      scopeRef: 'PRODUCTION:SOURCES enabled rows'
    }
  };
  const target = targets[String(targetKey || '')];
  if (!target) throw v03Error_('RUNTIME_TARGET_INVALID', 'unknown runtime target=' + String(targetKey));
  if (currentScriptId !== target.scriptId) {
    throw v03Error_(
      'RUNTIME_TARGET_MISMATCH',
      'current script id does not match approved ' + String(targetKey) + ' target'
    );
  }
  return target;
}

function v03Run_(target) {
  const started = new Date();
  const ss = SpreadsheetApp.openById(target.spreadsheetId);
  const sourcesSheet = v03RequireSheet_(ss, COLLECTOR_V03.SOURCE_SHEET);
  const stateSheet = v03RequireSheet_(ss, COLLECTOR_V03.STATE_SHEET);
  const runsSheet = v03RequireSheet_(ss, COLLECTOR_V03.RUN_SHEET);
  const sourceRows = v03ObjectsFromSheet_(sourcesSheet).filter(r => v03Enabled_(r.enabled));
  const tx = v03BeginTransaction_(ss, stateSheet, runsSheet);
  const previousRunRef = v03LastRunIdFromSheet_(runsSheet);
  const runId = 'GAS-V03:RUN-' + Utilities.getUuid();
  const outcomes = [];

  sourceRows.forEach(source => {
    try {
      outcomes.push(v03CollectSource_(tx, source));
    } catch (e) {
      outcomes.push(v03RecordSourceFailure_(tx, source, e));
    }
  });

  const successCount = outcomes.filter(x => x.ok).length;
  const errorCount = outcomes.length - successCount;
  const runStatus = errorCount === 0 ? 'SUCCESS' : (successCount > 0 ? 'PARTIAL' : 'FAILED');
  const staleCount = v03CountStaleForSources_(tx, new Set(sourceRows.map(r => String(r.source_key))));
  const finished = new Date();

  v03QueueRunAppend_(tx, {
    run_id: runId,
    started_at: started.toISOString(),
    finished_at: finished.toISOString(),
    collector_version: COLLECTOR_V03.VERSION,
    trigger_type: target.triggerType,
    scope_ref: target.scopeRef,
    attempted_count: outcomes.length,
    success_count: successCount,
    error_count: errorCount,
    stale_count_after_run: staleCount,
    run_status: runStatus,
    error_summary: outcomes.filter(x => !x.ok).map(x => x.source_key + ':' + x.code).join('; '),
    next_cursor: '',
    previous_run_ref: previousRunRef
  });

  // Single atomic Google Sheets batchUpdate: either all queued state/run changes apply or none do.
  v03CommitTransaction_(tx);

  const result = {
    run_id:runId,
    run_status:runStatus,
    attempted_count:outcomes.length,
    success_count:successCount,
    error_count:errorCount,
    stale_count_after_run:staleCount
  };
  console.log(JSON.stringify(result));
  return result;
}

function v03CollectSource_(tx, source) {
  v03ValidateSource_(source);
  const kind = String(source.source_kind || '');
  const mode = String(source.collection_mode || 'METADATA');
  if (kind === 'FILE' && mode === 'BOUNDED_CONTENT') {
    if (String(source.selector || '') !== COLLECTOR_V03.OPERATIONS_BOARD_SELECTOR) {
      throw v03Error_(
        'UNSUPPORTED_BOUNDED_CONTENT_SELECTOR',
        'FILE BOUNDED_CONTENT requires exact approved selector'
      );
    }
    return v03CollectOperationsBoardHealth_(tx, source);
  }
  if (kind === 'FILE') return v03CollectFile_(tx, source);
  if (kind === 'SHEET_RANGE') return v03CollectSheetRange_(tx, source);
  if (kind === 'FOLDER_BOUNDED') return v03CollectFolder_(tx, source);
  if (kind === 'REGISTRY') return v03CollectRegistryFixture_(tx, source);
  throw v03Error_('UNSUPPORTED_SOURCE_KIND', 'unsupported source_kind=' + kind);
}

function v03ValidateSource_(s) {
  if (!s.source_key) throw v03Error_('MALFORMED_CONFIG','missing source_key');
  if (!s.source_kind) throw v03Error_('MALFORMED_CONFIG','missing source_kind');
  if (String(s.source_kind) !== 'REGISTRY' && !s.source_ref) {
    throw v03Error_('MALFORMED_CONFIG','missing source_ref');
  }
  const mins = Number(s.stale_after_minutes);
  if (!Number.isFinite(mins) || mins <= 0) throw v03Error_('MALFORMED_CONFIG','invalid stale_after_minutes');
}

function v03CollectFile_(tx, s) {
  const now = new Date().toISOString();
  let meta;
  try {
    meta = Drive.Files.get(String(s.source_ref), {
      fields:'id,name,mimeType,modifiedTime,version,trashed'
    });
  } catch (e) {
    // Drive returns the same 404 for true absence and lack of read access.
    // Therefore a failed get is never authoritative enough to assert MISSING.
    throw v03Error_('NOT_FOUND_OR_INACCESSIBLE',
      'exact FILE lookup failed; absence cannot be distinguished from access loss: ' +
      String(e && e.message ? e.message : e));
  }

  const identity = v03BaseIdentity_(s,'FILE',String(meta.id),String(meta.id));
  if (meta.trashed === true) {
    v03UpsertState_(tx, identity, {
      collected_at:now,
      collection_status:'NOT_FOUND',
      last_collection_success_at:now,
      last_collection_error_at:'',
      last_collection_error_code:'',
      last_collection_error:'',
      stale_after_minutes:Number(s.stale_after_minutes),
      stale_state:'FRESH',
      mechanical_signal:'MISSING',
      mechanical_signal_detail:'authoritative exact FILE metadata read reported trashed=true'
    });
    return {ok:true, source_key:String(s.source_key), code:'NOT_FOUND_TRASHED'};
  }

  if (s.expected_identity && String(meta.name) !== String(s.expected_identity)) {
    v03IdentityFailure_(tx, s, 'FILE', String(meta.id),
      'expected name "'+s.expected_identity+'" got "'+meta.name+'"');
    return {ok:false, source_key:String(s.source_key), code:'IDENTITY_MISMATCH'};
  }

  const key = 'STATE:' + s.source_key;
  const existing = v03FindUniqueState_(tx, key);
  const version = v03VersionSignal_(meta);
  const signal = existing && existing.source_version_signal && existing.source_version_signal !== version ? 'CHANGED' :
    (existing && existing.mechanical_signal === 'MISSING' ? 'CHANGED' : 'NONE');

  v03UpsertState_(tx, identity, {
    observed_name:String(meta.name||''),
    observed_mime_type:String(meta.mimeType||''),
    observed_modified_at:String(meta.modifiedTime||''),
    source_version_signal:version,
    collected_at:now,
    collection_status:'SUCCESS',
    last_collection_success_at:now,
    last_collection_error_at:'',
    last_collection_error_code:'',
    last_collection_error:'',
    stale_after_minutes:Number(s.stale_after_minutes),
    stale_state:'FRESH',
    mechanical_signal:signal,
    mechanical_signal_detail:signal === 'CHANGED' ? 'metadata version changed' : 'exact metadata read'
  });
  return {ok:true, source_key:String(s.source_key), code:'SUCCESS'};
}

function v03CollectOperationsBoardHealth_(tx, s) {
  if (String(s.source_ref) !== COLLECTOR_V03.OPERATIONS_BOARD_FILE_ID) {
    throw v03Error_(
      'OPERATIONS_BOARD_IDENTITY_MISMATCH',
      'approved OPERATIONS-BOARD parser is pinned to one exact file id'
    );
  }

  const now = new Date().toISOString();
  let meta;
  try {
    meta = Drive.Files.get(String(s.source_ref), {
      fields:'id,name,mimeType,modifiedTime,version,trashed,size'
    });
  } catch (e) {
    throw v03Error_(
      'NOT_FOUND_OR_INACCESSIBLE',
      'exact OPERATIONS-BOARD lookup failed: ' + String(e && e.message ? e.message : e)
    );
  }

  if (meta.trashed === true) {
    throw v03Error_('NOT_FOUND', 'exact OPERATIONS-BOARD is trashed');
  }
  if (s.expected_identity && String(meta.name) !== String(s.expected_identity)) {
    v03IdentityFailure_(tx, s, 'TASK_STATE_HEALTH', String(meta.id),
      'expected name "'+s.expected_identity+'" got "'+meta.name+'"');
    return {ok:false, source_key:String(s.source_key), code:'IDENTITY_MISMATCH'};
  }

  const declaredSize = Number(meta.size || 0);
  if (Number.isFinite(declaredSize) && declaredSize > COLLECTOR_V03.OPERATIONS_BOARD_MAX_BYTES) {
    throw v03Error_(
      'CONTENT_TOO_LARGE',
      'OPERATIONS-BOARD exceeds byte bound before content read: ' + declaredSize
    );
  }

  let blob;
  try {
    blob = DriveApp.getFileById(String(s.source_ref)).getBlob();
  } catch (e) {
    throw v03Error_(
      'CONTENT_READ_FAILED',
      'exact OPERATIONS-BOARD content read failed: ' + String(e && e.message ? e.message : e)
    );
  }
  const byteLength = blob.getBytes().length;
  if (byteLength > COLLECTOR_V03.OPERATIONS_BOARD_MAX_BYTES) {
    throw v03Error_(
      'CONTENT_TOO_LARGE',
      'OPERATIONS-BOARD exceeds byte bound after content read: ' + byteLength
    );
  }

  const text = blob.getDataAsString('UTF-8');
  const parsed = v03ParseOperationsBoardHealth_(text, {
    maxRows: COLLECTOR_V03.OPERATIONS_BOARD_MAX_ROWS,
    maxEligibleRows: COLLECTOR_V03.OPERATIONS_BOARD_MAX_ELIGIBLE_ROWS
  });
  const digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, text)
    .map(b => ('0'+((b<0?b+256:b).toString(16))).slice(-2)).join('');
  const version = 'board-sha256:' + digest;
  const stateKey = 'STATE:' + String(s.source_key);
  const existing = v03FindUniqueState_(tx, stateKey);
  const changed = Boolean(
    existing &&
    existing.source_version_signal &&
    String(existing.source_version_signal) !== version
  );
  const signal = parsed.healthy ? (changed ? 'CHANGED' : 'NONE') : 'HEALTH_FAIL';
  const detail = JSON.stringify({
    contract:'OPERATIONS_BOARD_STRUCTURAL_HEALTH_V1',
    scanned_rows:parsed.scannedRowCount,
    eligible_rows:parsed.eligibleRowCount,
    duplicate_ids:parsed.duplicateIds,
    invalid_rows:parsed.invalidRows,
  });

  v03UpsertState_(
    tx,
    v03BaseIdentity_(s, 'TASK_STATE_HEALTH', String(meta.id), String(meta.id)),
    {
      observed_name:String(meta.name||''),
      observed_mime_type:String(meta.mimeType||''),
      observed_modified_at:String(meta.modifiedTime||''),
      source_version_signal:version,
      collected_at:now,
      collection_status:'SUCCESS',
      last_collection_success_at:now,
      last_collection_error_at:'',
      last_collection_error_code:'',
      last_collection_error:'',
      stale_after_minutes:Number(s.stale_after_minutes),
      stale_state:'FRESH',
      mechanical_signal:signal,
      mechanical_signal_detail:detail
    }
  );

  return {
    ok:true,
    source_key:String(s.source_key),
    code:parsed.healthy ? 'SUCCESS' : 'STRUCTURAL_HEALTH_FAIL',
    structural_health:parsed
  };
}

function v03ParseOperationsBoardHealth_(text, options) {
  const opts = options || {};
  const maxRows = Number(opts.maxRows || COLLECTOR_V03.OPERATIONS_BOARD_MAX_ROWS);
  const maxEligibleRows = Number(
    opts.maxEligibleRows || COLLECTOR_V03.OPERATIONS_BOARD_MAX_ELIGIBLE_ROWS
  );
  if (!Number.isFinite(maxRows) || maxRows <= 0 ||
      !Number.isFinite(maxEligibleRows) || maxEligibleRows <= 0) {
    throw v03Error_('MALFORMED_CONFIG', 'invalid OPERATIONS-BOARD bounds');
  }

  const lines = String(text || '').replace(/\r\n?/g, '\n').split('\n');
  const expectedHeader = ['ID','優先','状態','実行','タスク'];
  const eligibleStates = new Set(['READY','ACTIVE','WATCH','HUMAN_WAIT']);
  const headerIndexes = [];
  lines.forEach((line, index) => {
    const cells = v03ParseMarkdownRow_(line);
    if (cells && cells.length === expectedHeader.length &&
        cells.every((cell, i) => cell === expectedHeader[i])) {
      headerIndexes.push(index);
    }
  });
  if (headerIndexes.length === 0) {
    throw v03Error_('BOARD_HEADER_MISSING', 'OPERATIONS-BOARD task table header not found');
  }
  if (headerIndexes.length !== 1) {
    throw v03Error_('BOARD_HEADER_AMBIGUOUS',
      'expected one OPERATIONS-BOARD task table header, got ' + headerIndexes.length);
  }

  const headerIndex = headerIndexes[0];
  const separator = v03ParseMarkdownRow_(lines[headerIndex + 1] || '');
  if (!separator || separator.length !== expectedHeader.length ||
      !separator.every(cell => /^:?-{3,}:?$/.test(cell))) {
    throw v03Error_('BOARD_SEPARATOR_INVALID', 'OPERATIONS-BOARD task table separator invalid');
  }

  const ids = [];
  const invalidRows = [];
  let scannedRowCount = 0;
  let eligibleRowCount = 0;

  for (let i = headerIndex + 2; i < lines.length; i++) {
    const raw = lines[i];
    if (!/^\s*\|/.test(raw)) break;
    scannedRowCount++;
    if (scannedRowCount > maxRows) {
      throw v03Error_('BOARD_ROW_LIMIT', 'OPERATIONS-BOARD task table scan bound exceeded');
    }

    const cells = v03ParseMarkdownRow_(raw);
    if (!cells || cells.length !== expectedHeader.length) {
      throw v03Error_(
        'BOARD_ROW_MALFORMED',
        'cannot determine bounded task subset because row has unexpected column count'
      );
    }

    const state = String(cells[2] || '').trim();
    if (!eligibleStates.has(state)) continue;

    eligibleRowCount++;
    const boundedRow = eligibleRowCount;
    const id = String(cells[0] || '').trim();
    if (!/^O-\d{3}$/.test(id)) {
      invalidRows.push({row:boundedRow, reason:id ? 'INVALID_ID' : 'MISSING_ID'});
    } else {
      ids.push(id);
    }

    if (eligibleRowCount >= maxEligibleRows) break;
  }

  if (eligibleRowCount === 0) {
    throw v03Error_(
      'BOARD_BOUNDED_SUBSET_EMPTY',
      'no READY/ACTIVE/WATCH/HUMAN_WAIT task rows found in bounded Board scan'
    );
  }

  const counts = {};
  ids.forEach(id => counts[id] = (counts[id] || 0) + 1);
  const duplicateIds = Object.keys(counts).filter(id => counts[id] > 1).sort();

  const boundedInvalidRows = invalidRows.slice(0, 20);
  return {
    healthy: duplicateIds.length === 0 && invalidRows.length === 0,
    scannedRowCount:scannedRowCount,
    eligibleRowCount:eligibleRowCount,
    duplicateIds:duplicateIds,
    invalidRows:boundedInvalidRows,
    truncatedIssues: invalidRows.length > boundedInvalidRows.length
  };
}

function v03ParseMarkdownRow_(line) {
  const raw = String(line || '').trim();
  if (!raw.startsWith('|')) return null;

  const cells = [];
  let current = '';
  let escaped = false;
  for (let i = 1; i < raw.length; i++) {
    const ch = raw[i];
    if (escaped) {
      current += ch;
      escaped = false;
      continue;
    }
    if (ch === '\\') {
      escaped = true;
      current += ch;
      continue;
    }
    if (ch === '|') {
      cells.push(current.trim().replace(/\\\|/g, '|'));
      current = '';
      continue;
    }
    current += ch;
  }

  if (current.trim()) cells.push(current.trim());
  if (cells.length && cells[cells.length - 1] === '') cells.pop();
  return cells;
}

function v03CollectSheetRange_(tx, s) {
  const now = new Date().toISOString();
  const selector = String(s.selector||'');
  if (!/^[^!]+![A-Z]+\d+(:[A-Z]+\d+)?$/i.test(selector)) {
    throw v03Error_('MALFORMED_CONFIG','selector must be bounded A1 range with sheet name');
  }
  const meta = Drive.Files.get(String(s.source_ref), {
    fields:'id,name,mimeType,modifiedTime,version,trashed'
  });
  if (meta.trashed) throw v03Error_('NOT_FOUND','spreadsheet is trashed');
  if (s.expected_identity && String(meta.name) !== String(s.expected_identity)) {
    v03IdentityFailure_(tx, s, 'SHEET_RANGE', selector,
      'expected name "'+s.expected_identity+'" got "'+meta.name+'"');
    return {ok:false, source_key:String(s.source_key), code:'IDENTITY_MISMATCH'};
  }

  const bang = selector.indexOf('!');
  const sheetName = selector.slice(0,bang);
  const a1 = selector.slice(bang+1);
  const target = SpreadsheetApp.openById(String(s.source_ref)).getSheetByName(sheetName);
  if (!target) throw v03Error_('NOT_FOUND','configured sheet tab not found: '+sheetName);
  const values = target.getRange(a1).getDisplayValues();
  const digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, JSON.stringify(values))
    .map(b => ('0'+((b<0?b+256:b).toString(16))).slice(-2)).join('');
  const version = 'range-sha256:' + digest;
  const key = 'STATE:' + s.source_key;
  const existing = v03FindUniqueState_(tx, key);
  const signal = existing && existing.source_version_signal && existing.source_version_signal !== version ? 'CHANGED' : 'NONE';

  v03UpsertState_(tx, v03BaseIdentity_(s,'SHEET_RANGE',selector,String(s.source_ref)), {
    observed_name:String(meta.name||'') + ' ' + selector,
    observed_mime_type:String(meta.mimeType||'application/vnd.google-apps.spreadsheet'),
    observed_modified_at:String(meta.modifiedTime||''),
    source_version_signal:version,
    collected_at:now,
    collection_status:'SUCCESS',
    last_collection_success_at:now,
    last_collection_error_at:'',
    last_collection_error_code:'',
    last_collection_error:'',
    stale_after_minutes:Number(s.stale_after_minutes),
    stale_state:'FRESH',
    mechanical_signal:signal,
    mechanical_signal_detail:signal === 'CHANGED' ? 'bounded range digest changed' : 'bounded range read'
  });
  return {ok:true, source_key:String(s.source_key), code:'SUCCESS'};
}

function v03CollectFolder_(tx, s) {
  const now = new Date().toISOString();
  const cfg = v03ParseFolderSelector_(String(s.selector||''));
  const folder = Drive.Files.get(String(s.source_ref), {
    fields:'id,name,mimeType,trashed'
  });
  if (folder.trashed || folder.mimeType !== 'application/vnd.google-apps.folder') {
    throw v03Error_('NOT_FOUND','configured folder unavailable');
  }

  // source_ref is the stable exact identity for FOLDER_BOUNDED.
  let token = null;
  let pages = 0;
  let incomplete = false;
  const files = [];

  do {
    const params = {
      q:"'"+String(s.source_ref)+"' in parents and trashed = false",
      pageSize:cfg.pageSize,
      fields:'nextPageToken,incompleteSearch,files(id,name,mimeType,modifiedTime,version)'
    };
    if (token) params.pageToken = token;
    const res = Drive.Files.list(params);
    pages++;
    if (res.incompleteSearch === true) incomplete = true;
    (res.files||[]).forEach(f => files.push(f));
    token = res.nextPageToken || null;
    if (pages >= COLLECTOR_V03.MAX_PAGES && token) {
      throw v03Error_('INCOMPLETE_ENUMERATION','pagination safety bound reached');
    }
  } while (token);

  if (incomplete) throw v03Error_('INCOMPLETE_ENUMERATION','Drive returned incompleteSearch=true');

  const ids = files.map(f => String(f.id));
  if (new Set(ids).size !== ids.length) throw v03Error_('DUPLICATE_ENTITY','duplicate file id in enumeration');
  if (cfg.fixtureCount !== null && ids.length !== cfg.fixtureCount) {
    throw v03Error_('INCOMPLETE_ENUMERATION','fixture_count expected '+cfg.fixtureCount+' got '+ids.length);
  }

  files.forEach(meta => {
    const stateKey = 'STATE:' + s.source_key + ':' + meta.id;
    const existing = v03FindUniqueState_(tx, stateKey);
    const version = v03VersionSignal_(meta);
    const signal = existing && existing.source_version_signal && existing.source_version_signal !== version ? 'CHANGED' :
      (existing && existing.mechanical_signal === 'MISSING' ? 'CHANGED' : 'NONE');

    v03UpsertState_(tx, {
      state_key:stateKey,
      source_key:String(s.source_key),
      entity_kind:'FILE',
      entity_key:String(meta.id),
      source_ref:String(meta.id),
      authority_ref:String(s.authority_ref||'')
    }, {
      observed_name:String(meta.name||''),
      observed_mime_type:String(meta.mimeType||''),
      observed_modified_at:String(meta.modifiedTime||''),
      source_version_signal:version,
      collected_at:now,
      collection_status:'SUCCESS',
      last_collection_success_at:now,
      last_collection_error_at:'',
      last_collection_error_code:'',
      last_collection_error:'',
      stale_after_minutes:Number(s.stale_after_minutes),
      stale_state:'FRESH',
      mechanical_signal:signal,
      mechanical_signal_detail:'complete non-recursive bounded folder listing'
    });
  });

  // Only after complete enumeration may prior known managed entities become MISSING.
  const seen = new Set(ids);
  v03ManagedFolderRows_(tx, String(s.source_key)).forEach(row => {
    if (!seen.has(String(row.entity_key))) {
      v03PatchExisting_(tx, row, {
        collected_at:now,
        collection_status:'NOT_FOUND',
        last_collection_success_at:now,
        last_collection_error_at:'',
        last_collection_error_code:'',
        last_collection_error:'',
        stale_after_minutes:Number(s.stale_after_minutes),
        stale_state:'FRESH',
        mechanical_signal:'MISSING',
        mechanical_signal_detail:'complete authoritative bounded folder listing proved absence'
      });
    }
  });

  return {
    ok:true,
    source_key:String(s.source_key),
    code:'SUCCESS',
    entities:files.length,
    pages:pages
  };
}

function v03CollectRegistryFixture_(tx, s) {
  if (String(s.source_ref) !== 'SYNTHETIC_AMBIGUOUS') {
    throw v03Error_('UNSUPPORTED_REGISTRY_ROUTE','only synthetic registry fixture allowed in v0.3');
  }
  const now = new Date().toISOString();
  v03UpsertState_(tx, v03BaseIdentity_(s,'REGISTRY','SYNTHETIC_AMBIGUOUS',''), {
    collected_at:now,
    collection_status:'AMBIGUOUS',
    last_collection_error_at:now,
    last_collection_error_code:'AMBIGUOUS_ROUTE',
    last_collection_error:'synthetic 2 eligible matches; no tie-break',
    stale_after_minutes:Number(s.stale_after_minutes),
    stale_state:'UNKNOWN',
    mechanical_signal:'ROUTE_INVALID',
    mechanical_signal_detail:'synthetic fail-closed route fixture'
  });
  return {ok:false, source_key:String(s.source_key), code:'AMBIGUOUS_ROUTE'};
}

function v03RecordSourceFailure_(tx, s, e) {
  const now = new Date().toISOString();
  const code = e && e.v03code ? e.v03code : 'COLLECTION_ERROR';
  const patch = {
    collection_status: code === 'IDENTITY_MISMATCH' ? 'IDENTITY_MISMATCH' : 'ERROR',
    last_collection_error_at:now,
    last_collection_error_code:code,
    last_collection_error:String(e && e.message ? e.message : e),
    stale_after_minutes:Number(s.stale_after_minutes)||60,
    stale_state:'UNKNOWN',
    mechanical_signal:code === 'IDENTITY_MISMATCH' ? 'ROUTE_INVALID' : 'HEALTH_FAIL',
    mechanical_signal_detail:'source-local failure; last-known facts preserved; no MISSING inference'
  };

  const targets = v03FailureTargets_(tx, s);
  if (targets.length) {
    targets.forEach(row => v03PatchExisting_(tx, row, patch));
  } else {
    const identity = v03BaseIdentity_(s, String(s.source_kind||'UNKNOWN'),
      String(s.source_ref||''), String(s.source_ref||''));
    v03UpsertState_(tx, identity, patch);
  }
  return {ok:false, source_key:String(s.source_key||'UNKNOWN'), code:code};
}

function v03FailureTargets_(tx, s) {
  const sourceKey = String(s.source_key||'');
  if (String(s.source_kind) === 'FOLDER_BOUNDED') {
    return tx.stateRows.filter(r =>
      String(r.source_key) === sourceKey &&
      String(r.entity_kind) === 'FILE' &&
      String(r.state_key).startsWith('STATE:'+sourceKey+':')
    );
  }
  return tx.stateRows.filter(r => String(r.state_key) === 'STATE:'+sourceKey);
}

function v03IdentityFailure_(tx, s, kind, entityKey, detail) {
  const now = new Date().toISOString();
  const key = 'STATE:' + s.source_key;
  const existing = v03FindUniqueState_(tx, key);
  const identity = existing ? {
    state_key:key,
    source_key:String(existing.source_key),
    entity_kind:String(existing.entity_kind),
    entity_key:String(existing.entity_key),
    source_ref:String(existing.source_ref),
    authority_ref:String(existing.authority_ref||'')
  } : v03BaseIdentity_(s,kind,entityKey,String(s.source_ref||''));

  v03UpsertState_(tx, identity, {
    collection_status:'IDENTITY_MISMATCH',
    last_collection_error_at:now,
    last_collection_error_code:'IDENTITY_MISMATCH',
    last_collection_error:detail,
    stale_after_minutes:Number(s.stale_after_minutes),
    stale_state:'UNKNOWN',
    mechanical_signal:'ROUTE_INVALID',
    mechanical_signal_detail:'stable identity preserved; observed target rejected'
  });
}

function v03BaseIdentity_(s, kind, entityKey, sourceRef) {
  return {
    state_key:'STATE:' + String(s.source_key),
    source_key:String(s.source_key),
    entity_kind:String(kind),
    entity_key:String(entityKey||''),
    source_ref:String(sourceRef||''),
    authority_ref:String(s.authority_ref||'')
  };
}

/* ---------- in-memory transaction + one atomic Sheets API commit ---------- */

function v03BeginTransaction_(ss, stateSheet, runsSheet) {
  const stateHeader = v03Header_(stateSheet);
  const runHeader = v03Header_(runsSheet);
  return {
    spreadsheetId:ss.getId(),
    stateSheetId:stateSheet.getSheetId(),
    runSheetId:runsSheet.getSheetId(),
    stateHeader:stateHeader,
    runHeader:runHeader,
    stateRows:v03ObjectsFromSheet_(stateSheet),
    dirtyCells:new Map(),
    newStateRows:[],
    runAppend:null
  };
}

function v03UpsertState_(tx, identity, patch) {
  const found = v03FindUniqueState_(tx, identity.state_key);
  if (found) {
    if (String(found.source_key) !== String(identity.source_key) ||
        String(found.entity_kind) !== String(identity.entity_kind) ||
        String(found.entity_key) !== String(identity.entity_key) ||
        String(found.source_ref||'') !== String(identity.source_ref||'') ||
        String(found.authority_ref||'') !== String(identity.authority_ref||'')) {
      throw v03Error_('IDENTITY_MISMATCH','stable state identity cannot be repurposed: '+identity.state_key);
    }
    v03PatchExisting_(tx, found, patch);
    return;
  }

  const row = {__row:null,__isNew:true};
  tx.stateHeader.forEach(h => row[h] = '');
  Object.assign(row, identity, patch);
  if ('judge_status' in row && !row.judge_status) row.judge_status = 'UNREVIEWED';
  tx.stateRows.push(row);
  tx.newStateRows.push(row);
}

function v03PatchExisting_(tx, row, patch) {
  const allowed = new Set([
    'observed_name','observed_mime_type','observed_modified_at','source_version_signal',
    'collected_at','collection_status','last_collection_success_at','last_collection_error_at',
    'last_collection_error_code','last_collection_error','stale_after_minutes','stale_state',
    'mechanical_signal','mechanical_signal_detail'
  ]);

  Object.keys(patch).forEach(k => {
    if (!allowed.has(k)) throw v03Error_('OWNERSHIP_VIOLATION','Collector attempted field '+k);
    const colIndex = tx.stateHeader.indexOf(k);
    if (colIndex < 0) throw v03Error_('SCHEMA_ERROR','missing state field '+k);
    row[k] = patch[k];
    if (!row.__isNew) {
      tx.dirtyCells.set(row.__row + ':' + colIndex, {
        rowNumber:row.__row,
        colIndex:colIndex,
        value:patch[k]
      });
    }
  });
}

function v03QueueRunAppend_(tx, values) {
  if (tx.runAppend) throw v03Error_('RUN_TRANSACTION_ERROR','run append already queued');
  const row = {};
  tx.runHeader.forEach(h => row[h] = values[h] === undefined ? '' : values[h]);
  tx.runAppend = row;
}

function v03CommitTransaction_(tx) {
  if (!tx.runAppend) throw v03Error_('RUN_TRANSACTION_ERROR','run append missing');
  const requests = [];

  [...tx.dirtyCells.values()]
    .sort((a,b) => a.rowNumber - b.rowNumber || a.colIndex - b.colIndex)
    .forEach(cell => {
      requests.push({
        updateCells:{
          range:{
            sheetId:tx.stateSheetId,
            startRowIndex:cell.rowNumber-1,
            endRowIndex:cell.rowNumber,
            startColumnIndex:cell.colIndex,
            endColumnIndex:cell.colIndex+1
          },
          rows:[{values:[v03CellData_(cell.value)]}],
          fields:'userEnteredValue'
        }
      });
    });

  tx.newStateRows.forEach(row => {
    requests.push({
      appendCells:{
        sheetId:tx.stateSheetId,
        rows:[{values:tx.stateHeader.map(h => v03CellData_(row[h]))}],
        fields:'userEnteredValue'
      }
    });
  });

  requests.push({
    appendCells:{
      sheetId:tx.runSheetId,
      rows:[{values:tx.runHeader.map(h => v03CellData_(tx.runAppend[h]))}],
      fields:'userEnteredValue'
    }
  });

  Sheets.Spreadsheets.batchUpdate({requests:requests}, tx.spreadsheetId);
}

function v03CellData_(value) {
  if (value === null || value === undefined) return {userEnteredValue:{stringValue:''}};
  if (typeof value === 'boolean') return {userEnteredValue:{boolValue:value}};
  if (typeof value === 'number' && Number.isFinite(value)) return {userEnteredValue:{numberValue:value}};
  return {userEnteredValue:{stringValue:String(value)}};
}

function v03ManagedFolderRows_(tx, sourceKey) {
  return tx.stateRows.filter(r =>
    String(r.source_key) === sourceKey &&
    String(r.entity_kind) === 'FILE' &&
    String(r.state_key).startsWith('STATE:'+sourceKey+':')
  );
}

function v03FindUniqueState_(tx, stateKey) {
  const matches = tx.stateRows.filter(r => String(r.state_key) === String(stateKey));
  if (matches.length > 1) throw v03Error_('DUPLICATE_STATE_KEY','duplicate state_key='+stateKey);
  return matches[0] || null;
}

function v03CountStaleForSources_(tx, keys) {
  return tx.stateRows.filter(r => keys.has(String(r.source_key)) &&
    (String(r.stale_state) === 'STALE' || String(r.stale_state) === 'UNKNOWN')).length;
}

/* ---------- read-only helpers ---------- */

function v03ObjectsFromSheet_(sheet) {
  const values = sheet.getDataRange().getValues();
  if (!values.length) return [];
  const header = values[0].map(String);
  return values.slice(1).map((row,i) => {
    const obj = {__row:i+2,__isNew:false};
    header.forEach((h,j) => obj[h] = row[j]);
    return obj;
  }).filter(r => Object.keys(r).some(k => !k.startsWith('__') && r[k] !== ''));
}

function v03LastRunIdFromSheet_(sheet) {
  const rows = v03ObjectsFromSheet_(sheet);
  return rows.length ? String(rows[rows.length-1].run_id||'') : '';
}

function v03Header_(sheet) {
  return sheet.getRange(1,1,1,sheet.getLastColumn()).getValues()[0].map(String);
}

function v03RequireSheet_(ss,name) {
  const s = ss.getSheetByName(name);
  if (!s) throw v03Error_('SCHEMA_ERROR','missing sheet '+name);
  return s;
}

function v03Enabled_(v) {
  return v === true || String(v).toUpperCase() === 'TRUE' || String(v) === '1';
}

function v03VersionSignal_(m) {
  return m.version ? 'version:'+String(m.version) : 'modified:'+String(m.modifiedTime||'');
}

function v03ParseFolderSelector_(text) {
  if (!/(^|;)\s*non_recursive\s*(;|$)/i.test(text)) {
    throw v03Error_('MALFORMED_CONFIG','FOLDER_BOUNDED requires non_recursive selector');
  }
  const p = /page_size\s*=\s*(\d+)/i.exec(text);
  const f = /fixture_count\s*=\s*(\d+)/i.exec(text);
  const pageSize = p ? Number(p[1]) : 100;
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 1000) {
    throw v03Error_('MALFORMED_CONFIG','invalid page_size');
  }
  return {pageSize:pageSize, fixtureCount:f ? Number(f[1]) : null};
}

function v03Error_(code,message) {
  const e = new Error(message);
  e.v03code = code;
  return e;
}
