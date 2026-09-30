/**
 * Runtime Health Pack v0.1 — DEV-first structural health parsers.
 *
 * M1 boundary:
 * - exact Scheduled Work / Site Research spreadsheets are READ-ONLY inputs;
 * - no Production SOURCES edit, Production deployment, trigger mutation, or consumer cutover;
 * - incomplete/unknown coverage must never serialize as healthy.
 */
const RUNTIME_HEALTH_V01 = Object.freeze({
  VERSION: 'runtime-health-pack-v0.1.1',
  MAX_ISSUES: 20,
  SCHEDULED_WORK: Object.freeze({
    runtimeKey: 'SCHEDULED_WORK',
    selector: 'SCHEDULED_WORK_STRUCTURAL_HEALTH_V1',
    spreadsheetId: '1HuJKzPBdgiiNWAgaO-UQQXZxVSp3wAFAoCfRry2Ih5o',
    expectedIdentity: 'RUNTIME｜Scheduled Work Read-Plan v0.1',
    tabs: Object.freeze({
      CONTROL: Object.freeze({
        maxRows: 1000,
        headers: Object.freeze(['key','value','note'])
      }),
      TEMPLATE_REGISTRY: Object.freeze({
        maxRows: 1000,
        headers: Object.freeze([
          'template_key','template_version','status','definition_file_id',
          'required_terminal_fields','source_freshness_rule','output_store_ref','notes'
        ])
      }),
      QUEUE: Object.freeze({
        maxRows: 1000,
        headers: Object.freeze([
          'job_id','dedupe_key','template_key','template_version','priority','queue_order',
          'status','attempt_no','retry_budget','retry_eligible','claim_token','claim_started_at',
          'source_locator','payload_ref','output_store_ref','result_ref','result_summary',
          'observed_count','unknown_count','completion_check','result_readback','failure_class',
          'next_eligible_at','human_gate','runner_note'
        ])
      }),
      RUN_LOG: Object.freeze({
        maxRows: 1000,
        headers: Object.freeze([
          'run_id','job_id','attempt_no','template_key','template_version',
          'started_at_provider','finished_at_provider','outcome','failure_class',
          'claim_token','result_ref','result_readback','source_freshness_status',
          'duplicate_guard','terminal_validation','network_or_tool_error','runner_version','note'
        ])
      })
    }),
    controlExpectations: Object.freeze({
      schema_version: 'scheduled-work-read-plan-v0.1',
      runtime_status: 'READY',
      runner_contract_id: '1kwNEUwA942t60sUq37CmqvzPaZtXznR6UFhxexFuSts',
      authorized_runner_id: 'BUILD_SMOKE_RUNNER',
      source_policy: 'READ_ONLY',
      worker_write_scope: 'WORKER_OWNED_ONLY',
      stale_inflight_policy: 'STOP_AND_HEALTH_RECOVERY',
      terminal_policy: 'STRUCTURAL_VALIDATOR_REQUIRED',
      duplicate_policy: 'DEDUPE_KEY_UNIQUE_NONCANCELLED',
      concurrency_policy: 'SINGLE_ACTIVE_DISPATCHER_STOP_ON_INFLIGHT'
    })
  }),
  SITE_RESEARCH: Object.freeze({
    runtimeKey: 'SITE_RESEARCH',
    selector: 'SITE_RESEARCH_STRUCTURAL_HEALTH_V1',
    spreadsheetId: '143VnsXXg4dPDsmxg0E3pm1NZJnSDCKIkrzjkPFu5M9k',
    expectedIdentity: 'CANDIDATE｜Site Research Runtime v0.1｜2026-09-25',
    tabs: Object.freeze({
      CONTROL: Object.freeze({
        maxRows: 50,
        headers: Object.freeze(['key','value','note'])
      }),
      QUEUE: Object.freeze({
        maxRows: 200,
        headers: Object.freeze([
          'item_id','queue_order','status','target','question','source_plan','read_scope',
          'expected_evidence','stop_condition','provider_call_budget','human_gate',
          'result_summary','evidence_ref','blocked_reason','updated_at','notes'
        ])
      }),
      RUNS: Object.freeze({
        maxRows: 500,
        headers: Object.freeze([
          'cycle_counter','lane','item_id','outcome','provider','provider_calls',
          'stop_reason','human_attention','summary','recorded_at_optional'
        ])
      })
    }),
    controlExpectations: Object.freeze({
      schema_version: 'site-research-runtime-v0.2-production'
    })
  })
});

function v03CollectRuntimeHealth_(tx, source) {
  const config = v03RuntimeHealthConfigForSource_(source);
  const now = new Date().toISOString();
  let meta;
  try {
    meta = Drive.Files.get(String(source.source_ref), {
      fields: 'id,name,mimeType,modifiedTime,version,trashed'
    });
  } catch (e) {
    throw v03Error_(
      'NOT_FOUND_OR_INACCESSIBLE',
      'exact runtime spreadsheet lookup failed: ' + String(e && e.message ? e.message : e)
    );
  }

  if (meta.trashed === true) {
    throw v03Error_('NOT_FOUND', 'exact runtime spreadsheet is trashed');
  }
  if (String(meta.mimeType || '') !== 'application/vnd.google-apps.spreadsheet') {
    throw v03Error_('RUNTIME_MIME_MISMATCH', 'runtime source is not a Google Sheet');
  }
  if (source.expected_identity && String(meta.name) !== String(source.expected_identity)) {
    v03IdentityFailure_(
      tx,
      source,
      'RUNTIME_HEALTH',
      String(config.selector),
      'expected name "' + source.expected_identity + '" got "' + meta.name + '"'
    );
    return {ok:false, source_key:String(source.source_key), code:'IDENTITY_MISMATCH'};
  }
  if (String(meta.name || '') !== String(config.expectedIdentity)) {
    throw v03Error_(
      'RUNTIME_IDENTITY_MISMATCH',
      'runtime title differs from pinned contract identity'
    );
  }

  const snapshot = v03ReadRuntimeHealthSnapshot_(config, meta);
  const parsed = v03EvaluateRuntimeHealthSnapshot_(config.runtimeKey, snapshot);
  const digestInput = JSON.stringify(v03RuntimeSnapshotDigestPayload_(snapshot));
  const digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, digestInput)
    .map(b => ('0' + ((b < 0 ? b + 256 : b).toString(16))).slice(-2))
    .join('');
  const version = 'runtime-sha256:' + digest;
  const stateKey = 'STATE:' + String(source.source_key);
  const existing = v03FindUniqueState_(tx, stateKey);
  const changed = Boolean(
    existing &&
    existing.source_version_signal &&
    String(existing.source_version_signal) !== version
  );
  const signal = parsed.healthy ? (changed ? 'CHANGED' : 'NONE') : 'HEALTH_FAIL';
  const detail = JSON.stringify({
    contract: config.selector,
    runtime_health_version: RUNTIME_HEALTH_V01.VERSION,
    coverage_complete: parsed.coverage_complete,
    coverage: parsed.coverage,
    metrics: parsed.metrics,
    issues: parsed.issues,
    truncated_issues: parsed.truncated_issues
  });

  v03UpsertState_(
    tx,
    v03BaseIdentity_(source, 'RUNTIME_HEALTH', String(config.selector), String(meta.id)),
    {
      observed_name: String(meta.name || ''),
      observed_mime_type: String(meta.mimeType || ''),
      observed_modified_at: String(meta.modifiedTime || ''),
      source_version_signal: version,
      collected_at: now,
      collection_status: 'SUCCESS',
      last_collection_success_at: now,
      last_collection_error_at: '',
      last_collection_error_code: '',
      last_collection_error: '',
      stale_after_minutes: Number(source.stale_after_minutes),
      stale_state: 'FRESH',
      mechanical_signal: signal,
      mechanical_signal_detail: detail
    }
  );

  return {
    ok: true,
    source_key: String(source.source_key),
    code: parsed.healthy ? 'SUCCESS' : 'STRUCTURAL_HEALTH_FAIL',
    structural_health: parsed
  };
}

