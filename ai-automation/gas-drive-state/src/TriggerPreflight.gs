/**
 * Trigger authorization/preflight contracts.
 * TEST acceptance remains Dev-only.
 * Production recurring trigger is exact-project guarded and Human-Gate operated.
 */
const M2B_TRIGGER = Object.freeze({
  handler: 'mechanicalM2BTestTick',
  scope: 'https://www.googleapis.com/auth/script.scriptapp'
});

const PROD_COLLECTOR_TRIGGER = Object.freeze({
  handler: 'runScheduledProductionCollectorV03',
  scope: 'https://www.googleapis.com/auth/script.scriptapp',
  cadenceHours: 1
});

const FOUNDATION_DEV_TRIGGER = Object.freeze({
  handler: 'runFoundationScheduledDevCollector',
  scope: 'https://www.googleapis.com/auth/script.scriptapp'
});

function getMechanicalTriggerAuthorizationPreflight() {
  const info = ScriptApp.getAuthorizationInfo(
    ScriptApp.AuthMode.FULL,
    [M2B_TRIGGER.scope]
  );
  const status = info.getAuthorizationStatus();
  const result = {
    status: String(status),
    requiredScope: M2B_TRIGGER.scope,
    authorizedScopes: ScriptApp.getAuthorizationInfo(ScriptApp.AuthMode.FULL).getAuthorizedScopes()
  };

  if (status === ScriptApp.AuthorizationStatus.NOT_REQUIRED) {
    const matches = ScriptApp.getProjectTriggers()
      .filter(t => t.getHandlerFunction() === M2B_TRIGGER.handler);
    result.matchingTestTriggers = matches.length;
    result.projectTriggerCount = ScriptApp.getProjectTriggers().length;
    result.preflight = matches.length === 0 ? 'READY' : 'BLOCKED_EXISTING_TEST_TRIGGER';
  } else {
    result.preflight = 'AUTH_REQUIRED';
  }

  console.log(JSON.stringify(result));
  return result;
}

function mechanicalM2BTestTick() {
  console.log(JSON.stringify({
    status: 'PASS',
    source: 'M2B_TEST_TRIGGER',
    timestamp: new Date().toISOString()
  }));
}

function runMechanicalM2BTriggerAcceptance() {
  requireDevRuntimeForTestMutation_();
  ScriptApp.requireScopes(
    ScriptApp.AuthMode.FULL,
    [M2B_TRIGGER.scope]
  );

  const before = ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === M2B_TRIGGER.handler);

  if (before.length !== 0) {
    const blocked = {
      status: 'FAIL',
      reason: 'EXISTING_TEST_TRIGGER',
      matchingCount: before.length
    };
    console.log(JSON.stringify(blocked));
    return blocked;
  }

  let created = null;
  let createdId = null;
  let createVerified = false;
  let cleanupVerified = false;

  try {
    created = ScriptApp.newTrigger(M2B_TRIGGER.handler)
      .timeBased()
      .everyHours(1)
      .create();
    createdId = created.getUniqueId();

    const afterCreate = ScriptApp.getProjectTriggers()
      .filter(t => t.getHandlerFunction() === M2B_TRIGGER.handler);

    createVerified = afterCreate.length === 1 &&
      afterCreate[0].getUniqueId() === createdId;

    if (!createVerified) {
      throw new Error('TEST_TRIGGER_CREATE_VERIFY_FAILED');
    }
  } finally {
    if (createdId) {
      const current = ScriptApp.getProjectTriggers();
      current
        .filter(t => t.getHandlerFunction() === M2B_TRIGGER.handler && t.getUniqueId() === createdId)
        .forEach(t => ScriptApp.deleteTrigger(t));
    }

    const afterCleanup = ScriptApp.getProjectTriggers()
      .filter(t => t.getHandlerFunction() === M2B_TRIGGER.handler);
    cleanupVerified = afterCleanup.length === 0;
  }

  const result = {
    status: createVerified && cleanupVerified ? 'PASS' : 'FAIL',
    createVerified,
    cleanupVerified,
    persistentTriggerLeftBehind: !cleanupVerified
  };
  console.log(JSON.stringify(result));
  return result;
}

/* ---------- Dev-only execution-foundation verification ---------- */

function foundationDevTarget_(triggerType) {
  requireDevRuntimeForTestMutation_();
  return {
    scriptId: COLLECTOR_V03.DEV_SCRIPT_ID,
    spreadsheetId: COLLECTOR_V03.TEST_SPREADSHEET_ID,
    triggerType: String(triggerType),
    scopeRef: 'TEST:SOURCES enabled rows'
  };
}

