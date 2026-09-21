/**
 * GAS Mechanical Layer M2-C candidate.
 * Bounded Drive create/copy primitives under drive.file.
 * No Production writes. TEST acceptance uses exact IDs and trashes only files created by this run.
 */
const M2C_DRIVE = Object.freeze({
  sourceFileId: '1Lu7bqDpNtNsmZJsIGzah0T_mxABen6gEbqHqFZ7AKz0',
  testPrefix: 'M2C_TEST_',
  writeScope: 'https://www.googleapis.com/auth/drive.file'
});

function validateMechanicalCreateSpec_(spec) {
  const s = spec || {};
  if (typeof s.name !== 'string' || !s.name.trim()) throw new Error('INVALID_NAME');
  if (s.parentId != null && (typeof s.parentId !== 'string' || !s.parentId.trim())) throw new Error('INVALID_PARENT_ID');
  if (s.mimeType && s.mimeType !== 'application/vnd.google-apps.document') throw new Error('UNSUPPORTED_MIME_TYPE');
  return {
    name: s.name.trim(),
    mimeType: s.mimeType || 'application/vnd.google-apps.document',
    parentId: s.parentId ? s.parentId.trim() : null
  };
}

function createMechanicalDriveFile(spec) {
  const s = validateMechanicalCreateSpec_(spec);
  const body = {name: s.name, mimeType: s.mimeType};
  if (s.parentId) body.parents = [s.parentId];

  const created = Drive.Files.create(body, null, {
    fields: 'id,name,mimeType,parents,trashed'
  });

  let readback = null;
  try {
    readback = Drive.Files.get(created.id, {
      fields: 'id,name,mimeType,parents,trashed'
    });
    return {
      status: readback && readback.id === created.id && !readback.trashed ? 'PASS' : 'CREATE_VERIFY_FAILED',
      createdFileId: created.id,
      file: readback
    };
  } catch (err) {
    return {
      status: 'CREATE_VERIFY_FAILED',
      createdFileId: created.id,
      reason: String(err && err.message ? err.message : err)
    };
  }
}

function copyMechanicalDriveFile(sourceFileId, spec) {
  if (typeof sourceFileId !== 'string' || !sourceFileId.trim()) throw new Error('INVALID_SOURCE_FILE_ID');
  const s = validateMechanicalCreateSpec_(spec);

  const body = {name: s.name};
  if (s.parentId) body.parents = [s.parentId];

  const copied = Drive.Files.copy(body, sourceFileId.trim(), {
    fields: 'id,name,mimeType,parents,trashed',
    supportsAllDrives: true
  });

  let readback = null;
  try {
    readback = Drive.Files.get(copied.id, {
      fields: 'id,name,mimeType,parents,trashed'
    });
    return {
      status: readback && readback.id === copied.id && !readback.trashed ? 'PASS' : 'COPY_VERIFY_FAILED',
      copiedFileId: copied.id,
      file: readback
    };
  } catch (err) {
    return {
      status: 'COPY_VERIFY_FAILED',
      copiedFileId: copied.id,
      reason: String(err && err.message ? err.message : err)
    };
  }
}

function trashMechanicalCreatedFile_(fileId) {
  if (typeof fileId !== 'string' || !fileId.trim()) return {status: 'SKIPPED'};
  Drive.Files.update(
    {trashed: true},
    fileId.trim(),
    null,
    {fields: 'id,trashed'}
  );
  const readback = Drive.Files.get(fileId.trim(), {
    fields: 'id,trashed'
  });
  return {
    status: readback && readback.id === fileId.trim() && readback.trashed ? 'PASS' : 'TRASH_VERIFY_FAILED',
    file: readback
  };
}

function runMechanicalM2CAcceptance() {
  ScriptApp.requireScopes(
    ScriptApp.AuthMode.FULL,
    [M2C_DRIVE.writeScope]
  );

  const stamp = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyyMMdd_HHmmss');
  let createdId = null;
  let copiedId = null;
  let created = null;
  let copied = null;
  let createdCleanup = {status: 'NOT_RUN'};
  let copiedCleanup = {status: 'NOT_RUN'};

  try {
    created = createMechanicalDriveFile({
      name: M2C_DRIVE.testPrefix + 'CREATE_' + stamp
    });
    createdId = created.createdFileId || (created.file && created.file.id) || null;
    if (createdId) console.log(JSON.stringify({event: 'M2C_CREATED_ARTIFACT', fileId: createdId}));
    if (created.status !== 'PASS' || !createdId) {
      throw new Error('CREATE_ACCEPTANCE_FAILED');
    }

    copied = copyMechanicalDriveFile(M2C_DRIVE.sourceFileId, {
      name: M2C_DRIVE.testPrefix + 'COPY_' + stamp
    });
    copiedId = copied.copiedFileId || (copied.file && copied.file.id) || null;
    if (copiedId) console.log(JSON.stringify({event: 'M2C_COPIED_ARTIFACT', fileId: copiedId}));
    if (copied.status !== 'PASS' || !copiedId) {
      throw new Error('COPY_ACCEPTANCE_FAILED');
    }
  } finally {
    if (copiedId) copiedCleanup = trashMechanicalCreatedFile_(copiedId);
    if (createdId) createdCleanup = trashMechanicalCreatedFile_(createdId);
  }

  const checks = {
    createVerified: Boolean(created && created.status === 'PASS'),
    copyVerified: Boolean(copied && copied.status === 'PASS'),
    createdCleanupVerified: createdCleanup.status === 'PASS',
    copiedCleanupVerified: copiedCleanup.status === 'PASS'
  };
  const pass = Object.keys(checks).every(k => checks[k] === true);

  const result = {
    status: pass ? 'PASS' : 'FAIL',
    checks,
    sourceFileId: M2C_DRIVE.sourceFileId,
    createdFileId: createdId,
    copiedFileId: copiedId,
    cleanupMode: 'TRASH_ONLY_REVERSIBLE'
  };
  console.log(JSON.stringify(result));
  return result;
}
