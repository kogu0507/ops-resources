/* JsonDiffCore: service-free GAS V8. No IO, time, random, or platform codecs.
 * Error preflight (fixed before implementation): parse PROFILE, BEFORE, AFTER;
 * then validate profile, select/index/project BEFORE then AFTER; diff; output cap.
 * Within each parse: byte type -> byte length -> byte values -> UTF8/BOM ->
 * source-order JSON traversal (node, depth, string, duplicate, number) -> trailing.
 * Within profile: exact keys -> schemaVersion -> profileVersion -> recordsPath ->
 * idKey -> ignorePaths (count, source-order pointer/ID/overlap). Index each side:
 * records selection/type/count -> source-order record type/ID/duplicate/projection.
 * Error vocabulary: BYTE_TYPE, BYTE_LIMIT, BYTE_VALUE, UTF8_INVALID, UTF8_BOM,
 * JSON_SYNTAX, JSON_SURROGATE, JSON_DUPLICATE_KEY, NODE_LIMIT, DEPTH_LIMIT,
 * STRING_LIMIT, NUMBER_TOKEN_LIMIT, NUMBER_EXPONENT_LIMIT, NUMBER_UNSAFE,
 * PROFILE_SCHEMA, PROFILE_VERSION, POINTER_INVALID, POINTER_LIMIT,
 * PROFILE_ID_KEY, IGNORE_LIMIT, IGNORE_INVALID, IGNORE_OVERLAP,
 * RECORDS_PATH, RECORDS_TYPE, RECORD_LIMIT, RECORD_TYPE, ID_INVALID, ID_LIMIT,
 * ID_DUPLICATE, IGNORE_TRAVERSAL, CHANGE_LIMIT, OUTPUT_LIMIT, INTERNAL_ERROR.
 * All messages are constant. Error paths contain schema/location keys only,
 * never primitive input values; unresolved paths report the last resolved parent.
 */