function foundationObservedRun_(triggerType, runner) {
  const target = foundationDevTarget_(triggerType);
  try {
    return runner(target);
  } catch (e) {
    const evidence = {
      event: 'COLLECTOR_RUN_UNCOMMITTED_FAILURE',
      collector_version: COLLECTOR_V03.VERSION,
      trigger_type: target.triggerType,
      spreadsheet_id: target.spreadsheetId,
      error_name: String(e && e.name ? e.name : 'Error'),
      error_message: String(e && e.message ? e.message : e),
      error_stack: String(e && e.stack ? e.stack : '')
    };
    // This evidence intentionally lives outside the collector Sheet transaction.
    // Re-throw the original object so logging can never replace/mask the primary exception.
    console.error(JSON.stringify(evidence));
    throw e;
  }
}

function runFoundationManualDevCollector() {
  return foundationObservedRun_('MANUAL_TEST', target => v03Run_(target));
}

function runFoundationScheduledDevCollector() {
  return foundationObservedRun_('TIME_TRIGGER_TEST', target => v03Run_(target));
}

function runFoundationFailureObservabilityProbe() {
  requireDevRuntimeForTestMutation_();
  const marker = 'FOUNDATION_FORCED_UNCOMMITTED_FAILURE';
  try {
    foundationObservedRun_('FAILURE_PROBE', () => {
      const error = new Error(marker);
      error.name = 'FoundationProbeError';
      throw error;
    });
  } catch (e) {
    const preserved = e && e.name === 'FoundationProbeError' && e.message === marker && String(e.stack || '').includes(marker);
    const result = {
      status: preserved ? 'PASS' : 'FAIL',
      originalExceptionPreserved: Boolean(preserved),
      expectedLogEvent: 'COLLECTOR_RUN_UNCOMMITTED_FAILURE'
    };
    console.log(JSON.stringify(result));
    if (!preserved) throw new Error('FOUNDATION_FAILURE_OBSERVABILITY_PROBE_FAILED');
    return result;
  }
  throw new Error('FOUNDATION_FAILURE_OBSERVABILITY_PROBE_DID_NOT_THROW');
}

function installFoundationDevParityTrigger() {
  requireDevRuntimeForTestMutation_();
  ScriptApp.requireScopes(ScriptApp.AuthMode.FULL, [FOUNDATION_DEV_TRIGGER.scope]);
  const all = ScriptApp.getProjectTriggers();
  const matches = all.filter(t => t.getHandlerFunction() === FOUNDATION_DEV_TRIGGER.handler);
  if (matches.length !== 0) throw new Error('EXISTING_FOUNDATION_DEV_TRIGGER');
  if (all.length !== 0) throw new Error('UNEXPECTED_PROJECT_TRIGGER');
  const created = ScriptApp.newTrigger(FOUNDATION_DEV_TRIGGER.handler).timeBased().after(60 * 1000).create();
  const id = created.getUniqueId();
  const after = ScriptApp.getProjectTriggers();
  const verified = after.length === 1 && after[0].getHandlerFunction() === FOUNDATION_DEV_TRIGGER.handler && after[0].getUniqueId() === id;
  if (!verified) {
    after.filter(t => t.getUniqueId() === id).forEach(t => ScriptApp.deleteTrigger(t));
    throw new Error('FOUNDATION_DEV_TRIGGER_CREATE_VERIFY_FAILED');
  }
  const result = {status:'PASS', handler:FOUNDATION_DEV_TRIGGER.handler, triggerUniqueId:id, fireAfterMs:60000};
  console.log(JSON.stringify(result));
  return result;
}

function cleanupFoundationDevParityTrigger() {
  requireDevRuntimeForTestMutation_();
  const all = ScriptApp.getProjectTriggers();
  const matches = all.filter(t => t.getHandlerFunction() === FOUNDATION_DEV_TRIGGER.handler);
  matches.forEach(t => ScriptApp.deleteTrigger(t));
  const remaining = ScriptApp.getProjectTriggers().filter(t => t.getHandlerFunction() === FOUNDATION_DEV_TRIGGER.handler);
  const result = {status:remaining.length === 0 ? 'PASS' : 'FAIL', removedCount:matches.length, remainingCount:remaining.length};
  console.log(JSON.stringify(result));
  if (remaining.length !== 0) throw new Error('FOUNDATION_DEV_TRIGGER_CLEANUP_FAILED');
  return result;
}

function requireProductionRuntimeForTriggerMutation_() {
  const currentScriptId = ScriptApp.getScriptId();
  if (currentScriptId !== COLLECTOR_V03.PROD_SCRIPT_ID) {
    throw v03Error_(
      'RUNTIME_TARGET_MISMATCH',
      'Production trigger mutation requires exact approved Production Apps Script project'
    );
  }
  return currentScriptId;
}

