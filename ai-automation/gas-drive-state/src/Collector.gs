/**
 * Phase 1 bounded TEST collector v0.3.
 * TEST spreadsheet only. No trigger creation. No production writes.
 */
const COLLECTOR_V03 = Object.freeze({
  VERSION: 'collector-v0.3',
  TEST_SPREADSHEET_ID: '1Lu7bqDpNtNsmZJsIGzah0T_mxABen6gEbqHqFZ7AKz0',
  SOURCE_SHEET: 'SOURCES',
  STATE_SHEET: 'DRIVE_STATE',
  RUN_SHEET: 'COLLECTION_RUNS',
  MAX_PAGES: 20
});

function runBoundedTestCollectorV03() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(1)) {
    console.log('SKIPPED: collector lock already held; no writes performed.');
    return {run_status:'SKIPPED', reason:'LOCK_HELD'};
  }
  try {
    return v03Run_();
  } finally {
    lock.releaseLock();
  }
}

function v03Run_() {
  const started = new Date();
  const ss = SpreadsheetApp.openById(COLLECTOR_V03.TEST_SPREADSHEET_ID);
  const sourcesSheet = v03RequireSheet_(ss, COLLECTOR_V03.SOURCE_SHEET);
  const stateSheet = v03RequireSheet_(ss, COLLECTOR_V03.STATE_SHEET);
  const runsSheet = v03RequireSheet_(ss, COLLECTOR_V03.RUN_SHEET);
  const sourceRows = v03Objects_(sourcesSheet).filter(r => v03Enabled_(r.enabled));
  const previousRunRef = v03LastRunId_(runsSheet);
  const runId = 'GAS-V03:RUN-' + Utilities.getUuid();
  const outcomes = [];

  sourceRows.forEach(source => {
    try {
      outcomes.push(v03CollectSource_(stateSheet, source));
    } catch (e) {
      outcomes.push(v03RecordSourceFailure_(stateSheet, source, e));
    }
  });

  const successCount = outcomes.filter(x => x.ok).length;
  const errorCount = outcomes.length - successCount;
  const runStatus = errorCount === 0 ? 'SUCCESS' : (successCount > 0 ? 'PARTIAL' : 'FAILED');
  const staleCount = v03CountStaleForSources_(stateSheet, new Set(sourceRows.map(r => String(r.source_key))));
  const finished = new Date();
  v03AppendRun_(runsSheet, {
    run_id: runId,
    started_at: started.toISOString(),
    finished_at: finished.toISOString(),
    collector_version: COLLECTOR_V03.VERSION,
    trigger_type: 'MANUAL_TEST',
    scope_ref: 'TEST:SOURCES enabled rows',
    attempted_count: outcomes.length,
    success_count: successCount,
    error_count: errorCount,
    stale_count_after_run: staleCount,
    run_status: runStatus,
    error_summary: outcomes.filter(x => !x.ok).map(x => x.source_key + ':' + x.code).join('; '),
    next_cursor: '',
    previous_run_ref: previousRunRef
  });
  const result = {run_id:runId, run_status:runStatus, attempted_count:outcomes.length,
    success_count:successCount, error_count:errorCount, stale_count_after_run:staleCount};
  console.log(JSON.stringify(result));
  return result;
}