function v03RuntimeHealthConfigForSource_(source) {
  const selector = String(source.selector || '');
  const sourceRef = String(source.source_ref || '');
  const configs = [RUNTIME_HEALTH_V01.SCHEDULED_WORK, RUNTIME_HEALTH_V01.SITE_RESEARCH];
  const matches = configs.filter(config => config.selector === selector);
  if (matches.length !== 1) {
    throw v03Error_(
      'RUNTIME_HEALTH_SELECTOR_INVALID',
      'STRUCTURAL_HEALTH requires one exact approved runtime selector'
    );
  }
  const config = matches[0];
  if (sourceRef !== config.spreadsheetId) {
    throw v03Error_(
      'RUNTIME_HEALTH_SOURCE_ID_MISMATCH',
      'runtime parser selector is pinned to one exact spreadsheet ID'
    );
  }
  return config;
}

function v03ReadRuntimeHealthSnapshot_(config, beforeMeta) {
  const ss = SpreadsheetApp.openById(config.spreadsheetId);
  const first = v03ReadRuntimeTabsOnce_(ss, config, null);
  const second = v03ReadRuntimeTabsOnce_(ss, config, first);
  const afterMeta = Drive.Files.get(String(config.spreadsheetId), {
    fields: 'id,name,mimeType,modifiedTime,version,trashed'
  });

  v03AssertRuntimeSnapshotCoherence_(config, beforeMeta, first, second, afterMeta);

  return {
    runtimeKey: config.runtimeKey,
    spreadsheetId: config.spreadsheetId,
    sourceVersionToken: v03RuntimeSourceVersionToken_(afterMeta),
    tabs: second
  };
}

function v03ReadRuntimeTabsOnce_(ss, config, previousTabs) {
  const tabs = {};

  Object.keys(config.tabs).forEach(tabName => {
    const tabConfig = config.tabs[tabName];
    const sheet = ss.getSheetByName(tabName);
    if (!sheet) {
      throw v03Error_('RUNTIME_TAB_MISSING', config.runtimeKey + ' missing tab ' + tabName);
    }

    const lastRow = sheet.getLastRow();
    const lastColumn = sheet.getLastColumn();
    const prior = previousTabs && previousTabs[tabName];

    if (prior &&
        (Number(prior.lastRow) !== Number(lastRow) ||
         Number(prior.lastColumn) !== Number(lastColumn))) {
      throw v03Error_(
        'RUNTIME_SOURCE_CHANGED_DURING_READ',
        config.runtimeKey + ' ' + tabName + ' extent changed during bounded snapshot'
      );
    }

    if (lastRow < 1) {
      throw v03Error_('RUNTIME_HEADER_MISSING', config.runtimeKey + ' ' + tabName + ' is empty');
    }
    if (lastRow > tabConfig.maxRows) {
      throw v03Error_(
        'RUNTIME_ROW_LIMIT',
        config.runtimeKey + ' ' + tabName + ' lastRow=' + lastRow +
          ' exceeds declared bound=' + tabConfig.maxRows
      );
    }
    if (lastColumn !== tabConfig.headers.length) {
      throw v03Error_(
        'RUNTIME_SCHEMA_WIDTH_MISMATCH',
        config.runtimeKey + ' ' + tabName + ' lastColumn=' + lastColumn +
          ' expected=' + tabConfig.headers.length
      );
    }

    const values = sheet.getRange(1, 1, lastRow, tabConfig.headers.length).getDisplayValues();
    tabs[tabName] = {
      lastRow: lastRow,
      lastColumn: lastColumn,
      values: values
    };
  });

  return tabs;
}

function v03AssertRuntimeSnapshotCoherence_(config, beforeMeta, firstTabs, secondTabs, afterMeta) {
  if (!beforeMeta || !afterMeta) {
    throw v03Error_(
      'RUNTIME_COHERENCE_EVIDENCE_MISSING',
      config.runtimeKey + ' source metadata fence missing'
    );
  }

  const beforeToken = v03RuntimeSourceVersionToken_(beforeMeta);
  const afterToken = v03RuntimeSourceVersionToken_(afterMeta);
  if (!beforeToken || !afterToken || beforeToken !== afterToken) {
    throw v03Error_(
      'RUNTIME_SOURCE_CHANGED_DURING_READ',
      config.runtimeKey + ' source version/modifiedTime changed during bounded snapshot'
    );
  }

  Object.keys(config.tabs).forEach(tabName => {
    const first = firstTabs && firstTabs[tabName];
    const second = secondTabs && secondTabs[tabName];
    if (!first || !second) {
      throw v03Error_(
        'RUNTIME_COHERENCE_EVIDENCE_MISSING',
        config.runtimeKey + ' missing repeated-read evidence for ' + tabName
      );
    }
    if (Number(first.lastRow) !== Number(second.lastRow) ||
        Number(first.lastColumn) !== Number(second.lastColumn)) {
      throw v03Error_(
        'RUNTIME_SOURCE_CHANGED_DURING_READ',
        config.runtimeKey + ' ' + tabName + ' extent changed during bounded snapshot'
      );
    }
    if (JSON.stringify(first.values) !== JSON.stringify(second.values)) {
      throw v03Error_(
        'RUNTIME_SOURCE_CHANGED_DURING_READ',
        config.runtimeKey + ' ' + tabName + ' values changed during bounded snapshot'
      );
    }
  });
}

function v03RuntimeSourceVersionToken_(meta) {
  if (!meta) return '';
  const id = String(meta.id || '');
  const modified = String(meta.modifiedTime || '');
  const version = String(meta.version || '');
  if (!id || (!modified && !version)) return '';
  return id + '|modified=' + modified + '|version=' + version;
}

function v03EvaluateRuntimeHealthSnapshot_(runtimeKey, snapshot) {
  const config = v03RuntimeHealthConfigByKey_(runtimeKey);
  const coverage = {};
  Object.keys(config.tabs).forEach(tabName => {
    coverage[tabName] = v03ValidateRuntimeTabCoverage_(
      runtimeKey,
      tabName,
      snapshot && snapshot.tabs ? snapshot.tabs[tabName] : null,
      config.tabs[tabName]
    );
  });

  v03ValidateRuntimeControlExpectations_(runtimeKey, snapshot.tabs.CONTROL, config);
  const evaluated = runtimeKey === 'SCHEDULED_WORK'
    ? v03EvaluateScheduledWorkHealth_(snapshot)
    : v03EvaluateSiteResearchHealth_(snapshot);

  return {
    healthy: evaluated.healthy,
    coverage_complete: true,
    coverage: coverage,
    metrics: evaluated.metrics,
    issues: evaluated.issues,
    truncated_issues: evaluated.truncated_issues
  };
}

function v03RuntimeHealthConfigByKey_(runtimeKey) {
  if (runtimeKey === 'SCHEDULED_WORK') return RUNTIME_HEALTH_V01.SCHEDULED_WORK;
  if (runtimeKey === 'SITE_RESEARCH') return RUNTIME_HEALTH_V01.SITE_RESEARCH;
  throw v03Error_('RUNTIME_HEALTH_KEY_INVALID', 'unknown runtime key=' + String(runtimeKey));
}

