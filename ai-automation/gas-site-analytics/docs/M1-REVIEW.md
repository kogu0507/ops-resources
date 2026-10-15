# Issue #26 — independent M1 technical review

Review date: 2026-10-15 JST. Final result: **0 unresolved material findings** for the authorized M0/M1 offline scope. This is not approval for live connection, authentication, deployment, Sheet creation/write, or scheduling.

## Scope and evidence

The reviewer independently fetched [Issue #26](https://github.com/kogu0507/ops-resources/issues/26) through the GitHub connector and reviewed all four `src/` files, README, M0 audit, test harness, and fixtures. The coordinating agent supplied its fresh-read authority reconciliation for the exact Drive measurement specification and DESIGN-NOTES IV/V; this reviewer did not independently fetch those Drive documents. The Issue and authority reconciliation require independent snapshot reports, missing data distinct from zero, source-specific periods/provenance/coverage, separate GSC totals, and no daily scheduling at M1.

Reviewed behavior includes GSC total/query/page requests with final/web data; GA4 page path/title with screenPageViews/activeUsers and session-source/medium acquisition; compatibility checking; strict normalization; bounded pagination; source/timezone/finality and coverage metadata; semantic snapshot-key replacement; preservation of other windows; stale-row removal; one Sheets batch mutation followed by exact readback; default offline gate; dedicated script and spreadsheet/tab guards; literal string writes; sanitized errors; and absence of trigger/deployment changes.

Repository status at final review showed only the newly added `ai-automation/gas-site-analytics/` directory. Existing tracked workflow, deployment mapping, clasp configuration, and Drive-state source files were unchanged. Review source/test access was read-only; the reviewer authored only this review record.

## Corrections verified during review

1. **GA4 valid empty REST response rejected.** Initially, omitted default `rowCount=0` caused `Missing GA4 rowCount` even when the validated response had no rows. An independent offline reproduction confirmed this. The fix accepts the omitted zero only for an empty response, retains `empty_response_not_zero` without invented metric rows, and continues to reject omitted rowCount on nonempty responses. The final suite contains both cases. References: [RunReportResponse](https://developers.google.com/analytics/devguides/reporting/data/v1/rest/v1beta/RunReportResponse), [ProtoJSON default presence](https://protobuf.dev/programming-guides/json/#presence-and-default-values).
2. **GSC anonymized-query caveat applied to totals/pages.** The original shared metadata incorrectly attached `anonymized queries omitted` to every GSC report. The fix limits that caveat to the query snapshot and describes totals separately. A dedicated regression verifies this. Reference: [Google's performance data filtering explanation](https://developers.google.com/search/blog/2022/10/performance-data-deep-dive).

The coordinating review also requested and the reviewer verified the dedicated expected-script-ID gate, exact measurement page fields, explicit GA4 threshold/sampling/(other)-row caveats, and timezone/dataState in the semantic key. No unresolved material defects were found after these changes.

## Final offline verification

Executed independently from the isolated checkout:

```text
node --test ai-automation/gas-site-analytics/test/collector.test.mjs
tests 43
pass 43
fail 0
cancelled 0
skipped 0
todo 0
```

The fixtures model the GAS HTTP adapter, request serialization, successful normalization/write/readback, empty/malformed data, pagination boundaries and report changes, denied/quota/server/transport failures, partial fetch failure, idempotency and smaller replacement, earlier-window retention, wrong targets, locking, formula-like input, and readback mismatch. The Sheet mutation mock models cleared trailing rows; it does not empirically test Google's updateCells implementation.

Reviewed source SHA-256:

| File | SHA-256 |
| --- | --- |
| src/Collector.gs | ED849FE82AE67CE443CEB4C2B1F81C734D32A5EF8A073470D50079CDAE7A6596 |
| src/GasIo.gs | E0FBEF0AC05DEE762853CC64F2B4BBE54E3E270530295D69135E46681910381D |
| src/Config.gs | 8DDC308191F4F19332B30A02D0E6699E48B73713065C5C94AF57F30657DCA5AD |
| src/appsscript.json | 99711410C404C3282C7394CC15FD23EB3AC4C4B24D1588306A0D7AEC11813AEF |

## Live boundary and handoff

All successful collection/storage results above are mock evidence. Real OAuth permissions, API enablement, exact site/property access, property timezone and web/app stream meaning, real report compatibility, real response shapes/quotas/latency, finalized-through confirmation, and Sheets atomic mutation/readback remain untested. The dedicated tab must have one writer: the script lock cannot serialize people or other GAS projects. UNKNOWN writes require inspection before rerun; no automatic retry or rollback occurs.

No live accounts, tokens, APIs, deployment, triggers, billing, or production targets were accessed or changed by this review. No FTP mirror is applicable to this GAS-only artifact. Follow the README's explicit Human Gate and bounded dedicated-DEV procedure before any live work; production and scheduling remain separate milestones.