function getProductionCollectorTriggerPreflight() {
  requireProductionRuntimeForTriggerMutation_();

  const info = ScriptApp.getAuthorizationInfo(
    ScriptApp.AuthMode.FULL,
    [PROD_COLLECTOR_TRIGGER.scope]
  );
  const status = info.getAuthorizationStatus();
  const all = ScriptApp.getProjectTriggers();
  const matches = all.filter(t => t.getHandlerFunction() === PROD_COLLECTOR_TRIGGER.handler);

  const result = {
    status: String(status),
    requiredScope: PROD_COLLECTOR_TRIGGER.scope,
    handler: PROD_COLLECTOR_TRIGGER.handler,
    cadenceHours: PROD_COLLECTOR_TRIGGER.cadenceHours,
    matchingProductionTriggers: matches.length,
    projectTriggerCount: all.length,
    preflight: 'AUTH_REQUIRED'
  };

  if (status === ScriptApp.AuthorizationStatus.NOT_REQUIRED) {
    if (matches.length !== 0) {
      result.preflight = 'BLOCKED_EXISTING_PRODUCTION_TRIGGER';
    } else if (all.length !== 0) {
      result.preflight = 'BLOCKED_UNEXPECTED_PROJECT_TRIGGER';
    } else {
      result.preflight = 'READY';
    }
  }

  console.log(JSON.stringify(result));
  return result;
}

function installProductionCollectorHourlyTrigger() {
  requireProductionRuntimeForTriggerMutation_();
  ScriptApp.requireScopes(
    ScriptApp.AuthMode.FULL,
    [PROD_COLLECTOR_TRIGGER.scope]
  );

  const before = ScriptApp.getProjectTriggers();
  const matchingBefore = before.filter(
    t => t.getHandlerFunction() === PROD_COLLECTOR_TRIGGER.handler
  );

  if (matchingBefore.length !== 0) {
    throw new Error('EXISTING_PRODUCTION_TRIGGER');
  }
  if (before.length !== 0) {
    throw new Error('UNEXPECTED_PROJECT_TRIGGER');
  }

  const created = ScriptApp.newTrigger(PROD_COLLECTOR_TRIGGER.handler)
    .timeBased()
    .everyHours(PROD_COLLECTOR_TRIGGER.cadenceHours)
    .create();
  const createdId = created.getUniqueId();

  const after = ScriptApp.getProjectTriggers();
  const matchingAfter = after.filter(
    t => t.getHandlerFunction() === PROD_COLLECTOR_TRIGGER.handler
  );
  const verified = after.length === 1 &&
    matchingAfter.length === 1 &&
    matchingAfter[0].getUniqueId() === createdId;

  if (!verified) {
    after
      .filter(t => t.getUniqueId() === createdId)
      .forEach(t => ScriptApp.deleteTrigger(t));
    throw new Error('PRODUCTION_TRIGGER_CREATE_VERIFY_FAILED');
  }

  const result = {
    status: 'PASS',
    handler: PROD_COLLECTOR_TRIGGER.handler,
    cadenceHours: PROD_COLLECTOR_TRIGGER.cadenceHours,
    triggerUniqueId: createdId,
    projectTriggerCount: after.length
  };
  console.log(JSON.stringify(result));
  return result;
}

function removeProductionCollectorHourlyTrigger() {
  requireProductionRuntimeForTriggerMutation_();

  const all = ScriptApp.getProjectTriggers();
  const matches = all.filter(
    t => t.getHandlerFunction() === PROD_COLLECTOR_TRIGGER.handler
  );

  if (all.length !== 1 || matches.length !== 1) {
    throw new Error('PRODUCTION_TRIGGER_IDENTITY_MISMATCH');
  }

  const triggerUniqueId = matches[0].getUniqueId();
  return removeProductionCollectorTriggerById(triggerUniqueId);
}

function removeProductionCollectorTriggerById(triggerUniqueId) {
  requireProductionRuntimeForTriggerMutation_();

  const requestedId = String(triggerUniqueId || '').trim();
  if (!requestedId) throw new Error('TRIGGER_ID_REQUIRED');

  const all = ScriptApp.getProjectTriggers();
  const matches = all.filter(
    t => t.getHandlerFunction() === PROD_COLLECTOR_TRIGGER.handler &&
      t.getUniqueId() === requestedId
  );

  if (matches.length !== 1) {
    throw new Error('PRODUCTION_TRIGGER_IDENTITY_MISMATCH');
  }

  ScriptApp.deleteTrigger(matches[0]);

  const remaining = ScriptApp.getProjectTriggers();
  const stillPresent = remaining.some(
    t => t.getHandlerFunction() === PROD_COLLECTOR_TRIGGER.handler &&
      t.getUniqueId() === requestedId
  );
  if (stillPresent) throw new Error('PRODUCTION_TRIGGER_DELETE_VERIFY_FAILED');

  const result = {
    status: 'PASS',
    removedTriggerUniqueId: requestedId,
    remainingProjectTriggerCount: remaining.length
  };
  console.log(JSON.stringify(result));
  return result;
}

function installMechanicalProductionTrigger() {
  throw new Error('DEPRECATED_ENTRYPOINT: use installProductionCollectorHourlyTrigger after Human Gate');
}