function v03CollectSource_(stateSheet, source) {
  v03ValidateSource_(source);
  const kind = String(source.source_kind || '');
  if (kind === 'FILE') return v03CollectFile_(stateSheet, source);
  if (kind === 'SHEET_RANGE') return v03CollectSheetRange_(stateSheet, source);
  if (kind === 'FOLDER_BOUNDED') return v03CollectFolder_(stateSheet, source);
  if (kind === 'REGISTRY') return v03CollectRegistryFixture_(stateSheet, source);
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

function v03CollectFile_(stateSheet, s) {
  const now = new Date().toISOString();
  let meta;
  try {
    meta = Drive.Files.get(String(s.source_ref), {
      fields:'id,name,mimeType,modifiedTime,version,trashed'
    });
  } catch (e) {
    if (v03LooksNotFound_(e)) {
      v03UpsertState_(stateSheet, v03BaseIdentity_(s,'FILE',String(s.source_ref),String(s.source_ref)), {
        collected_at:now, collection_status:'NOT_FOUND', last_collection_success_at:now,
        last_collection_error_at:'', last_collection_error_code:'', last_collection_error:'',
        stale_after_minutes:Number(s.stale_after_minutes), stale_state:'FRESH',
        mechanical_signal:'MISSING', mechanical_signal_detail:'authoritative exact FILE lookup completed with NOT_FOUND'
      });
      return {ok:true, source_key:String(s.source_key), code:'NOT_FOUND_AUTHORITATIVE'};
    }
    throw e;
  }
  if (meta.trashed) throw v03Error_('NOT_FOUND','exact file is trashed');
  if (s.expected_identity && String(meta.name) !== String(s.expected_identity)) {
    v03IdentityFailure_(stateSheet, s, 'FILE', String(s.source_ref), 'expected name "'+s.expected_identity+'" got "'+meta.name+'"');
    return {ok:false, source_key:String(s.source_key), code:'IDENTITY_MISMATCH'};
  }
  const key = 'STATE:' + s.source_key;
  const existing = v03FindUniqueState_(stateSheet, key);
  const version = v03VersionSignal_(meta);
  const signal = existing && existing.source_version_signal && existing.source_version_signal !== version ? 'CHANGED' :
    (existing && existing.mechanical_signal === 'MISSING' ? 'CHANGED' : 'NONE');
  v03UpsertState_(stateSheet, v03BaseIdentity_(s,'FILE',String(meta.id),String(meta.id)), {
    observed_name:String(meta.name||''), observed_mime_type:String(meta.mimeType||''),
    observed_modified_at:String(meta.modifiedTime||''), source_version_signal:version,
    collected_at:now, collection_status:'SUCCESS', last_collection_success_at:now,
    last_collection_error_at:'', last_collection_error_code:'', last_collection_error:'',
    stale_after_minutes:Number(s.stale_after_minutes), stale_state:'FRESH',
    mechanical_signal:signal, mechanical_signal_detail: signal === 'CHANGED' ? 'metadata version changed' : 'exact metadata read'
  });
  return {ok:true, source_key:String(s.source_key), code:'SUCCESS'};
}

function v03CollectSheetRange_(stateSheet, s) {
  const now = new Date().toISOString();
  const selector = String(s.selector||'');
  if (!/^[^!]+![A-Z]+\d+(:[A-Z]+\d+)?$/i.test(selector)) {
    throw v03Error_('MALFORMED_CONFIG','selector must be bounded A1 range with sheet name');
  }
  const meta = Drive.Files.get(String(s.source_ref), {fields:'id,name,mimeType,modifiedTime,version,trashed'});
  if (meta.trashed) throw v03Error_('NOT_FOUND','spreadsheet is trashed');
  if (s.expected_identity && String(meta.name) !== String(s.expected_identity)) {
    v03IdentityFailure_(stateSheet, s, 'SHEET_RANGE', selector, 'expected name "'+s.expected_identity+'" got "'+meta.name+'"');
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
  const existing = v03FindUniqueState_(stateSheet, key);
  const signal = existing && existing.source_version_signal && existing.source_version_signal !== version ? 'CHANGED' : 'NONE';
  v03UpsertState_(stateSheet, v03BaseIdentity_(s,'SHEET_RANGE',selector,String(s.source_ref)), {
    observed_name:String(meta.name||'') + ' ' + selector,
    observed_mime_type:String(meta.mimeType||'application/vnd.google-apps.spreadsheet'),
    observed_modified_at:String(meta.modifiedTime||''), source_version_signal:version,
    collected_at:now, collection_status:'SUCCESS', last_collection_success_at:now,
    last_collection_error_at:'', last_collection_error_code:'', last_collection_error:'',
    stale_after_minutes:Number(s.stale_after_minutes), stale_state:'FRESH',
    mechanical_signal:signal, mechanical_signal_detail: signal === 'CHANGED' ? 'bounded range digest changed' : 'bounded range read'
  });
  return {ok:true, source_key:String(s.source_key), code:'SUCCESS'};
}

function v03CollectFolder_(stateSheet, s) {
  const now = new Date().toISOString();
  const cfg = v03ParseFolderSelector_(String(s.selector||''));
  const folder = Drive.Files.get(String(s.source_ref), {fields:'id,name,mimeType,trashed'});
  if (folder.trashed || folder.mimeType !== 'application/vnd.google-apps.folder') {
    throw v03Error_('NOT_FOUND','configured folder unavailable');
  }
  // For FOLDER_BOUNDED, the configured exact source_ref is the stable identity.
  // expected_identity may be a human-readable fixture label and is not used to rebind the exact folder ID.

  let token = null, pages = 0, incomplete = false;
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
    const existing = v03FindUniqueState_(stateSheet, stateKey);
    const version = v03VersionSignal_(meta);
    const signal = existing && existing.source_version_signal && existing.source_version_signal !== version ? 'CHANGED' :
      (existing && existing.mechanical_signal === 'MISSING' ? 'CHANGED' : 'NONE');
    v03UpsertState_(stateSheet, {
      state_key:stateKey, source_key:String(s.source_key), entity_kind:'FILE',
      entity_key:String(meta.id), source_ref:String(meta.id), authority_ref:String(s.authority_ref||'')
    }, {
      observed_name:String(meta.name||''), observed_mime_type:String(meta.mimeType||''),
      observed_modified_at:String(meta.modifiedTime||''), source_version_signal:version,
      collected_at:now, collection_status:'SUCCESS', last_collection_success_at:now,
      last_collection_error_at:'', last_collection_error_code:'', last_collection_error:'',
      stale_after_minutes:Number(s.stale_after_minutes), stale_state:'FRESH',
      mechanical_signal:signal, mechanical_signal_detail:'complete non-recursive bounded folder listing'
    });
  });

  const seen = new Set(ids);
  v03ManagedFolderRows_(stateSheet, String(s.source_key)).forEach(row => {
    if (!seen.has(String(row.entity_key))) {
      v03PatchExisting_(stateSheet, row.__row, {
        collected_at:now, collection_status:'NOT_FOUND', last_collection_success_at:now,
        last_collection_error_at:'', last_collection_error_code:'', last_collection_error:'',
        stale_after_minutes:Number(s.stale_after_minutes), stale_state:'FRESH',
        mechanical_signal:'MISSING', mechanical_signal_detail:'complete authoritative bounded folder listing proved absence'
      });
    }
  });
  return {ok:true, source_key:String(s.source_key), code:'SUCCESS', entities:files.length, pages:pages};
}

