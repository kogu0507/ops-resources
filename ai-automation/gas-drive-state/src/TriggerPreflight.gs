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
