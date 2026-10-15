function siteAnalyticsConfig() {
  return {
    liveEnabled: false,
    expectedScriptId: 'REPLACE_WITH_NEW_DEDICATED_DEV_SCRIPT_ID',
    gscSite: 'REPLACE_WITH_EXACT_SITE',
    ga4Property: 'REPLACE_WITH_NUMERIC_PROPERTY_ID',
    spreadsheetId: 'REPLACE_WITH_DEDICATED_DEV_SPREADSHEET_ID',
    sheetId: 0,
    sheetTitle: 'analytics_snapshots',
    // Explicit, source-local end dates; each inclusive window is 28 days.
    // Operator must confirm source availability; GA4 has no finality guarantee.
    gscEnd: '', gscConfirmedThrough: '',
    ga4End: '', ga4ConfirmedThrough: '',
    pageSize: 1000,
    maxPages: 10
  };
}