function v03ValidateRuntimeTabCoverage_(runtimeKey, tabName, tabSnapshot, tabConfig) {
  if (!tabSnapshot) {
    throw v03Error_('RUNTIME_TAB_MISSING', runtimeKey + ' snapshot missing tab ' + tabName);
  }

  const lastRow = Number(tabSnapshot.lastRow);
  const lastColumn = Number(tabSnapshot.lastColumn);
  if (!Number.isFinite(lastRow) || lastRow < 1) {
    throw v03Error_('RUNTIME_HEADER_MISSING', runtimeKey + ' ' + tabName + ' has no header row');
  }
  if (lastRow > tabConfig.maxRows) {
    throw v03Error_(
      'RUNTIME_ROW_LIMIT',
      runtimeKey + ' ' + tabName + ' coverage exceeds declared row bound'
    );
  }
  if (lastColumn !== tabConfig.headers.length) {
    throw v03Error_(
      'RUNTIME_SCHEMA_WIDTH_MISMATCH',
      runtimeKey + ' ' + tabName + ' column extent differs from expected schema'
    );
  }

  const values = tabSnapshot.values;
  if (!Array.isArray(values) || values.length !== lastRow) {
    throw v03Error_(
      'RUNTIME_TRUNCATED_READ',
      runtimeKey + ' ' + tabName + ' returned row count differs from declared extent'
    );
  }
  for (let i = 0; i < values.length; i++) {
    if (!Array.isArray(values[i]) || values[i].length !== lastColumn) {
      throw v03Error_(
        'RUNTIME_TRUNCATED_READ',
        runtimeKey + ' ' + tabName + ' returned column count differs at row ' + (i + 1)
      );
    }
  }

  const actualHeader = values[0].map(v => String(v || '').trim());
  const expectedHeader = tabConfig.headers.slice();
  if (JSON.stringify(actualHeader) !== JSON.stringify(expectedHeader)) {
    throw v03Error_(
      'RUNTIME_HEADER_MISMATCH',
      runtimeKey + ' ' + tabName + ' required header mismatch'
    );
  }

  return {
    complete: true,
    scanned_rows: lastRow,
    data_rows: Math.max(0, lastRow - 1),
    scanned_columns: lastColumn,
    row_bound: tabConfig.maxRows
  };
}

function v03ValidateRuntimeControlExpectations_(runtimeKey, controlSnapshot, config) {
  const rows = v03RuntimeRowsAsObjects_(controlSnapshot);
  const byKey = {};
  rows.forEach(row => {
    const key = String(row.key || '').trim();
    if (!key) return;
    if (Object.prototype.hasOwnProperty.call(byKey, key)) {
      throw v03Error_(
        'RUNTIME_CONTROL_DUPLICATE_KEY',
        runtimeKey + ' CONTROL duplicate key=' + key
      );
    }
    byKey[key] = String(row.value || '').trim();
  });

  Object.keys(config.controlExpectations || {}).forEach(key => {
    if (!Object.prototype.hasOwnProperty.call(byKey, key)) {
      throw v03Error_(
        'RUNTIME_SCHEMA_MARKER_MISSING',
        runtimeKey + ' CONTROL missing required marker=' + key
      );
    }
    if (byKey[key] !== String(config.controlExpectations[key])) {
      throw v03Error_(
        'RUNTIME_SCHEMA_MARKER_MISMATCH',
        runtimeKey + ' CONTROL ' + key + '=' + byKey[key] +
          ' expected=' + String(config.controlExpectations[key])
      );
    }
  });
}

function v03EvaluateScheduledWorkHealth_(snapshot) {
  const queue = v03RuntimeRowsAsObjects_(snapshot.tabs.QUEUE);
  const templates = v03RuntimeRowsAsObjects_(snapshot.tabs.TEMPLATE_REGISTRY);
  const allowedStatuses = new Set([
    'READY','PARTIAL','WORKING','VERIFYING',
    'DONE','HUMAN_GATE','BLOCKED_SAFE','CANCELLED'
  ]);
  const inflightStatuses = new Set(['WORKING','VERIFYING']);
  const terminalStatuses = new Set(['DONE','HUMAN_GATE','BLOCKED_SAFE','CANCELLED']);

  const duplicateJobIds = v03RuntimeDuplicateValues_(queue, 'job_id');
  const duplicateDedupeKeys = v03RuntimeDuplicateValues_(
    queue.filter(row => String(row.status || '').trim() !== 'CANCELLED'),
    'dedupe_key'
  );
  const invalidRows = [];
  const invalidStatuses = [];
  const malformedInflight = [];
  const terminalValidationMismatches = [];
  const queueTemplateMismatches = [];
  const inflightRows = [];

  const templateEvaluation = v03EvaluateScheduledTemplateRegistry_(templates);
  const validTemplateKeys = templateEvaluation.validTemplateKeys;

  queue.forEach((row, index) => {
    const rowNo = Number(row.__row || (index + 2));
    const jobId = String(row.job_id || '').trim();
    const dedupeKey = String(row.dedupe_key || '').trim();
    const templateKey = String(row.template_key || '').trim();
    const templateVersion = String(row.template_version || '').trim();
    const status = String(row.status || '').trim();

    if (!jobId || !dedupeKey || !status || !templateKey || !templateVersion) {
      invalidRows.push({
        row: rowNo,
        reason: !jobId ? 'MISSING_JOB_ID' :
          (!dedupeKey ? 'MISSING_DEDUPE_KEY' :
            (!status ? 'MISSING_STATUS' :
              (!templateKey ? 'MISSING_TEMPLATE_KEY' : 'MISSING_TEMPLATE_VERSION')))
      });
    }

    if (status && !allowedStatuses.has(status)) {
      invalidStatuses.push({row:rowNo, job_id:jobId, status:status});
    }

    if (templateKey && templateVersion &&
        !validTemplateKeys.has(templateKey + '|' + templateVersion)) {
      queueTemplateMismatches.push({
        row:rowNo,
        job_id:jobId,
        template_key:templateKey,
        template_version:templateVersion
      });
    }

    if (inflightStatuses.has(status)) {
      inflightRows.push({row:rowNo, job_id:jobId, status:status});
      const missing = [];
      if (!v03RuntimePositiveInteger_(row.attempt_no)) missing.push('attempt_no');
      if (!String(row.claim_token || '').trim()) missing.push('claim_token');
      if (!String(row.claim_started_at || '').trim()) missing.push('claim_started_at');
      if (status === 'VERIFYING' && !String(row.result_ref || '').trim()) {
        missing.push('result_ref');
      }
      if (missing.length) {
        malformedInflight.push({
          row:rowNo,
          job_id:jobId,
          status:status,
          missing_fields:missing
        });
      }
    }

    if (terminalStatuses.has(status)) {
      const issue = v03ScheduledTerminalValidationIssue_(row, rowNo, jobId, status);
      if (issue) terminalValidationMismatches.push(issue);
    }
  });

  const concurrentInflight = inflightRows.length > 1 ? inflightRows : [];
  const issues = [];
  v03RuntimePushIssue_(issues, 'DUPLICATE_JOB_ID', duplicateJobIds);
  v03RuntimePushIssue_(issues, 'DUPLICATE_DEDUPE_KEY_NONCANCELLED', duplicateDedupeKeys);
  v03RuntimePushIssue_(issues, 'INVALID_QUEUE_ROW', invalidRows);
  v03RuntimePushIssue_(issues, 'UNKNOWN_QUEUE_STATUS', invalidStatuses);
  v03RuntimePushIssue_(issues, 'MALFORMED_INFLIGHT', malformedInflight);
  v03RuntimePushIssue_(issues, 'INFLIGHT_CONCURRENCY_MISMATCH', concurrentInflight);
  v03RuntimePushIssue_(issues, 'TERMINAL_VALIDATION_MISMATCH', terminalValidationMismatches);
  v03RuntimePushIssue_(issues, 'QUEUE_TEMPLATE_MISMATCH', queueTemplateMismatches);
  v03RuntimePushIssue_(issues, 'TEMPLATE_REGISTRY_INVALID', templateEvaluation.issues);

  return v03RuntimeFinalizeEvaluation_({
    metrics: {
      queue_rows: queue.length,
      duplicate_job_ids: duplicateJobIds.length,
      duplicate_dedupe_keys_noncancelled: duplicateDedupeKeys.length,
      inflight_count: inflightRows.length,
      malformed_inflight_rows: malformedInflight.length,
      concurrent_inflight_rows: concurrentInflight.length,
      terminal_validation_mismatches: terminalValidationMismatches.length,
      invalid_queue_rows: invalidRows.length,
      unknown_status_rows: invalidStatuses.length,
      queue_template_mismatches: queueTemplateMismatches.length,
      template_registry_issues: templateEvaluation.issues.length
    },
    issues: issues
  });
}

