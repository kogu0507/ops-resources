/**
 * Directory Contract Checker PoC.
 * DETECT_ONLY / Dev-only probe. No Drive mutation, rename, move, conversion, or repair.
 */
const DIRECTORY_CONTRACT_POC = Object.freeze({
  VERSION: 'directory-contract-poc-0.1.0',
  TEST_FOLDER_ID: '1F7DC2PbwGH02sm7Fo4YbqF8-2juK1wPc',
  MAX_FILES: 100
});

function runDirectoryContractFixtureAcceptance() {
  requireDevRuntimeForTestMutation_();

  const contract = {
    allowedMimeTypes: ['text/markdown'],
    allowedExtensions: ['.md'],
    requiredNames: ['README.md'],
    filenamePattern: '^[A-Za-z0-9._ -]+\\.md$'
  };

  const clean = evaluateDirectoryContractSnapshot_([
    {id:'1', name:'README.md', mimeType:'text/markdown', trashed:false},
    {id:'2', name:'HANDOFF.md', mimeType:'text/markdown', trashed:false}
  ], contract);
  directoryContractAssert_(clean.healthy === true, 'clean fixture must be healthy');

  const mixed = evaluateDirectoryContractSnapshot_([
    {id:'1', name:'README.md', mimeType:'text/markdown', trashed:false},
    {id:'2', name:'Accidental Doc', mimeType:'application/vnd.google-apps.document', trashed:false},
    {id:'3', name:'notes.txt', mimeType:'text/plain', trashed:false},
    {id:'4', name:'README.md', mimeType:'text/markdown', trashed:false}
  ], contract);

  directoryContractAssert_(mixed.healthy === false, 'mixed fixture must fail health');
  directoryContractAssert_(mixed.violations.some(v => v.code === 'MIME_NOT_ALLOWED'), 'MIME violation missing');
  directoryContractAssert_(mixed.violations.some(v => v.code === 'EXTENSION_NOT_ALLOWED'), 'extension violation missing');
  directoryContractAssert_(mixed.violations.some(v => v.code === 'DUPLICATE_NAME'), 'duplicate-name violation missing');

  let malformedClosed = false;
  try {
    evaluateDirectoryContractSnapshot_([], {});
  } catch (e) {
    malformedClosed = Boolean(e && e.directoryContractCode === 'CONTRACT_INVALID');
  }
  directoryContractAssert_(malformedClosed, 'malformed contract must fail closed');

  const result = {
    status:'PASS',
    version:DIRECTORY_CONTRACT_POC.VERSION,
    clean_healthy:clean.healthy,
    mixed_violation_codes:mixed.violations.map(v => v.code)
  };
  console.log(JSON.stringify(result));
  return result;
}

function runDirectoryContractDevProbe() {
  requireDevRuntimeForTestMutation_();

  const folderId = DIRECTORY_CONTRACT_POC.TEST_FOLDER_ID;
  const contract = {
    // Initial empirical probe is detection-only. It intentionally does not assume
    // the existing TEST folder is markdown-only; observed MIME/extensions are evidence.
    allowedMimeTypes: null,
    allowedExtensions: null,
    requiredNames: [],
    filenamePattern: null
  };

  const items = [];
  let pageToken = null;
  do {
    const response = Drive.Files.list({
      q: "'" + folderId + "' in parents and trashed = false",
      fields:'nextPageToken,files(id,name,mimeType,modifiedTime,trashed)',
      pageSize:100,
      pageToken:pageToken
    });
    (response.files || []).forEach(file => {
      if (items.length >= DIRECTORY_CONTRACT_POC.MAX_FILES) {
        throw directoryContractError_('FOLDER_LIMIT', 'folder exceeds bounded file limit');
      }
      items.push(file);
    });
    pageToken = response.nextPageToken || null;
  } while (pageToken);

  const evaluated = evaluateDirectoryContractSnapshot_(items, contract);
  const result = {
    status:'PASS',
    mode:'DETECT_ONLY',
    folder_id:folderId,
    scanned_file_count:items.length,
    observed_mime_types:Array.from(new Set(items.map(x => String(x.mimeType || '')))).sort(),
    observed_extensions:Array.from(new Set(items.map(x => directoryContractExtension_(x.name)))).sort(),
    violations:evaluated.violations
  };
  console.log(JSON.stringify(result));
  return result;
}

function evaluateDirectoryContractSnapshot_(files, contract) {
  const c = contract || {};
  const hasAnyContract =
    Array.isArray(c.allowedMimeTypes) ||
    Array.isArray(c.allowedExtensions) ||
    Array.isArray(c.requiredNames) ||
    typeof c.filenamePattern === 'string';

  if (!hasAnyContract) {
    throw directoryContractError_('CONTRACT_INVALID', 'directory contract has no recognized fields');
  }

  const allowedMimeTypes = Array.isArray(c.allowedMimeTypes) ? new Set(c.allowedMimeTypes.map(String)) : null;
  const allowedExtensions = Array.isArray(c.allowedExtensions) ? new Set(c.allowedExtensions.map(x => String(x).toLowerCase())) : null;
  const requiredNames = Array.isArray(c.requiredNames) ? c.requiredNames.map(String) : [];
  let filenameRe = null;
  if (typeof c.filenamePattern === 'string' && c.filenamePattern) {
    try {
      filenameRe = new RegExp(c.filenamePattern);
    } catch (e) {
      throw directoryContractError_('CONTRACT_INVALID', 'filenamePattern is invalid');
    }
  }

  const active = (files || []).filter(x => x && x.trashed !== true);
  const violations = [];
  const nameCounts = {};

  active.forEach(file => {
    const name = String(file.name || '');
    const mimeType = String(file.mimeType || '');
    const ext = directoryContractExtension_(name);
    nameCounts[name] = (nameCounts[name] || 0) + 1;

    if (allowedMimeTypes && !allowedMimeTypes.has(mimeType)) {
      violations.push({code:'MIME_NOT_ALLOWED', file_id:String(file.id || ''), name:name, observed:mimeType});
    }
    if (allowedExtensions && !allowedExtensions.has(ext)) {
      violations.push({code:'EXTENSION_NOT_ALLOWED', file_id:String(file.id || ''), name:name, observed:ext});
    }
    if (filenameRe && !filenameRe.test(name)) {
      violations.push({code:'FILENAME_PATTERN_MISMATCH', file_id:String(file.id || ''), name:name});
    }
  });

  Object.keys(nameCounts).sort().forEach(name => {
    if (nameCounts[name] > 1) {
      violations.push({code:'DUPLICATE_NAME', name:name, count:nameCounts[name]});
    }
  });

  requiredNames.forEach(name => {
    if (!nameCounts[name]) violations.push({code:'REQUIRED_FILE_MISSING', name:name});
  });

  return {
    healthy:violations.length === 0,
    scannedFileCount:active.length,
    violations:violations.slice(0, 100),
    truncatedViolations:violations.length > 100
  };
}

function directoryContractExtension_(name) {
  const value = String(name || '');
  const i = value.lastIndexOf('.');
  return i <= 0 ? '' : value.slice(i).toLowerCase();
}

function directoryContractAssert_(condition, message) {
  if (!condition) throw directoryContractError_('ACCEPTANCE_FAILED', message);
}

function directoryContractError_(code, message) {
  const e = new Error(message);
  e.directoryContractCode = code;
  return e;
}