function v03CollectRegistryFixture_(stateSheet, s) {
  if (String(s.source_ref) !== 'SYNTHETIC_AMBIGUOUS') throw v03Error_('UNSUPPORTED_REGISTRY_ROUTE','only synthetic registry fixture allowed in v0.3');
  const now = new Date().toISOString();
  v03UpsertState_(stateSheet, v03BaseIdentity_(s,'REGISTRY','SYNTHETIC_AMBIGUOUS',''), {
    collected_at:now, collection_status:'AMBIGUOUS',
    last_collection_error_at:now, last_collection_error_code:'AMBIGUOUS_ROUTE',
    last_collection_error:'synthetic 2 eligible matches; no tie-break',
    stale_after_minutes:Number(s.stale_after_minutes), stale_state:'UNKNOWN',
    mechanical_signal:'ROUTE_INVALID', mechanical_signal_detail:'synthetic fail-closed route fixture'
  });
  return {ok:false, source_key:String(s.source_key), code:'AMBIGUOUS_ROUTE'};
}

function v03RecordSourceFailure_(stateSheet, s, e) {
  const now = new Date().toISOString();
  const code = e && e.v03code ? e.v03code : 'COLLECTION_ERROR';
  const key = 'STATE:' + String(s.source_key||'UNKNOWN');
  const existing = v03FindUniqueState_(stateSheet, key);
  const identity = existing ? {
    state_key:key, source_key:String(existing.source_key||s.source_key||'UNKNOWN'),
    entity_kind:String(existing.entity_kind||s.source_kind||'UNKNOWN'),
    entity_key:String(existing.entity_key||s.source_ref||''),
    source_ref:String(existing.source_ref||s.source_ref||''),
    authority_ref:String(existing.authority_ref||s.authority_ref||'')
  } : v03BaseIdentity_(s, String(s.source_kind||'UNKNOWN'), String(s.source_ref||''), String(s.source_ref||''));
  v03UpsertState_(stateSheet, identity, {
    collection_status: code === 'IDENTITY_MISMATCH' ? 'IDENTITY_MISMATCH' : 'ERROR',
    last_collection_error_at:now, last_collection_error_code:code,
    last_collection_error:String(e && e.message ? e.message : e),
    stale_after_minutes:Number(s.stale_after_minutes)||60, stale_state:'UNKNOWN',
    mechanical_signal: code === 'IDENTITY_MISMATCH' ? 'ROUTE_INVALID' : 'HEALTH_FAIL',
    mechanical_signal_detail:'source-local failure; last-known facts preserved'
  });
  return {ok:false, source_key:String(s.source_key||'UNKNOWN'), code:code};
}

function v03IdentityFailure_(stateSheet, s, kind, entityKey, detail) {
  const now = new Date().toISOString();
  const key = 'STATE:' + s.source_key;
  const existing = v03FindUniqueState_(stateSheet, key);
  const identity = existing ? {
    state_key:key, source_key:String(existing.source_key), entity_kind:String(existing.entity_kind),
    entity_key:String(existing.entity_key), source_ref:String(existing.source_ref),
    authority_ref:String(existing.authority_ref||'')
  } : v03BaseIdentity_(s,kind,entityKey,String(s.source_ref||''));
  v03UpsertState_(stateSheet, identity, {
    collection_status:'IDENTITY_MISMATCH', last_collection_error_at:now,
    last_collection_error_code:'IDENTITY_MISMATCH', last_collection_error:detail,
    stale_after_minutes:Number(s.stale_after_minutes), stale_state:'UNKNOWN',
    mechanical_signal:'ROUTE_INVALID', mechanical_signal_detail:'stable identity preserved; observed target rejected'
  });
}