function v03EvaluateScheduledTemplateRegistry_(templates) {
  const allowedStatuses = new Set(['CANDIDATE','STABLE']);
  const requiredTerminalMarkers = ['attempt_no','claim_token','completion_check','result_readback'];
  const counts = {};
  const issues = [];
  const validTemplateKeys = new Set();

  templates.forEach((row, index) => {
    const rowNo = Number(row.__row || (index + 2));
    const key = String(row.template_key || '').trim();
    const version = String(row.template_version || '').trim();
    const status = String(row.status || '').trim();
    const definitionFileId = String(row.definition_file_id || '').trim();
    const terminalFields = String(row.required_terminal_fields || '').trim();
    const freshnessRule = String(row.source_freshness_rule || '').trim();
    const outputStoreRef = String(row.output_store_ref || '').trim();
    const identity = key && version ? key + '|' + version : '';

    if (identity) counts[identity] = (counts[identity] || 0) + 1;

    const missing = [];
    if (!key) missing.push('template_key');
    if (!version) missing.push('template_version');
    if (!status) missing.push('status');
    if (!definitionFileId) missing.push('definition_file_id');
    if (!terminalFields) missing.push('required_terminal_fields');
    if (!freshnessRule) missing.push('source_freshness_rule');
    if (!outputStoreRef) missing.push('output_store_ref');
    if (missing.length) {
      issues.push({row:rowNo, reason:'MISSING_REQUIRED_TEMPLATE_FIELD', missing_fields:missing});
      return;
    }

    if (!allowedStatuses.has(status)) {
      issues.push({row:rowNo, reason:'INVALID_TEMPLATE_STATUS', status:status});
      return;
    }

    const terminalSet = new Set(terminalFields.split('|').map(x => x.trim()).filter(Boolean));
    const missingMarkers = requiredTerminalMarkers.filter(field => !terminalSet.has(field));
    if (missingMarkers.length) {
      issues.push({
        row:rowNo,
        reason:'REQUIRED_TERMINAL_FIELD_MARKER_MISSING',
        template_key:key,
        template_version:version,
        missing_fields:missingMarkers
      });
      return;
    }

    validTemplateKeys.add(identity);
  });

  Object.keys(counts).filter(identity => counts[identity] > 1).sort().forEach(identity => {
    issues.push({reason:'DUPLICATE_TEMPLATE_IDENTITY', identity:identity, count:counts[identity]});
    validTemplateKeys.delete(identity);
  });

  return {issues:issues, validTemplateKeys:validTemplateKeys};
}

function v03ScheduledTerminalValidationIssue_(row, rowNo, jobId, status) {
  const attemptNo = String(row.attempt_no || '').trim();
  const claimToken = String(row.claim_token || '').trim();
  const resultRef = String(row.result_ref || '').trim();
  const completion = String(row.completion_check || '').trim();
  const readback = String(row.result_readback || '').trim();

  const cleanPreRunCancelled = status === 'CANCELLED' &&
    !attemptNo && !claimToken && !resultRef && !completion && !readback;
  if (cleanPreRunCancelled) return null;

  const problems = [];
  if (!v03RuntimePositiveInteger_(attemptNo)) problems.push('attempt_no');
  if (!claimToken) problems.push('claim_token');
  if (!resultRef) problems.push('result_ref');
  if (completion !== 'PASS') problems.push('completion_check');
  if (readback !== 'PASS') problems.push('result_readback');

  if (!problems.length) return null;
  return {
    row:rowNo,
    job_id:jobId,
    status:status,
    invalid_or_missing_fields:problems,
    completion_check:completion,
    result_readback:readback
  };
}

function v03RuntimePositiveInteger_(value) {
  const raw = String(value === undefined || value === null ? '' : value).trim();
  if (!/^\d+$/.test(raw)) return false;
  return Number(raw) >= 1;
}

function v03EvaluateSiteResearchHealth_(snapshot) {
  const queue = v03RuntimeRowsAsObjects_(snapshot.tabs.QUEUE);
  const duplicateItemIds = v03RuntimeDuplicateValues_(queue, 'item_id');
  const duplicateQueueOrders = v03RuntimeDuplicateValues_(queue, 'queue_order');
  const allowedStatuses = new Set([
    'CANDIDATE','READY','RUNNING','WORKING','DONE','BLOCKED'
  ]);
  const invalidRows = [];
  const invalidStatuses = [];
  const readyGaps = [];
  const doneGaps = [];
  const workingRows = [];

  const readyRequired = [
    'item_id','queue_order','target','question','source_plan','read_scope',
    'expected_evidence','stop_condition','provider_call_budget','human_gate'
  ];

  queue.forEach((row, index) => {
    const rowNo = Number(row.__row || (index + 2));
    const itemId = String(row.item_id || '').trim();
    const queueOrder = String(row.queue_order || '').trim();
    const status = String(row.status || '').trim();

    if (!itemId || !queueOrder || !status) {
      invalidRows.push({
        row: rowNo,
        reason: !itemId ? 'MISSING_ITEM_ID' : (!queueOrder ? 'MISSING_QUEUE_ORDER' : 'MISSING_STATUS')
      });
    }

    if (status && !allowedStatuses.has(status)) {
      invalidStatuses.push({row:rowNo, item_id:itemId, status:status});
    }

    if (status === 'WORKING' || status === 'RUNNING') {
      workingRows.push({row:rowNo, item_id:itemId, status:status});
    }

    if (status === 'READY') {
      const missing = readyRequired.filter(field => !String(row[field] || '').trim());
      if (missing.length) {
        readyGaps.push({row:rowNo, item_id:itemId, missing_fields:missing});
      }
    }

    if (status === 'DONE') {
      const missing = ['result_summary','evidence_ref']
        .filter(field => !String(row[field] || '').trim());
      if (missing.length) {
        doneGaps.push({row:rowNo, item_id:itemId, missing_fields:missing});
      }
    }
  });

  const workingMismatch = workingRows.length > 1 ? workingRows : [];
  const issues = [];
  v03RuntimePushIssue_(issues, 'DUPLICATE_ITEM_ID', duplicateItemIds);
  v03RuntimePushIssue_(issues, 'DUPLICATE_QUEUE_ORDER', duplicateQueueOrders);
  v03RuntimePushIssue_(issues, 'INVALID_QUEUE_ROW', invalidRows);
  v03RuntimePushIssue_(issues, 'UNKNOWN_QUEUE_STATUS', invalidStatuses);
  v03RuntimePushIssue_(issues, 'WORKING_CONCURRENCY_MISMATCH', workingMismatch);
  v03RuntimePushIssue_(issues, 'READY_REQUIRED_FIELD_GAP', readyGaps);
  v03RuntimePushIssue_(issues, 'DONE_RESULT_EVIDENCE_GAP', doneGaps);

  return v03RuntimeFinalizeEvaluation_({
    metrics: {
      queue_rows: queue.length,
      duplicate_item_ids: duplicateItemIds.length,
      duplicate_queue_orders: duplicateQueueOrders.length,
      working_count: workingRows.length,
      ready_required_field_gaps: readyGaps.length,
      done_result_evidence_gaps: doneGaps.length,
      invalid_queue_rows: invalidRows.length,
      unknown_status_rows: invalidStatuses.length
    },
    issues: issues
  });
}

