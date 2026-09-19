/**
 * CI/CD bootstrap smoke source.
 * Safe by design: no Drive/Sheet writes, no trigger creation.
 */
const BUILD_INFO = Object.freeze({
  component: 'ai-automation-drive-state',
  version: 'bootstrap-0.1.0'
});

function ciCdSmoke() {
  const result = {
    ok: true,
    component: BUILD_INFO.component,
    version: BUILD_INFO.version,
    timestamp: new Date().toISOString()
  };
  console.log(JSON.stringify(result));
  return result;
}

function installProductionTrigger() {
  throw new Error('HUMAN GATE REQUIRED: production trigger installation disabled');
}
