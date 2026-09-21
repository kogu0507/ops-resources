/**
 * GAS Mechanical Layer M2-B trigger preflight + TEST-only trigger contract.
 * Production trigger creation is not exposed here.
 */
const M2B_TRIGGER = Object.freeze({
  handler: 'mechanicalM2BTestTick',
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

function installMechanicalProductionTrigger() {
  throw new Error('HUMAN GATE REQUIRED: production trigger installation disabled');
}