function v03RuntimeRowsAsObjects_(tabSnapshot) {
  const values = tabSnapshot.values || [];
  if (!values.length) return [];
  const headers = values[0].map(v => String(v || '').trim());
  return values.slice(1)
    .map((row, index) => ({row:row, physicalRow:index + 2}))
    .filter(entry =>
      entry.row.some(value => String(value === undefined ? '' : value).trim() !== '')
    )
    .map(entry => {
      const obj = {__row:entry.physicalRow};
      headers.forEach((header, index) => {
        obj[header] = entry.row[index] === undefined ? '' : entry.row[index];
      });
      return obj;
    });
}

function v03RuntimeDuplicateValues_(rows, field) {
  const counts = {};
  rows.forEach(row => {
    const value = String(row[field] || '').trim();
    if (!value) return;
    counts[value] = (counts[value] || 0) + 1;
  });
  return Object.keys(counts).filter(value => counts[value] > 1).sort();
}

function v03RuntimePushIssue_(issues, code, details) {
  if (!details || !details.length) return;
  details.forEach(detail => {
    issues.push({code:code, detail:detail});
  });
}

function v03RuntimeFinalizeEvaluation_(input) {
  const allIssues = input.issues || [];
  const boundedIssues = allIssues.slice(0, RUNTIME_HEALTH_V01.MAX_ISSUES);
  return {
    healthy: allIssues.length === 0,
    metrics: input.metrics || {},
    issues: boundedIssues,
    truncated_issues: allIssues.length > boundedIssues.length
  };
}

function v03RuntimeSnapshotDigestPayload_(snapshot) {
  const payload = {};
  Object.keys(snapshot.tabs || {}).sort().forEach(tabName => {
    payload[tabName] = snapshot.tabs[tabName].values;
  });
  return payload;
}

