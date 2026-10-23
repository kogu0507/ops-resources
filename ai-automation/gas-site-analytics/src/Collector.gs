/* Isolated snapshot collector. No triggers, deployment mapping or credentials. */
var SiteAnalytics = (function () {
  'use strict';
  var HEADER = ['snapshot_key', 'record_type', 'json_v1'];
  function assert(ok, message) { if (!ok) throw new Error(message); }
  function canonical(value) {
    if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
    if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map(function (k) { return JSON.stringify(k) + ':' + canonical(value[k]); }).join(',') + '}';
    return JSON.stringify(value);
  }
  function date(value) {
    assert(typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && new Date(value + 'T00:00:00Z').toISOString().slice(0, 10) === value, 'Invalid date');
    return value;
  }
  function validate(c) {
    assert(c && c.liveEnabled === true, 'Human Gate: liveEnabled must be explicitly approved');
    assert(typeof c.gscSite === 'string' && /^(sc-domain:[^/\s]+|https?:\/\/[^\s]+)$/.test(c.gscSite), 'Set exact GSC site');
    assert(/^\d+$/.test(c.ga4Property || ''), 'Set exact GA4 property');
    assert(/^[A-Za-z0-9_-]+$/.test(c.spreadsheetId || '') && !/REPLACE/.test(c.spreadsheetId), 'Set dedicated spreadsheet ID');
    assert(Number.isInteger(c.sheetId) && c.sheetId >= 0 && typeof c.sheetTitle === 'string' && c.sheetTitle.length > 0, 'Set dedicated sheet');
    ['gsc', 'ga4'].forEach(function (s) {
      date(c[s + 'End']); date(c[s + 'ConfirmedThrough']);
      assert(c[s + 'End'] <= c[s + 'ConfirmedThrough'], 'Window exceeds operator confirmed-through');
    });
    assert(Number.isInteger(c.pageSize) && c.pageSize >= 1 && c.pageSize <= 25000, 'Invalid pageSize');
    assert(Number.isInteger(c.maxPages) && c.maxPages >= 1 && c.maxPages <= 20, 'Invalid maxPages');
  }
  function start(end) { return new Date(Date.parse(end + 'T00:00:00Z') - 27 * 86400000).toISOString().slice(0, 10); }
  function definitions(c) {
    return [
      { source: 'gsc', name: 'total', dimensions: [], metrics: ['clicks', 'impressions', 'ctr', 'position'] },
      { source: 'gsc', name: 'query', dimensions: ['query'], metrics: ['clicks', 'impressions', 'ctr', 'position'] },
      { source: 'gsc', name: 'page', dimensions: ['page'], metrics: ['clicks', 'impressions', 'ctr', 'position'] },
      { source: 'ga4', name: 'pages', dimensions: ['pagePathPlusQueryString', 'pageTitle'], metrics: ['screenPageViews', 'activeUsers'] },
      { source: 'ga4', name: 'acquisition', dimensions: ['sessionSource', 'sessionMedium'], metrics: ['sessions'] }
    ].map(function (d) {
      d.scope = d.source === 'gsc' ? c.gscSite : 'properties/' + c.ga4Property;
      d.period_end = c[d.source + 'End']; d.period_start = start(d.period_end);
      d.filters = null; d.searchType = d.source === 'gsc' ? 'web' : null;
      d.metric_definition = 'google-official-v1/' + d.source + '/' + d.name;
      return d;
    });
  }
  function request(d, c, offset) {
    if (d.source === 'gsc') return {url: 'https://www.googleapis.com/webmasters/v3/sites/' + encodeURIComponent(d.scope) + '/searchAnalytics/query', body: {
      startDate: d.period_start, endDate: d.period_end, dimensions: d.dimensions, type: 'web', dataState: 'final', rowLimit: c.pageSize, startRow: offset
    }};
    return {url: 'https://analyticsdata.googleapis.com/v1beta/' + d.scope + ':runReport', body: {
      dateRanges: [{startDate: d.period_start, endDate: d.period_end}], dimensions: d.dimensions.map(function (n) { return {name: n}; }),
      metrics: d.metrics.map(function (n) { return {name: n}; }), offset: String(offset), limit: String(c.pageSize), keepEmptyRows: false,
      orderBys: d.dimensions.map(function (n) { return {dimension: {dimensionName: n}, desc: false}; })
    }};
  }
  function numeric(value, integer) {
    assert((typeof value === 'number' || (typeof value === 'string' && /^(?:\d+\.?\d*|\d*\.\d+)(?:[eE][+-]?\d+)?$/.test(value))) && Number.isFinite(Number(value)) && Number(value) >= 0, 'Missing or invalid metric');
    var n = Number(value); assert(!integer || Number.isSafeInteger(n), 'Invalid count'); return n;
  }
  function normalize(d, response) {
    assert(response && typeof response === 'object' && !Array.isArray(response) && !response.error, 'Malformed API response');
    if (d.source === 'ga4') {
      assert(Array.isArray(response.dimensionHeaders) && canonical(response.dimensionHeaders.map(function (h) { return h.name; })) === canonical(d.dimensions), 'GA4 dimension headers mismatch');
      assert(Array.isArray(response.metricHeaders) && canonical(response.metricHeaders.map(function (h) { return h.name; })) === canonical(d.metrics), 'GA4 metric headers mismatch');
      // Protobuf JSON can omit the default rowCount=0 on an empty response.
      if (response.rowCount === undefined && (response.rows === undefined || (Array.isArray(response.rows) && response.rows.length === 0))) response.rowCount = 0;
      assert(Number.isSafeInteger(response.rowCount) && response.rowCount >= 0, 'Missing GA4 rowCount');
      assert(response.metadata && typeof response.metadata.timeZone === 'string' && response.metadata.timeZone.length > 0, 'Missing GA4 timezone');
    } else assert(response.responseAggregationType === (d.name === 'page' ? 'byPage' : 'byProperty'), 'Missing GSC aggregation');
    assert(response.rows === undefined || Array.isArray(response.rows), 'Invalid rows');
    return (response.rows || []).map(function (r) {
      var keys, values;
      if (d.source === 'gsc') {
        keys = r.keys || []; values = d.metrics.map(function (m) { return numeric(r[m], m === 'clicks' || m === 'impressions'); });
        assert(values[2] <= 1, 'Invalid CTR');
      } else {
        assert(Array.isArray(r.dimensionValues) && Array.isArray(r.metricValues) && r.metricValues.length === d.metrics.length, 'Malformed GA4 values');
        keys = r.dimensionValues.map(function (v) { return v.value; }); values = r.metricValues.map(function (v) { return numeric(v.value, true); });
      }
      assert(Array.isArray(keys) && keys.length === d.dimensions.length && keys.every(function (v) { return typeof v === 'string'; }), 'Malformed dimension values');
      return {dimensions: keys, metrics: values};
    });
  }
  function collect(d, c, io, observed) {
    if (d.source === 'ga4') {
      var check = io.post('https://analyticsdata.googleapis.com/v1beta/' + d.scope + ':checkCompatibility', {dimensions: d.dimensions.map(function (n) { return {name: n}; }), metrics: d.metrics.map(function (n) { return {name: n}; })});
      ['dimension', 'metric'].forEach(function (kind) {
        var expected = d[kind === 'dimension' ? 'dimensions' : 'metrics']; var entries = check[kind + 'Compatibilities'];
        assert(Array.isArray(entries) && expected.every(function (name) { return entries.some(function (x) { return x[kind + 'Metadata'] && x[kind + 'Metadata'].apiName === name && x.compatibility === 'COMPATIBLE'; }); }), 'GA4 compatibility not confirmed');
      });
    }
    var rows = [], seen = {}, metadata = null, count = null, done = false;
    for (var p = 0; p < c.maxPages; p++) {
      var req = request(d, c, rows.length); var response = io.post(req.url, req.body); var page = normalize(d, response);
      assert(page.length <= c.pageSize, 'Oversized API page');
      if (d.source === 'ga4') {
        if (count !== null) assert(count === response.rowCount && canonical(metadata) === canonical(response.metadata), 'GA4 report changed during pagination');
        count = response.rowCount; metadata = response.metadata;
      }
      page.forEach(function (r) { var key = canonical(r.dimensions); assert(!Object.prototype.hasOwnProperty.call(seen, key), 'Repeated dimension row'); seen[key] = true; rows.push(r); });
      if (d.source === 'ga4') {
        assert(rows.length <= count, 'GA4 rowCount mismatch');
        if (rows.length === count) { done = true; break; }
        assert(page.length === c.pageSize, 'GA4 incomplete page');
      } else if (page.length < c.pageSize) { done = true; break; }
    }
    assert(done, 'Pagination limit reached; snapshot not saved');
    if (d.name === 'total') assert(rows.length <= 1, 'Multiple total rows');
    rows.sort(function (a, b) { var x = canonical(a.dimensions), y = canonical(b.dimensions); return x < y ? -1 : x > y ? 1 : 0; });
    var meta = Object.assign({}, d, {
      observed_at: observed, timezone: d.source === 'gsc' ? 'America/Los_Angeles' : metadata.timeZone,
      dataState: d.source === 'gsc' ? 'final' : 'not_guaranteed_final', finalizedThrough: d.source === 'gsc' ? c.gscConfirmedThrough : null,
      operator_confirmed_through: c[d.source + 'ConfirmedThrough'], coverage: rows.length ? 'returned_rows_only' : 'empty_response_not_zero',
      known_gaps: d.source === 'gsc' ? (d.name === 'total' ? ['property aggregate; separate from dimension row sums', 'uninstrumented traffic unknown'] : (d.name === 'query' ? ['anonymized queries omitted'] : []).concat(['API top rows may omit data', 'dimension sums differ from total', 'uninstrumented traffic unknown'])) : ['GA4 finality not guaranteed', 'uninstrumented traffic unknown', 'URL rows are not unique users'],
      response_metadata: metadata
    });
    if (metadata) {
      if (metadata.subjectToThresholding === true) meta.known_gaps.push('subject to thresholding; suppressed rows may be absent');
      if (metadata.dataLossFromOtherRow === true) meta.known_gaps.push('data loss from (other) row');
      if (metadata.samplingMetadatas && metadata.samplingMetadatas.length) meta.known_gaps.push('sampled report; consult response_metadata sampling counts');
    }
    var key = canonical(Object.assign({}, d, {timezone: meta.timezone, dataState: meta.dataState}));
    return {key: key, metadata: meta, rows: rows};
  }
  function store(snapshots, io) {
    var before = io.read();
    assert(Array.isArray(before) && (before.length === 0 || canonical(before[0]) === canonical(HEADER)), 'Dedicated sheet header mismatch');
    var keys = snapshots.map(function (s) { return s.key; });
    var records = before.slice(1).filter(function (r) {
      assert(Array.isArray(r) && r.length === 3 && typeof r[0] === 'string' && ['metadata', 'row'].indexOf(r[1]) >= 0, 'Malformed stored record');
      assert(typeof r[2] === 'string', 'Malformed stored JSON'); JSON.parse(r[2]);
      return keys.indexOf(r[0]) < 0;
    });
    snapshots.forEach(function (s) {
      records.push([s.key, 'metadata', canonical(s.metadata)]);
      s.rows.forEach(function (r) { records.push([s.key, 'row', canonical(r)]); });
    });
    var after = [HEADER].concat(records);
    assert(after.length <= 20000, 'Snapshot storage limit; archive manually before retry');
    after.forEach(function (r) { r.forEach(function (cell) { assert(cell.length <= 45000, 'Cell limit exceeded'); }); });
    assert(canonical(after).length <= 1800000, 'Batch size limit exceeded');
    io.replace(after, Math.max(before.length, after.length));
    assert(canonical(io.read()) === canonical(after), 'UNKNOWN: write readback mismatch; inspect target before retry');
    return {status: 'verified', reports: snapshots.length, storedRecords: after.length - 1};
  }
  function run(c, io) {
    validate(c); var locked = false;
    try {
      assert(io.lock(), 'Collector already running'); locked = true;
      var observed = io.now();
      assert(typeof observed === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\+09:00$/.test(observed), 'Expected observed_at JST');
      // Complete all five reports before the first storage read/write.
      var snapshots = definitions(c).map(function (d) { return collect(d, c, io, observed); });
      return store(snapshots, io);
    } finally { if (locked) io.unlock(); }
  }
  return {run: run, definitions: definitions, request: request, normalize: normalize, canonical: canonical};
}());

function runSiteAnalytics() {
  var config = siteAnalyticsConfig();
  // Gate precedes token access, locks and network activity.
  if (config.liveEnabled !== true) throw new Error('Human Gate: live execution disabled');
  if (!config.expectedScriptId || /^REPLACE/.test(config.expectedScriptId) || ScriptApp.getScriptId() !== config.expectedScriptId) throw new Error('Dedicated script ID mismatch');
  return SiteAnalytics.run(config, siteAnalyticsGasIo(config));
}
