function siteAnalyticsGasIo(c) {
  'use strict';
  var lock = LockService.getScriptLock();
  var base = 'https://sheets.googleapis.com/v4/spreadsheets/' + encodeURIComponent(c.spreadsheetId);
  function call(url, method, body) {
    var options = {method: method, headers: {Authorization: 'Bearer ' + ScriptApp.getOAuthToken()}, muteHttpExceptions: true};
    if (body !== undefined) { options.contentType = 'application/json'; options.payload = JSON.stringify(body); }
    var response;
    try { response = UrlFetchApp.fetch(url, options); } catch (e) { throw new Error('API transport failure; no automatic retry; write outcome may be UNKNOWN'); }
    var code = response.getResponseCode();
    // Never log body/token/URL: error bodies may contain identifiers or data.
    if (code < 200 || code >= 300) throw new Error('API HTTP ' + code + '; no automatic retry');
    try { return JSON.parse(response.getContentText()); } catch (e) { throw new Error('API invalid JSON; write outcome may be UNKNOWN'); }
  }
  function sheet() {
    var doc = call(base + '?fields=sheets(properties)', 'get');
    var found = (doc.sheets || []).filter(function (s) { return s.properties.sheetId === c.sheetId; });
    if (found.length !== 1 || found[0].properties.title !== c.sheetTitle) throw new Error('Dedicated sheet ID/title mismatch');
    return found[0].properties;
  }
  return {
    lock: function () { return lock.tryLock(1000); },
    unlock: function () { lock.releaseLock(); },
    now: function () { return Utilities.formatDate(new Date(), 'Asia/Tokyo', "yyyy-MM-dd'T'HH:mm:ssXXX"); },
    post: function (url, body) { return call(url, 'post', body); },
    read: function () {
      sheet();
      var range = "'" + c.sheetTitle.replace(/'/g, "''") + "'!A:C";
      var response = call(base + '/values/' + encodeURIComponent(range) + '?valueRenderOption=UNFORMATTED_VALUE', 'get');
      if (response.values !== undefined && !Array.isArray(response.values)) throw new Error('Malformed Sheets values');
      return response.values || [];
    },
    replace: function (values, clearRows) {
      var properties = sheet();
      if (!properties.gridProperties || properties.gridProperties.rowCount < clearRows || properties.gridProperties.columnCount < 3) throw new Error('Dedicated sheet grid too small; resize only after operator review');
      // One atomic batch clears stale rows and writes all five snapshots together.
      var request = {requests: [{updateCells: {
        range: {sheetId: c.sheetId, startRowIndex: 0, endRowIndex: clearRows, startColumnIndex: 0, endColumnIndex: 3},
        rows: values.map(function (row) { return {values: row.map(function (v) { return {userEnteredValue: {stringValue: v}}; })}; }),
        fields: 'userEnteredValue'
      }}]};
      call(base + ':batchUpdate', 'post', request);
    }
  };
}