function runRuntimeHealthFixtureAcceptance() {
  requireDevRuntimeForTestMutation_();

  const scheduledClean = v03RuntimeHealthFixture_('SCHEDULED_WORK');
  const scheduledResult = v03EvaluateRuntimeHealthSnapshot_('SCHEDULED_WORK', scheduledClean);
  v03RuntimeAssert_(scheduledResult.healthy, 'clean Scheduled Work fixture must be healthy');

  const scheduledDup = v03RuntimeHealthFixture_('SCHEDULED_WORK');
  const dupRow = scheduledDup.tabs.QUEUE.values[1].slice();
  dupRow[0] = 'FIXTURE-JOB-002';
  scheduledDup.tabs.QUEUE.values.push(dupRow);
  scheduledDup.tabs.QUEUE.lastRow++;
  const scheduledDupResult = v03EvaluateRuntimeHealthSnapshot_('SCHEDULED_WORK', scheduledDup);
  v03RuntimeAssert_(!scheduledDupResult.healthy, 'Scheduled duplicate dedupe must fail health');
  v03RuntimeAssert_(
    scheduledDupResult.metrics.duplicate_dedupe_keys_noncancelled === 1,
    'Scheduled duplicate dedupe metric mismatch'
  );

  const scheduledTerminal = v03RuntimeHealthFixture_('SCHEDULED_WORK');
  const sqh = RUNTIME_HEALTH_V01.SCHEDULED_WORK.tabs.QUEUE.headers;
  scheduledTerminal.tabs.QUEUE.values[1][sqh.indexOf('result_readback')] = 'FAIL';
  const scheduledTerminalResult = v03EvaluateRuntimeHealthSnapshot_(
    'SCHEDULED_WORK',
    scheduledTerminal
  );
  v03RuntimeAssert_(
    scheduledTerminalResult.metrics.terminal_validation_mismatches === 1,
    'Scheduled terminal/readback mismatch not detected'
  );

  const scheduledWorking = v03RuntimeHealthFixture_('SCHEDULED_WORK');
  scheduledWorking.tabs.QUEUE.values[1][sqh.indexOf('status')] = 'WORKING';
  scheduledWorking.tabs.QUEUE.values[1][sqh.indexOf('claim_started_at')] = 'provider-time-present';
  scheduledWorking.tabs.QUEUE.values[1][sqh.indexOf('result_ref')] = '';
  scheduledWorking.tabs.QUEUE.values[1][sqh.indexOf('completion_check')] = '';
  scheduledWorking.tabs.QUEUE.values[1][sqh.indexOf('result_readback')] = '';
  const scheduledWorkingResult = v03EvaluateRuntimeHealthSnapshot_(
    'SCHEDULED_WORK',
    scheduledWorking
  );
  v03RuntimeAssert_(
    scheduledWorkingResult.healthy && scheduledWorkingResult.metrics.inflight_count === 1,
    'one legitimate WORKING row must be represented without false failure'
  );

  const scheduledVerifying = v03RuntimeHealthFixture_('SCHEDULED_WORK');
  scheduledVerifying.tabs.QUEUE.values[1][sqh.indexOf('status')] = 'VERIFYING';
  scheduledVerifying.tabs.QUEUE.values[1][sqh.indexOf('claim_started_at')] = 'provider-time-present';
  scheduledVerifying.tabs.QUEUE.values[1][sqh.indexOf('completion_check')] = '';
  scheduledVerifying.tabs.QUEUE.values[1][sqh.indexOf('result_readback')] = '';
  const scheduledVerifyingResult = v03EvaluateRuntimeHealthSnapshot_(
    'SCHEDULED_WORK',
    scheduledVerifying
  );
  v03RuntimeAssert_(
    scheduledVerifyingResult.healthy && scheduledVerifyingResult.metrics.inflight_count === 1,
    'one legitimate VERIFYING row must be represented without false failure'
  );

  const scheduledConcurrent = v03RuntimeHealthFixture_('SCHEDULED_WORK');
  scheduledConcurrent.tabs.QUEUE.values[1][sqh.indexOf('status')] = 'WORKING';
  scheduledConcurrent.tabs.QUEUE.values[1][sqh.indexOf('claim_started_at')] = 'provider-time-present';
  scheduledConcurrent.tabs.QUEUE.values[1][sqh.indexOf('result_ref')] = '';
  scheduledConcurrent.tabs.QUEUE.values[1][sqh.indexOf('completion_check')] = '';
  scheduledConcurrent.tabs.QUEUE.values[1][sqh.indexOf('result_readback')] = '';
  const secondWorking = scheduledConcurrent.tabs.QUEUE.values[1].slice();
  secondWorking[sqh.indexOf('job_id')] = 'FIXTURE-JOB-002';
  secondWorking[sqh.indexOf('dedupe_key')] = 'FIXTURE|JOB|002';
  secondWorking[sqh.indexOf('claim_token')] = 'FIXTURE-CLAIM-002';
  scheduledConcurrent.tabs.QUEUE.values.push(secondWorking);
  scheduledConcurrent.tabs.QUEUE.lastRow++;
  const scheduledConcurrentResult = v03EvaluateRuntimeHealthSnapshot_(
    'SCHEDULED_WORK',
    scheduledConcurrent
  );
  v03RuntimeAssert_(
    !scheduledConcurrentResult.healthy &&
      scheduledConcurrentResult.metrics.concurrent_inflight_rows === 2,
    'multiple Scheduled Work inflight rows must fail health'
  );

  const scheduledMalformedInflight = v03RuntimeHealthFixture_('SCHEDULED_WORK');
  scheduledMalformedInflight.tabs.QUEUE.values[1][sqh.indexOf('status')] = 'WORKING';
  scheduledMalformedInflight.tabs.QUEUE.values[1][sqh.indexOf('claim_token')] = '';
  scheduledMalformedInflight.tabs.QUEUE.values[1][sqh.indexOf('claim_started_at')] = '';
  const malformedInflightResult = v03EvaluateRuntimeHealthSnapshot_(
    'SCHEDULED_WORK',
    scheduledMalformedInflight
  );
  v03RuntimeAssert_(
    !malformedInflightResult.healthy &&
      malformedInflightResult.metrics.malformed_inflight_rows === 1,
    'malformed inflight must fail health'
  );

  const scheduledHumanGate = v03RuntimeHealthFixture_('SCHEDULED_WORK');
  scheduledHumanGate.tabs.QUEUE.values[1][sqh.indexOf('status')] = 'HUMAN_GATE';
  scheduledHumanGate.tabs.QUEUE.values[1][sqh.indexOf('result_ref')] = '';
  scheduledHumanGate.tabs.QUEUE.values[1][sqh.indexOf('completion_check')] = '';
  scheduledHumanGate.tabs.QUEUE.values[1][sqh.indexOf('result_readback')] = '';
  const humanGateResult = v03EvaluateRuntimeHealthSnapshot_(
    'SCHEDULED_WORK',
    scheduledHumanGate
  );
  v03RuntimeAssert_(
    !humanGateResult.healthy && humanGateResult.metrics.terminal_validation_mismatches === 1,
    'invalid non-DONE terminal must fail health'
  );

  const scheduledUnknown = v03RuntimeHealthFixture_('SCHEDULED_WORK');
  scheduledUnknown.tabs.QUEUE.values[1][sqh.indexOf('status')] = 'BOGUS';
  const scheduledUnknownResult = v03EvaluateRuntimeHealthSnapshot_(
    'SCHEDULED_WORK',
    scheduledUnknown
  );
  v03RuntimeAssert_(
    !scheduledUnknownResult.healthy && scheduledUnknownResult.metrics.unknown_status_rows === 1,
    'unknown Scheduled Work status must fail health'
  );

  const scheduledControl = v03RuntimeHealthFixture_('SCHEDULED_WORK');
  const controlRows = scheduledControl.tabs.CONTROL.values;
  const sourcePolicyRow = controlRows.find(row => row[0] === 'source_policy');
  sourcePolicyRow[1] = 'WRITE_ALLOWED';
  v03RuntimeExpectCode_(
    () => v03EvaluateRuntimeHealthSnapshot_('SCHEDULED_WORK', scheduledControl),
    'RUNTIME_SCHEMA_MARKER_MISMATCH',
    'Scheduled Work CONTROL predicate drift must fail closed'
  );

  const scheduledTemplate = v03RuntimeHealthFixture_('SCHEDULED_WORK');
  const sth = RUNTIME_HEALTH_V01.SCHEDULED_WORK.tabs.TEMPLATE_REGISTRY.headers;
  scheduledTemplate.tabs.TEMPLATE_REGISTRY.values[1][sth.indexOf('definition_file_id')] = '';
  const scheduledTemplateResult = v03EvaluateRuntimeHealthSnapshot_(
    'SCHEDULED_WORK',
    scheduledTemplate
  );
  v03RuntimeAssert_(
    !scheduledTemplateResult.healthy &&
      scheduledTemplateResult.metrics.template_registry_issues === 1,
    'Scheduled Work missing template locator must fail health'
  );

  const scheduledQueueTemplate = v03RuntimeHealthFixture_('SCHEDULED_WORK');
  scheduledQueueTemplate.tabs.QUEUE.values[1][sqh.indexOf('template_key')] = 'UNKNOWN_TEMPLATE';
  const scheduledQueueTemplateResult = v03EvaluateRuntimeHealthSnapshot_(
    'SCHEDULED_WORK',
    scheduledQueueTemplate
  );
  v03RuntimeAssert_(
    !scheduledQueueTemplateResult.healthy &&
      scheduledQueueTemplateResult.metrics.queue_template_mismatches === 1,
    'Scheduled Work unknown queue template must fail health'
  );

  const siteClean = v03RuntimeHealthFixture_('SITE_RESEARCH');
  const siteResult = v03EvaluateRuntimeHealthSnapshot_('SITE_RESEARCH', siteClean);
  v03RuntimeAssert_(siteResult.healthy, 'clean Site Research fixture must be healthy');

  const siteBad = v03RuntimeHealthFixture_('SITE_RESEARCH');
  siteBad.tabs.QUEUE.values.push(siteBad.tabs.QUEUE.values[1].slice());
  siteBad.tabs.QUEUE.lastRow++;
  siteBad.tabs.QUEUE.values[1][2] = 'WORKING';
  siteBad.tabs.QUEUE.values[2][2] = 'WORKING';
  const siteBadResult = v03EvaluateRuntimeHealthSnapshot_('SITE_RESEARCH', siteBad);
  v03RuntimeAssert_(!siteBadResult.healthy, 'Site Research malformed fixture must fail health');
  v03RuntimeAssert_(
    siteBadResult.metrics.duplicate_item_ids === 1 &&
      siteBadResult.metrics.duplicate_queue_orders === 1 &&
      siteBadResult.metrics.working_count === 2,
    'Site Research duplicate/WORKING metrics mismatch'
  );

  const siteReadyGap = v03RuntimeHealthFixture_('SITE_RESEARCH');
  siteReadyGap.tabs.QUEUE.values[1][2] = 'READY';
  siteReadyGap.tabs.QUEUE.values[1][4] = '';
  const siteReadyGapResult = v03EvaluateRuntimeHealthSnapshot_('SITE_RESEARCH', siteReadyGap);
  v03RuntimeAssert_(
    siteReadyGapResult.metrics.ready_required_field_gaps === 1,
    'Site Research READY required-field gap not detected'
  );

  const siteDoneGap = v03RuntimeHealthFixture_('SITE_RESEARCH');
  siteDoneGap.tabs.QUEUE.values[1][11] = '';
  const siteDoneGapResult = v03EvaluateRuntimeHealthSnapshot_('SITE_RESEARCH', siteDoneGap);
  v03RuntimeAssert_(
    siteDoneGapResult.metrics.done_result_evidence_gaps === 1,
    'Site Research DONE result/evidence gap not detected'
  );

  const siteUnknown = v03RuntimeHealthFixture_('SITE_RESEARCH');
  siteUnknown.tabs.QUEUE.values[1][2] = 'BOGUS';
  const siteUnknownResult = v03EvaluateRuntimeHealthSnapshot_('SITE_RESEARCH', siteUnknown);
  v03RuntimeAssert_(
    !siteUnknownResult.healthy && siteUnknownResult.metrics.unknown_status_rows === 1,
    'unknown Site Research status must fail health'
  );

  const headerBad = v03RuntimeHealthFixture_('SCHEDULED_WORK');
  headerBad.tabs.QUEUE.values[0][0] = 'job_id_changed';
  v03RuntimeExpectCode_(
    () => v03EvaluateRuntimeHealthSnapshot_('SCHEDULED_WORK', headerBad),
    'RUNTIME_HEADER_MISMATCH',
    'required-header mismatch must fail closed'
  );

  const overflow = v03RuntimeHealthFixture_('SITE_RESEARCH');
  overflow.tabs.QUEUE.lastRow = RUNTIME_HEALTH_V01.SITE_RESEARCH.tabs.QUEUE.maxRows + 1;
  v03RuntimeExpectCode_(
    () => v03EvaluateRuntimeHealthSnapshot_('SITE_RESEARCH', overflow),
    'RUNTIME_ROW_LIMIT',
    'row overflow must fail closed'
  );

  const truncated = v03RuntimeHealthFixture_('SCHEDULED_WORK');
  truncated.tabs.RUN_LOG.lastRow++;
  v03RuntimeExpectCode_(
    () => v03EvaluateRuntimeHealthSnapshot_('SCHEDULED_WORK', truncated),
    'RUNTIME_TRUNCATED_READ',
    'truncated read must fail closed'
  );

  const schemaBad = v03RuntimeHealthFixture_('SITE_RESEARCH');
  schemaBad.tabs.CONTROL.values[1][1] = 'unexpected-schema-version';
  v03RuntimeExpectCode_(
    () => v03EvaluateRuntimeHealthSnapshot_('SITE_RESEARCH', schemaBad),
    'RUNTIME_SCHEMA_MARKER_MISMATCH',
    'schema marker drift must fail closed'
  );

  const isolatedScheduled = v03EvaluateRuntimeHealthSnapshot_(
    'SCHEDULED_WORK',
    v03RuntimeHealthFixture_('SCHEDULED_WORK')
  );
  let isolatedSiteFailed = false;
  try {
    const isolatedSite = v03RuntimeHealthFixture_('SITE_RESEARCH');
    isolatedSite.tabs.QUEUE.lastRow = RUNTIME_HEALTH_V01.SITE_RESEARCH.tabs.QUEUE.maxRows + 1;
    v03EvaluateRuntimeHealthSnapshot_('SITE_RESEARCH', isolatedSite);
  } catch (e) {
    isolatedSiteFailed = e && e.v03code === 'RUNTIME_ROW_LIMIT';
  }
  v03RuntimeAssert_(isolatedScheduled.healthy, 'healthy source changed during failure-isolation fixture');
  v03RuntimeAssert_(isolatedSiteFailed, 'malformed source did not fail closed in isolation fixture');

  v03RuntimeCoherenceFixtureAcceptance_();
  v03RuntimeHealthIdentityLifecycleAcceptance_();

  const result = {
    status: 'PASS',
    contract: RUNTIME_HEALTH_V01.VERSION,
    cases: 25,
    scheduled_clean: scheduledResult.metrics,
    site_research_clean: siteResult.metrics
  };
  console.log(JSON.stringify(result));
  return result;
}