function v03BaseIdentity_(s, kind, entityKey, sourceRef) {
  return {
    state_key:'STATE:' + String(s.source_key), source_key:String(s.source_key),
    entity_kind:String(kind), entity_key:String(entityKey||''),
    source_ref:String(sourceRef||''), authority_ref:String(s.authority_ref||'')
  };
}

function v03UpsertState_(sheet, identity, patch) {
  const found = v03FindUniqueState_(sheet, identity.state_key);
  if (found) {
    if (String(found.source_key) !== String(identity.source_key) ||
        String(found.entity_kind) !== String(identity.entity_kind) ||
        String(found.entity_key) !== String(identity.entity_key)) {
      throw v03Error_('IDENTITY_MISMATCH','stable state_key cannot be repurposed: '+identity.state_key);
    }
    v03PatchExisting_(sheet, found.__row, patch);
    return;
  }
  const header = v03Header_(sheet);
  const row = {};
  header.forEach(h => row[h] = '');
  Object.assign(row, identity, patch);
  if ('judge_status' in row && !row.judge_status) row.judge_status = 'UNREVIEWED';
  sheet.appendRow(header.map(h => row[h] === undefined ? '' : row[h]));
}

function v03PatchExisting_(sheet, rowNumber, patch) {
  const header = v03Header_(sheet);
  const allowed = new Set([
    'observed_name','observed_mime_type','observed_modified_at','source_version_signal',
    'collected_at','collection_status','last_collection_success_at','last_collection_error_at',
    'last_collection_error_code','last_collection_error','stale_after_minutes','stale_state',
    'mechanical_signal','mechanical_signal_detail'
  ]);
  Object.keys(patch).forEach(k => {
    if (!allowed.has(k)) throw v03Error_('OWNERSHIP_VIOLATION','Collector attempted field '+k);
    const col = header.indexOf(k);
    if (col < 0) throw v03Error_('SCHEMA_ERROR','missing state field '+k);
    sheet.getRange(rowNumber,col+1).setValue(patch[k]);
  });
}

function v03ManagedFolderRows_(sheet, sourceKey) {
  return v03Objects_(sheet).filter(r =>
    String(r.source_key) === sourceKey &&
    String(r.entity_kind) === 'FILE' &&
    String(r.state_key).startsWith('STATE:'+sourceKey+':')
  );
}

function v03FindUniqueState_(sheet, stateKey) {
  const matches = v03Objects_(sheet).filter(r => String(r.state_key) === String(stateKey));
  if (matches.length > 1) throw v03Error_('DUPLICATE_STATE_KEY','duplicate state_key='+stateKey);
  return matches[0] || null;
}

function v03CountStaleForSources_(sheet, keys) {
  return v03Objects_(sheet).filter(r => keys.has(String(r.source_key)) &&
    (String(r.stale_state) === 'STALE' || String(r.stale_state) === 'UNKNOWN')).length;
}

function v03AppendRun_(sheet, values) {
  const header = v03Header_(sheet);
  sheet.appendRow(header.map(h => values[h] === undefined ? '' : values[h]));
}

function v03LastRunId_(sheet) {
  const rows = v03Objects_(sheet);
  return rows.length ? String(rows[rows.length-1].run_id||'') : '';
}

function v03Objects_(sheet) {
  const values = sheet.getDataRange().getValues();
  if (!values.length) return [];
  const header = values[0].map(String);
  return values.slice(1).map((row,i) => {
    const obj = {__row:i+2};
    header.forEach((h,j) => obj[h] = row[j]);
    return obj;
  }).filter(r => Object.keys(r).some(k => k !== '__row' && r[k] !== ''));
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
  if (!/(^|;)\s*non_recursive\s*(;|$)/i.test(text)) throw v03Error_('MALFORMED_CONFIG','FOLDER_BOUNDED requires non_recursive selector');
  const p = /page_size\s*=\s*(\d+)/i.exec(text);
  const f = /fixture_count\s*=\s*(\d+)/i.exec(text);
  const pageSize = p ? Number(p[1]) : 100;
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 1000) throw v03Error_('MALFORMED_CONFIG','invalid page_size');
  return {pageSize:pageSize, fixtureCount:f ? Number(f[1]) : null};
}
function v03LooksNotFound_(e) {
  const t = String(e && e.message ? e.message : e);
  return /not found|File not found|404/i.test(t);
}
function v03Error_(code,message) {
  const e = new Error(message);
  e.v03code = code;
  return e;
}