var JsonDiffCore = (function () {
  'use strict';
  var own = function (o, k) { return Object.prototype.hasOwnProperty.call(o, k); };
  var object = function (v) { return v !== null && typeof v === 'object' && !Array.isArray(v); };
  var cmp = function (a, b) { return a < b ? -1 : a > b ? 1 : 0; };
  var esc = function (s) { return s.replace(/~/g, '~0').replace(/\//g, '~1'); };
  var ptr = function (tokens) { return tokens.length ? '/' + tokens.map(esc).join('/') : ''; };
  function fail(code, input, path) {
    throw { jsonDiffError: true, code: code, input: input, path: path || '', message: 'Input or output violates ' + code + '.' };
  }
  function utf8(bytes, input, limit) {
    if (!Array.isArray(bytes) && !(ArrayBuffer.isView(bytes) && Object.prototype.toString.call(bytes) === '[object Uint8Array]')) fail('BYTE_TYPE', input, '');
    if (bytes.length > limit) fail('BYTE_LIMIT', input, '');
    for (var v = 0; v < bytes.length; v++) if (!Number.isInteger(bytes[v]) || bytes[v] < 0 || bytes[v] > 255) fail('BYTE_VALUE', input, '');
    if (bytes.length >= 3 && bytes[0] === 239 && bytes[1] === 187 && bytes[2] === 191) fail('UTF8_BOM', input, '');
    var out = [], chunk = '';
    for (var i = 0; i < bytes.length;) {
      var c = bytes[i++], n = 0, cp = c, min = 0;
      if (c <= 127) n = 0;
      else if (c >= 194 && c <= 223) { n = 1; cp = c & 31; min = 128; }
      else if (c >= 224 && c <= 239) { n = 2; cp = c & 15; min = 2048; }
      else if (c >= 240 && c <= 244) { n = 3; cp = c & 7; min = 65536; }
      else fail('UTF8_INVALID', input, '');
      if (i + n > bytes.length) fail('UTF8_INVALID', input, '');
      for (var j = 0; j < n; j++) { var b = bytes[i++]; if (b < 128 || b > 191) fail('UTF8_INVALID', input, ''); cp = cp * 64 + (b & 63); }
      if (cp < min || cp > 1114111 || (cp >= 55296 && cp <= 57343)) fail('UTF8_INVALID', input, '');
      chunk += cp < 65536 ? String.fromCharCode(cp) : String.fromCharCode(55296 + ((cp - 65536) >> 10), 56320 + ((cp - 65536) & 1023));
      if (chunk.length >= 4096) { out.push(chunk); chunk = ''; }
    }
    out.push(chunk); return out.join('');
  }
  // Decimal normalization is bounded by token length, never exponent magnitude.
  function decimal(s) {
    var m = /^(-?)(\d+)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/.exec(s);
    var digits = (m[2] + (m[3] || '')).replace(/^0+/, '');
    if (!digits) return '0';
    var exponent = Number(m[4] || 0) - (m[3] || '').length;
    var zeros = /0+$/.exec(digits);
    if (zeros) { exponent += zeros[0].length; digits = digits.slice(0, -zeros[0].length); }
    return m[1] + digits + 'e' + exponent;
  }
  function parse(bytes, input, limit) {
    var text = utf8(bytes, input, limit), pos = 0, nodes = 0;
    function error(code, path) { fail(code, input, path); }
    function ws() { while (pos < text.length && /[\x20\t\r\n]/.test(text[pos])) pos++; }
    function str(path) {
      var start = pos++;
      while (pos < text.length) {
        var c = text.charCodeAt(pos++);
        if (c === 34) {
          var value;
          try { value = JSON.parse(text.slice(start, pos)); } catch (_) { error('JSON_SYNTAX', path); }
          if (value.length > 262144) error('STRING_LIMIT', path);
          for (var k = 0; k < value.length; k++) {
            var unit = value.charCodeAt(k);
            if (unit >= 55296 && unit <= 56319) { var next = value.charCodeAt(++k); if (!(next >= 56320 && next <= 57343)) error('JSON_SURROGATE', path); }
            else if (unit >= 56320 && unit <= 57343) error('JSON_SURROGATE', path);
          }
          return value;
        }
        if (c < 32) error('JSON_SYNTAX', path);
        if (c === 92) { // JSON.parse below validates the escape spelling and hex.
          if (pos >= text.length) error('JSON_SYNTAX', path);
          pos++;
        }
      }
      error('JSON_SYNTAX', path);
    }
    function value(depth, path) {
      ws(); if (++nodes > 50000) error('NODE_LIMIT', path);
      var c = text[pos];
      if (c === '{' || c === '[') {
        if (++depth > 20) error('DEPTH_LIMIT', path);
        var array = c === '[', result = array ? [] : Object.create(null), end = array ? ']' : '}';
        pos++; ws(); if (text[pos] === end) { pos++; return result; }
        while (true) {
          ws(); var key;
          if (array) key = String(result.length);
          else { if (text[pos] !== '"') error('JSON_SYNTAX', path); key = str(path); if (own(result, key)) error('JSON_DUPLICATE_KEY', path); ws(); if (text[pos++] !== ':') error('JSON_SYNTAX', path); }
          var child = value(depth, path + '/' + esc(key));
          if (array) result.push(child); else result[key] = child;
          ws(); var token = text[pos++]; if (token === end) return result;
          if (token !== ',') error('JSON_SYNTAX', path);
        }
      }
      if (c === '"') return str(path);
      if (text.slice(pos, pos + 4) === 'true') { pos += 4; return true; }
      if (text.slice(pos, pos + 5) === 'false') { pos += 5; return false; }
      if (text.slice(pos, pos + 4) === 'null') { pos += 4; return null; }
      var start = pos;
      while (pos < text.length && !/[\x20\t\r\n,\]}]/.test(text[pos])) pos++;
      var raw = text.slice(start, pos);
      if (!/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(raw)) error('JSON_SYNTAX', path);
      if (raw.length > 128) error('NUMBER_TOKEN_LIMIT', path);
      var exp = /[eE][+-]?(\d+)$/.exec(raw);
      if (exp && exp[1].length > 6) error('NUMBER_EXPONENT_LIMIT', path);
      var number = Number(raw);
      if (!Number.isFinite(number) || (Number.isInteger(number) && !Number.isSafeInteger(number)) || decimal(raw) !== decimal(JSON.stringify(number))) error('NUMBER_UNSAFE', path);
      return number === 0 ? 0 : number;
    }
    var root = value(0, ''); ws(); if (pos !== text.length) error('JSON_SYNTAX', ''); return root;
  }
  function pointer(p, inputPath) {
    if (typeof p !== 'string') fail('POINTER_INVALID', 'PROFILE', inputPath);
    if (p.length > 1024) fail('POINTER_LIMIT', 'PROFILE', inputPath);
    if (p === '') return [];
    if (p[0] !== '/' || /~(?:[^01]|$)/.test(p)) fail('POINTER_INVALID', 'PROFILE', inputPath);
    return p.slice(1).split('/').map(function (s) { return s.replace(/~1/g, '/').replace(/~0/g, '~'); });
  }
  function profile(p) {
    var keys = ['schemaVersion', 'profileVersion', 'recordsPath', 'idKey', 'ignorePaths'];
    if (!object(p) || Object.keys(p).length !== 5 || keys.some(function (k) { return !own(p, k); })) fail('PROFILE_SCHEMA', 'PROFILE', '');
    if (p.schemaVersion !== 'json-diff-profile/1') fail('PROFILE_SCHEMA', 'PROFILE', '/schemaVersion');
    if (typeof p.profileVersion !== 'string' || !/^[A-Za-z0-9._-]{1,64}$/.test(p.profileVersion)) fail('PROFILE_VERSION', 'PROFILE', '/profileVersion');
    var records = pointer(p.recordsPath, '/recordsPath');
    if (typeof p.idKey !== 'string' || !p.idKey.length) fail('PROFILE_ID_KEY', 'PROFILE', '/idKey');
    if (!Array.isArray(p.ignorePaths)) fail('IGNORE_INVALID', 'PROFILE', '/ignorePaths');
    if (p.ignorePaths.length > 32) fail('IGNORE_LIMIT', 'PROFILE', '/ignorePaths');
    var ignores = [];
    p.ignorePaths.forEach(function (s, i) {
      var t = pointer(s, '/ignorePaths/' + i);
      if (!t.length || t[0] === p.idKey) fail('IGNORE_INVALID', 'PROFILE', '/ignorePaths/' + i);
      for (var j = 0; j < ignores.length; j++) {
        var a = ignores[j], count = Math.min(a.length, t.length), same = true;
        for (var k = 0; k < count; k++) if (a[k] !== t[k]) { same = false; break; }
        if (same) fail('IGNORE_OVERLAP', 'PROFILE', '/ignorePaths/' + i);
      }
      ignores.push(t);
    });
    ignores.sort(function (a, b) { return cmp(ptr(a), ptr(b)); });
    var canonical = {schemaVersion: p.schemaVersion, profileVersion: p.profileVersion, recordsPath: ptr(records), idKey: p.idKey, ignorePaths: ignores.map(ptr)};
    return {records: records, idKey: p.idKey, ignores: ignores, identity: JSON.stringify(canonical)};
  }
  function clone(v) {
    if (Array.isArray(v)) return v.map(clone);
    if (!object(v)) return v;
    var out = Object.create(null);
    Object.keys(v).sort(cmp).forEach(function (k) { out[k] = clone(v[k]); }); return out;
  }
  function index(root, p, input) {
    var selected = root, resolved = '';
    p.records.forEach(function (key) {
      if ((!object(selected) && !Array.isArray(selected)) || (Array.isArray(selected) && !/^(?:0|[1-9]\d*)$/.test(key)) || !own(selected, key)) fail('RECORDS_PATH', input, resolved);
      selected = selected[key]; resolved += '/' + esc(key);
    });
    if (!Array.isArray(selected)) fail('RECORDS_TYPE', input, resolved);
    if (selected.length > 1000) fail('RECORD_LIMIT', input, resolved);
    var map = Object.create(null);
    selected.forEach(function (record, n) {
      var location = resolved + '/' + n;
      if (!object(record)) fail('RECORD_TYPE', input, location);
      if (!own(record, p.idKey) || typeof record[p.idKey] !== 'string' || record[p.idKey].length === 0) fail('ID_INVALID', input, location);
      var id = record[p.idKey];
      if (id.length > 256) fail('ID_LIMIT', input, location);
      if (own(map, id)) fail('ID_DUPLICATE', input, location);
      var projected = clone(record);
      p.ignores.forEach(function (tokens) {
        var current = projected, path = location;
        for (var j = 0; j < tokens.length; j++) {
          if (!object(current)) fail('IGNORE_TRAVERSAL', input, path);
          var key = tokens[j]; if (!own(current, key)) return;
          if (j === tokens.length - 1) { delete current[key]; return; }
          current = current[key]; path += '/' + esc(key);
        }
      });
      map[id] = projected;
    }); return {map: map, count: selected.length};
  }
  function equal(a, b) {
    if (a === b) return true;
    if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every(function (v, i) { return equal(v, b[i]); });
    if (object(a) && object(b)) { var keys = Object.keys(a); return keys.length === Object.keys(b).length && keys.every(function (k) { return own(b, k) && equal(a[k], b[k]); }); }
    return false;
  }
  function byteLength(s) {
    var n = 0;
    for (var i = 0; i < s.length; i++) { var c = s.charCodeAt(i); if (c < 128) n++; else if (c < 2048) n += 2; else if (c >= 55296 && c <= 56319) { n += 4; i++; } else n += 3; }
    return n;
  }
  function compareUtf8(beforeBytes, afterBytes, profileBytes) {
    try {
      var rawProfile = parse(profileBytes, 'PROFILE', 16384);
      var before = parse(beforeBytes, 'BEFORE', 1048576);
      var after = parse(afterBytes, 'AFTER', 1048576);
      var p = profile(rawProfile), b = index(before, p, 'BEFORE'), a = index(after, p, 'AFTER');
      var changes = [], changesJsonBytes = 2, added = 0, removed = 0, modified = 0, unchanged = 0;
      function emit(category, id, path, hasB, bv, hasA, av) {
        if (changes.length >= 10000) fail('CHANGE_LIMIT', 'OUTPUT', '');
        var entry = {category: category, recordId: id, path: path, kind: !hasB ? 'ADDED' : !hasA ? 'REMOVED' : 'REPLACED', before: hasB ? {present: true, value: bv} : {present: false}, after: hasA ? {present: true, value: av} : {present: false}};
        // Bound repeated long-path amplification before retaining the next entry.
        // The array alone is a lower bound, so this cannot reject a valid envelope.
        // Exact envelope/counter/profile byte accounting remains the final gate.
        changesJsonBytes += byteLength(JSON.stringify(entry)) + (changes.length ? 1 : 0);
        if (changesJsonBytes > 8388608) fail('OUTPUT_LIMIT', 'OUTPUT', '');
        changes.push(entry);
      }
      function diff(id, path, bv, av) {
        if (equal(bv, av)) return;
        if (object(bv) && object(av)) {
          var keys = Object.keys(bv).concat(Object.keys(av)).sort(cmp);
          keys.forEach(function (k, i) {
            if (i && keys[i - 1] === k) return;
            var hasB = own(bv, k), hasA = own(av, k), child = path + '/' + esc(k);
            if (!hasB || !hasA) emit('FIELD', id, child, hasB, bv[k], hasA, av[k]);
            else diff(id, child, bv[k], av[k]);
          });
        } else emit('FIELD', id, path, true, bv, true, av);
      }
      var ids = Object.keys(b.map).concat(Object.keys(a.map)).sort(cmp);
      ids.forEach(function (id, i) {
        if (i && ids[i - 1] === id) return;
        var hasB = own(b.map, id), hasA = own(a.map, id);
        if (!hasB) { added++; emit('RECORD', id, '', false, undefined, true, a.map[id]); }
        else if (!hasA) { removed++; emit('RECORD', id, '', true, b.map[id], false, undefined); }
        else { var start = changes.length; diff(id, '', b.map[id], a.map[id]); if (changes.length > start) modified++; else unchanged++; }
      });
      changes.sort(function (x, y) { return cmp(x.recordId, y.recordId) || cmp(x.path, y.path) || cmp(x.category, y.category) || cmp(x.kind, y.kind); });
      var answer = {ok: true, result: {schemaVersion: 'json-diff-result/1', profileIdentity: p.identity, status: changes.length ? 'CHANGED' : 'UNCHANGED', counts: {beforeRecords: b.count, afterRecords: a.count, addedRecords: added, removedRecords: removed, modifiedRecords: modified, unchangedRecords: unchanged, changeEntries: changes.length}, changes: changes}};
      if (byteLength(JSON.stringify(answer)) > 8388608) fail('OUTPUT_LIMIT', 'OUTPUT', '');
      return answer;
    } catch (e) {
      if (e && e.jsonDiffError) return {ok: false, error: {code: e.code, input: e.input, path: e.path, message: e.message}};
      return {ok: false, error: {code: 'INTERNAL_ERROR', input: 'OUTPUT', path: '', message: 'Comparison could not complete.'}};
    }
  }
  function parseConfigUtf8(bytes) {
    try {
      var value = parse(bytes, 'CONFIG', 65536);
      var keys = ['schemaVersion', 'runId', 'beforeFileId', 'afterFileId', 'profile'];
      if (!object(value) || Object.keys(value).length !== 5 || keys.some(function (k) { return !own(value, k); }) || value.schemaVersion !== 'json-diff-job/1' || typeof value.runId !== 'string' || !/^[\x21-\x7e]{1,64}$/.test(value.runId) || typeof value.beforeFileId !== 'string' || typeof value.afterFileId !== 'string') fail('CONFIG_SCHEMA', 'CONFIG', '');
      if (byteLength(JSON.stringify(value.profile)) > 16384) fail('BYTE_LIMIT', 'CONFIG', '/profile');
      profile(value.profile);
      return {ok: true, value: value};
    } catch (e) {
      if (e && e.jsonDiffError) return {ok: false, error: {code: e.code, input: 'CONFIG', path: e.path, message: e.message}};
      return {ok: false, error: {code: 'INTERNAL_ERROR', input: 'CONFIG', path: '', message: 'Configuration could not complete.'}};
    }
  }
  return Object.freeze({compareUtf8: compareUtf8, parseConfigUtf8: parseConfigUtf8});
}());