function v03RuntimeCoherenceFixtureAcceptance_() {
  const config = RUNTIME_HEALTH_V01.SITE_RESEARCH;
  const base = v03RuntimeHealthFixture_('SITE_RESEARCH').tabs;
  const meta = {
    id:config.spreadsheetId,
    modifiedTime:'2026-10-01T00:00:00Z',
    version:'100'
  };
  const clone = value => JSON.parse(JSON.stringify(value));

  v03AssertRuntimeSnapshotCoherence_(config, meta, clone(base), clone(base), meta);

  const appendGrowth = clone(base);
  appendGrowth.QUEUE.lastRow++;
  appendGrowth.QUEUE.values.push(appendGrowth.QUEUE.values[1].slice());
  v03RuntimeExpectCode_(
    () => v03AssertRuntimeSnapshotCoherence_(config, meta, clone(base), appendGrowth, meta),
    'RUNTIME_SOURCE_CHANGED_DURING_READ',
    'append growth interleaving must fail closed'
  );

  const columnGrowth = clone(base);
  columnGrowth.QUEUE.lastColumn++;
  columnGrowth.QUEUE.values[0].push('unexpected');
  columnGrowth.QUEUE.values[1].push('value');
  v03RuntimeExpectCode_(
    () => v03AssertRuntimeSnapshotCoherence_(config, meta, clone(base), columnGrowth, meta),
    'RUNTIME_SOURCE_CHANGED_DURING_READ',
    'column growth interleaving must fail closed'
  );

  const sameExtent = clone(base);
  sameExtent.QUEUE.values[1][4] = 'changed during read';
  v03RuntimeExpectCode_(
    () => v03AssertRuntimeSnapshotCoherence_(config, meta, clone(base), sameExtent, meta),
    'RUNTIME_SOURCE_CHANGED_DURING_READ',
    'same-extent content update interleaving must fail closed'
  );

  const changedMeta = Object.assign({}, meta, {
    modifiedTime:'2026-10-01T00:00:01Z',
    version:'101'
  });
  v03RuntimeExpectCode_(
    () => v03AssertRuntimeSnapshotCoherence_(config, meta, clone(base), clone(base), changedMeta),
    'RUNTIME_SOURCE_CHANGED_DURING_READ',
    'source version change interleaving must fail closed'
  );
}

function v03RuntimeHealthIdentityLifecycleAcceptance_() {
  const config = RUNTIME_HEALTH_V01.SCHEDULED_WORK;
  const source = {
    source_key:'T-RHP-IDENTITY-LIFECYCLE',
    source_kind:'SHEET_RANGE',
    source_ref:config.spreadsheetId,
    authority_ref:config.spreadsheetId,
    selector:config.selector,
    collection_mode:'STRUCTURAL_HEALTH',
    stale_after_minutes:60,
    expected_identity:config.expectedIdentity
  };
  const tx = v03RuntimeHealthFixtureTx_();
  const successIdentity = v03BaseIdentity_(
    source,
    'RUNTIME_HEALTH',
    config.selector,
    config.spreadsheetId
  );

  v03RecordSourceFailure_(
    tx,
    source,
    v03Error_('RUNTIME_SCHEMA_WIDTH_MISMATCH','fixture first failure')
  );
  v03RuntimeAssert_(tx.stateRows.length === 1, 'first failure must create one state row');
  v03RuntimeAssert_(
    tx.stateRows[0].entity_kind === 'RUNTIME_HEALTH' &&
      tx.stateRows[0].entity_key === config.selector,
    'first Runtime Health failure must use canonical stable identity'
  );

  v03UpsertState_(tx, successIdentity, {
    collection_status:'SUCCESS',
    stale_state:'FRESH',
    mechanical_signal:'NONE',
    stale_after_minutes:60
  });
  v03RuntimeAssert_(
    tx.stateRows.length === 1 && tx.stateRows[0].collection_status === 'SUCCESS',
    'first-failure to success recovery must preserve one canonical row'
  );

  v03RecordSourceFailure_(
    tx,
    source,
    v03Error_('RUNTIME_SOURCE_CHANGED_DURING_READ','fixture later failure')
  );
  v03RuntimeAssert_(
    tx.stateRows.length === 1 &&
      tx.stateRows[0].collection_status === 'ERROR' &&
      tx.stateRows[0].stale_state === 'UNKNOWN',
    'prior-success to failure must preserve canonical row and fail closed'
  );

  v03UpsertState_(tx, successIdentity, {
    collection_status:'SUCCESS',
    stale_state:'FRESH',
    mechanical_signal:'NONE',
    stale_after_minutes:60
  });
  v03RuntimeAssert_(
    tx.stateRows.length === 1 &&
      tx.stateRows[0].collection_status === 'SUCCESS' &&
      tx.stateRows[0].entity_kind === 'RUNTIME_HEALTH' &&
      tx.stateRows[0].entity_key === config.selector,
    'prior-success to failure to success recovery must remain recoverable'
  );
}

function v03RuntimeHealthFixtureTx_() {
  return {
    stateHeader:[
      'state_key','source_key','entity_kind','entity_key','source_ref','authority_ref',
      'observed_name','observed_mime_type','observed_modified_at','source_version_signal',
      'collected_at','collection_status','last_collection_success_at','last_collection_error_at',
      'last_collection_error_code','last_collection_error','stale_after_minutes','stale_state',
      'mechanical_signal','mechanical_signal_detail','judge_status'
    ],
    stateRows:[],
    dirtyCells:new Map(),
    newStateRows:[],
    stateSheetId:0,
    runSheetId:0,
    runHeader:[],
    runAppend:null,
    spreadsheetId:'TEST'
  };
}

function runRuntimeHealthDevReadAcceptance() {
  requireDevRuntimeForTestMutation_();

  const scheduled = v03RuntimeHealthDevProbeOne_(
    RUNTIME_HEALTH_V01.SCHEDULED_WORK,
    'T-RHP-SCHEDULED-WORK-CURRENT'
  );
  const site = v03RuntimeHealthDevProbeOne_(
    RUNTIME_HEALTH_V01.SITE_RESEARCH,
    'T-RHP-SITE-RESEARCH-CURRENT'
  );

  v03RuntimeAssert_(
    scheduled.probe_status === 'COLLECTED' || scheduled.probe_status === 'FAIL_CLOSED',
    'Scheduled Work probe did not produce a terminal observation'
  );
  v03RuntimeAssert_(
    site.probe_status === 'COLLECTED' || site.probe_status === 'FAIL_CLOSED',
    'Site Research probe did not produce a terminal observation'
  );

  const result = {
    status: 'PASS',
    contract: RUNTIME_HEALTH_V01.VERSION,
    acceptance_meaning:
      'PASS means both exact current sources were independently observed and any source-local structural failure serialized fail-closed; source health may be abnormal.',
    scheduled_work: scheduled,
    site_research: site
  };
  console.log(JSON.stringify(result));
  return result;
}

