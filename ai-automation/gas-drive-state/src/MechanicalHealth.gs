/**
 * GAS Mechanical Layer M2-A candidate.
 * Read-only by design: public GitHub version check + exact Drive metadata checks.
 * No Drive mutation. No trigger creation.\n * Dev candidate URL is branch-pinned for pre-merge verification; Production must use an approved commit/ref.
 */
const MECHANICAL_LAYER_BUILD = Object.freeze({
  component: 'ai-automation-drive-state-mechanical',
  version: 'm2a-0.1.0',
  versionUrl: 'https://raw.githubusercontent.com/kogu0507/ops-resources/ai-auto-gas-mechanical-m2a/ai-automation/gas-drive-state/version.json'
});

function getMechanicalLayerBuildInfo() {
  return {
    component: MECHANICAL_LAYER_BUILD.component,
    version: MECHANICAL_LAYER_BUILD.version
  };
}

function checkMechanicalCanonicalVersion() {
  try {
    const response = UrlFetchApp.fetch(MECHANICAL_LAYER_BUILD.versionUrl, {
      method: 'get',
      muteHttpExceptions: true,
      followRedirects: true
    });
    const code = response.getResponseCode();
    if (code !== 200) {
      return {status: 'CHECK_FAILED', httpStatus: code};
    }
    const remote = JSON.parse(response.getContentText());
    if (!remote || remote.component !== MECHANICAL_LAYER_BUILD.component || typeof remote.version !== 'string') {
      return {status: 'CHECK_FAILED', reason: 'INVALID_VERSION_PAYLOAD'};
    }
    return {
      status: remote.version === MECHANICAL_LAYER_BUILD.version ? 'MATCH' : 'UPDATE_AVAILABLE',
      runtimeVersion: MECHANICAL_LAYER_BUILD.version,
      canonicalVersion: remote.version
    };
  } catch (err) {
    return {status: 'CHECK_FAILED', reason: String(err && err.message ? err.message : err)};
  }
}

function readExactDriveMetadata(fileId) {
  if (typeof fileId !== 'string' || !fileId.trim()) {
    return {status: 'READ_FAILED', reason: 'INVALID_FILE_ID'};
  }
  try {
    const file = Drive.Files.get(fileId.trim(), {
      fields: 'id,name,mimeType,modifiedTime,trashed'
    });
    return {
      status: 'PASS',
      file: {
        id: file.id,
        name: file.name,
        mimeType: file.mimeType,
        modifiedTime: file.modifiedTime || null,
        trashed: Boolean(file.trashed)
      }
    };
  } catch (err) {
    return {
      status: 'READ_FAILED',
      fileId: fileId.trim(),
      reason: String(err && err.message ? err.message : err)
    };
  }
}

function runMechanicalHealthCheck(input) {
  const request = input || {};
  const ids = Array.isArray(request.driveFileIds) ? request.driveFileIds : [];
  if (ids.length > 20) {
    return {status: 'FAIL', reason: 'TOO_MANY_FILE_IDS', max: 20};
  }

  const version = checkMechanicalCanonicalVersion();
  const drive = ids.map(readExactDriveMetadata);
  const failedReads = drive.filter(x => x.status !== 'PASS').length;

  let status = 'PASS';
  if (version.status === 'CHECK_FAILED' || failedReads > 0) status = 'PARTIAL';

  return {
    status,
    checkedAt: new Date().toISOString(),
    build: getMechanicalLayerBuildInfo(),
    versionCheck: version,
    driveChecks: drive,
    summary: {
      requestedDriveChecks: ids.length,
      failedDriveChecks: failedReads
    }
  };
}


function logMechanicalCanonicalVersionCheck() {
  const result = checkMechanicalCanonicalVersion();
  console.log(JSON.stringify(result));
  return result;
}

function logMechanicalExactDriveRead(fileId) {
  const result = readExactDriveMetadata(fileId);
  console.log(JSON.stringify(result));
  return result;
}