function v03RuntimeHealthDevProbeOne_(config, sourceKey) {
  const stateHeader = [
    'state_key','source_key','entity_kind','entity_key','source_ref','authority_ref',
    'observed_name','observed_mime_type','observed_modified_at','source_version_signal',
    'collected_at','collection_status','last_collection_success_at','last_collection_error_at',
    'last_collection_error_code','last_collection_error','stale_after_minutes','stale_state',
    'mechanical_signal','mechanical_signal_detail','judge_status'
  ];
  const tx = {
    stateHeader: stateHeader,
    stateRows: [],
    dirtyCells: new Map(),
    newStateRows: [],
    stateSheetId: 0,
    runSheetId: 0,
    runHeader: [],
    runAppend: null,
    spreadsheetId: 'TEST'
  };
  const source = {
    source_key: sourceKey,
    source_kind: 'SHEET_RANGE',
    source_ref: config.spreadsheetId,
    authority_ref: config.spreadsheetId,
    selector: config.selector,
    collection_mode: 'STRUCTURAL_HEALTH',
    stale_after_minutes: 60,
    expected_identity: config.expectedIdentity
  };

  let outcome;
  let health = null;
  try {
    outcome = v03CollectRuntimeHealth_(tx, source);
    health = outcome.structural_health || null;
  } catch (e) {
    if (!e || !e.v03code) throw e;
    outcome = v03RecordSourceFailure_(tx, source, e);
  }

  const rows = tx.stateRows.filter(row => String(row.source_key) === sourceKey);
  v03RuntimeAssert_(
    rows.length === 1,
    config.runtimeKey + ' Dev probe must serialize exactly one in-memory state row'
  );
  const row = rows[0];
  const failedClosed = String(row.collection_status) !== 'SUCCESS';

  if (failedClosed) {
    v03RuntimeAssert_(
      String(row.stale_state) === 'UNKNOWN',
      config.runtimeKey + ' failed source must serialize UNKNOWN freshness'
    );
    v03RuntimeAssert_(
      String(row.mechanical_signal) === 'HEALTH_FAIL',
      config.runtimeKey + ' failed source must serialize HEALTH_FAIL'
    );
  } else {
    v03RuntimeAssert_(
      health && health.coverage_complete === true,
      config.runtimeKey + ' successful source must prove complete coverage'
    );
    v03RuntimeAssert_(
      typeof health.healthy === 'boolean',
      config.runtimeKey + ' successful source must return a health verdict'
    );
  }

  return {
    file_id: config.spreadsheetId,
    selector: config.selector,
    probe_status: failedClosed ? 'FAIL_CLOSED' : 'COLLECTED',
    collector_code: String(outcome.code || ''),
    collection_status: String(row.collection_status || ''),
    last_collection_error_code: String(row.last_collection_error_code || ''),
    last_collection_error: String(row.last_collection_error || ''),
    stale_state: String(row.stale_state || ''),
    mechanical_signal: String(row.mechanical_signal || ''),
    healthy: health ? health.healthy : false,
    coverage_complete: health ? health.coverage_complete : false,
    coverage: health ? health.coverage : null,
    metrics: health ? health.metrics : null,
    issues: health ? health.issues : []
  };
}

function v03RuntimeHealthFixture_(runtimeKey) {
  const config = v03RuntimeHealthConfigByKey_(runtimeKey);
  const tabs = {};

  Object.keys(config.tabs).forEach(tabName => {
    const headers = config.tabs[tabName].headers.slice();
    tabs[tabName] = {
      lastRow: 1,
      lastColumn: headers.length,
      values: [headers]
    };
  });

  Object.keys(config.controlExpectations || {}).forEach(key => {
    tabs.CONTROL.values.push([key, String(config.controlExpectations[key]), 'fixture']);
    tabs.CONTROL.lastRow++;
  });

  if (runtimeKey === 'SCHEDULED_WORK') {
    const q = config.tabs.QUEUE.headers;
    const row = new Array(q.length).fill('');
    const set = (field, value) => row[q.indexOf(field)] = value;
    set('job_id','FIXTURE-JOB-001');
    set('dedupe_key','FIXTURE|JOB|001');
    set('template_key','WORKER_HEALTH');
    set('template_version','v0.1');
    set('status','DONE');
    set('attempt_no','1');
    set('result_ref','FIXTURE|RESULT');
    set('completion_check','PASS');
    set('result_readback','PASS');
    tabs.QUEUE.values.push(row);
    tabs.QUEUE.lastRow++;

    const t = config.tabs.TEMPLATE_REGISTRY.headers;
    const template = new Array(t.length).fill('');
    template[t.indexOf('template_key')] = 'WORKER_HEALTH';
    template[t.indexOf('template_version')] = 'v0.1';
    template[t.indexOf('status')] = 'CANDIDATE';
    template[t.indexOf('definition_file_id')] = 'FIXTURE-DEFINITION-ID';
    template[t.indexOf('required_terminal_fields')] =
      'job_id|template_key|template_version|attempt_no|claim_token|completion_check|result_readback';
    template[t.indexOf('source_freshness_rule')] = 'fresh fixture source every attempt';
    template[t.indexOf('output_store_ref')] = 'FIXTURE_STORE';
    tabs.TEMPLATE_REGISTRY.values.push(template);
    tabs.TEMPLATE_REGISTRY.lastRow++;

    const r = config.tabs.RUN_LOG.headers;
    const run = new Array(r.length).fill('');
    run[r.indexOf('run_id')] = 'FIXTURE-RUN-001';
    run[r.indexOf('job_id')] = 'FIXTURE-JOB-001';
    run[r.indexOf('outcome')] = 'DONE';
    run[r.indexOf('result_readback')] = 'PASS';
    tabs.RUN_LOG.values.push(run);
    tabs.RUN_LOG.lastRow++;
  } else {
    const q = config.tabs.QUEUE.headers;
    const row = new Array(q.length).fill('');
    const set = (field, value) => row[q.indexOf(field)] = value;
    set('item_id','R-FIXTURE-001');
    set('queue_order','10');
    set('status','DONE');
    set('target','fixture target');
    set('question','fixture question');
    set('source_plan','DRIVE');
    set('read_scope','bounded fixture');
    set('expected_evidence','fixture evidence');
    set('stop_condition','fixture complete');
    set('provider_call_budget','1');
    set('human_gate','NO');
    set('result_summary','fixture done');
    set('evidence_ref','fixture evidence ref');
    set('updated_at','2026-10-01 JST');
    tabs.QUEUE.values.push(row);
    tabs.QUEUE.lastRow++;

    const r = config.tabs.RUNS.headers;
    const run = new Array(r.length).fill('');
    run[r.indexOf('cycle_counter')] = '1';
    run[r.indexOf('lane')] = 'RESEARCH';
    run[r.indexOf('item_id')] = 'R-FIXTURE-001';
    run[r.indexOf('outcome')] = 'PASS';
    run[r.indexOf('provider')] = 'DRIVE';
    run[r.indexOf('provider_calls')] = '0';
    tabs.RUNS.values.push(run);
    tabs.RUNS.lastRow++;
  }

  return {
    runtimeKey: runtimeKey,
    spreadsheetId: config.spreadsheetId,
    tabs: tabs
  };
}

function v03RuntimeExpectCode_(fn, code, message) {
  let matched = false;
  try {
    fn();
  } catch (e) {
    matched = Boolean(e && e.v03code === code);
  }
  v03RuntimeAssert_(matched, message + ' expected code=' + code);
}

function v03RuntimeAssert_(condition, message) {
  if (!condition) throw new Error('RUNTIME HEALTH ACCEPTANCE FAIL: ' + message);
}
