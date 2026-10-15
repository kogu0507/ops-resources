# GSC + GA4 独立スナップショットGAS — Issue #26 M0/M1

**状態: オフライン実装・fixture試験のみ。Google認可、API有効化、実データ取得、デプロイ、トリガー変更は未実行。**

既存 `gas-drive-state` / Simple Runnerとは別プロジェクト。`src` の4ファイルだけが将来の新規GASへ渡すソースです。既存Script/Sheet ID、clasp設定、workflow、認証情報をコピーしません。初期設定 `liveEnabled: false` は、トークン取得・HTTP・ロック前に停止します。実行にはさらに新規専用GASの `expectedScriptId` 一致が必要です。Web配布物はなく、FTP・public_htmlミラーへの配置は不要です。

## ローカル検証

Node.js 20以上。外部依存・npm install・ネットワーク・Google認証は不要です。

```powershell
node --test ai-automation/gas-site-analytics/test/collector.test.mjs
```

fixturesは架空の `example.test` / property `123`。実測ではありません。Node VMで実際の `.gs` とHTTPアダプターを読み、UrlFetchApp/LockService/ScriptApp/Utilitiesのみ置き換えます。正常取得、5レポート取得前の書込禁止、互換性、複数ページ、上限、空レスポンス、欠損/不正値、401/403/429/5xx、タイムアウト、同キー再実行、古い行削除、別window保持、同時実行、原子的batch、readback不一致を検証します。Google側の実権限・クォータ・実API応答を証明するものではありません。

M0の監査結果は [docs/M0-AUDIT.md](docs/M0-AUDIT.md)。既存自動デプロイのpathsはこの新規フォルダを含みません。本フォルダ用CI/CDは追加していません。

## 取得契約

| source / report | dimensions | metrics |
| --- | --- | --- |
| GSC total | なし | clicks, impressions, ctr, position |
| GSC query | query | 同上 |
| GSC page | page | 同上 |
| GA4 pages | pagePathPlusQueryString, pageTitle | screenPageViews, activeUsers |
| GA4 acquisition | sessionSource, sessionMedium | sessions |

GSCは `type=web`, `dataState=final`。3レポートを独立取得します。匿名化やAPI側のtop rows制限により、query/pageの合計はtotalと一致しません。GA4は各レポートの `checkCompatibility` 成功後に `runReport`。APIヘッダー/値/件数/timeZoneを検査し、取得中のrowCount/metadata変化や重複dimension行があれば中止します。ページ別activeUsersの行合計はサイト全体のユニークユーザー数ではありません。screenPageViewsは公式指標のページ/スクリーン閲覧、sessionSource/sessionMediumはセッションスコープです。プロパティにアプリstreamを含む場合の計測対象は将来のDEV確認事項です。filtersは現在なし（metadata/keyに明示）。

各ソースの `End` は含む終了日、開始日はその27日前（28日間）。`ConfirmedThrough` は操作者が確認した利用可能日を明示し、終了日が超えると中止します。自動で現在日から確定日を推定しません。GSCはAmerica/Los_Angelesの日付、GA4は応答metadataのtimeZoneの日付、観測時刻はJSTです。同じカレンダー日でもUTC区間は異なります。GSC finalizedThroughは操作者確認値でありAPIによる最新確定日の探索結果ではありません。GA4には最終確定の保証がないため、`dataState=not_guaranteed_final`, `finalizedThrough=null` とし、操作者の確認日を別に保持します。

metadataはsource/scope/window/dimensions/metrics/filters/searchType/timezone/observed_at/metric_definition/dataState/coverage/known_gapsを保持します。GA4のsamplingMetadatas、subjectToThresholding、dataLossFromOtherRow等はresponse_metadataをそのまま保持し、存在する制限をknown_gapsにも記録します。空応答は `empty_response_not_zero` のmetadataのみで保存し、0行を捏造しません。未計測ページの流入を0とは扱いません。

`pageSize` は1〜25000、`maxPages` は1〜20（既定1000×10）。GSCは短いページまで、GA4はrowCountまでページングします。上限に達したら切り捨て成功にせず、全保存を中止します。GSCが上限件数ちょうどの場合は追加の終端ページが必要です。rowCount=0がprotobuf JSONで省略されるGA4空応答のみ0として解釈し、非空応答の欠落は不正とします。APIの制約上、取得中の更新やGSCの非公開行を完全検出できません。

## Sheets保存・失敗の意味

専用Spreadsheetの専用tab A:Cのみを使います。初回は空、以後ヘッダーは `snapshot_key | record_type | json_v1`。JSONのmetadata行とdimension行を保存する小型スナップショットモデルです。rawイベントの大量複製、定期巡回、データベースは作りません。

キーはsource/scope/window/dimensions/metrics/filters/searchType/metric_definition/timezone/dataStateのcanonical JSON。観測時刻は含めず、同キーの再取得はmetadataと全dimension行を置換します。前回より行が減ったときの古い行も消します。別windowは保持します。GAS script lockを取得してから全5レポートを取得し、**1回のSheets `spreadsheets.batchUpdate` / updateCells**で全5レポートを原子的に置換・余剰行をclearします。readbackの完全一致まで成功を返しません。20,000保存行、セル45,000文字、JSON文字列180万コード単位（UTF-16。転送バイト数とは異なる）を超える場合は保存前に中止。専用tabの行数/列数が不足しても自動拡張せず中止します。

script lockは同一GAS内の競合だけを防ぎます。他GASや人間との競合を防ぐため、専用tabはこのcollectorだけが書き、共有編集・他writerを禁止する運用が必要です。A:C以外にデータを置かないでください。HTTP/認証/quota/timeoutで自動再試行しません。write後のtimeout、応答JSON不正、readback不一致/失敗は結果不明（UNKNOWN）として扱い、成功報告・自動再実行をせず専用Sheetを確認します。Sheets batchが適用された後に検証失敗した場合、保存済みの可能性があり、自動rollbackもしません。

## 必要scopeとHuman Gate

manifestは `analytics.readonly`, `webmasters.readonly`, `spreadsheets`, `script.external_request` の4つです。source2つはreadonly。保存用 `spreadsheets` scopeはSpreadsheet単位の認可ではないため、専用DEV Sheet/限定権限の実行アカウントとexact ID/title照合を併用します。Drive scope、GAS管理scope、トリガーscopeは要求しません。トークンはScriptAppから実行時のみ取得し、コード・ログ・Git・Issueへ保存しません。エラー本文や取得データも自動ログしません。

次の操作は**まだ承認されていません**。人間が範囲・対象を承認するまで停止します。

1. 対象の1 GSCサイト/1 GA4 property、実行アカウントの既存閲覧権限、GA4計測対象/プロパティtimezoneを確認する。IDを推定しない。
2. 新規独立DEV GASと専用DEV Spreadsheet/tab（初期空、最低3列、必要行数）を用意し、正確なID/titleを確認する。既存GAS/Sheetへ接続しない。
3. その新規GASのCloud projectでSearch Console API、Analytics Data API、Google Sheets APIの必要な有効化を確認し、必要なら承認後に有効化する。新たな課金を有効にしない。
4. ローカル `ai-automation/gas-site-analytics/src/{Collector.gs,GasIo.gs,Config.gs,appsscript.json}` → **承認した新規DEV Apps Scriptプロジェクトの同名ファイル**へ反映する。既存clasp設定/デプロイ先は使わない。FTPは該当しない。
5. Configにexact IDs、sourceごとの確認済終了日を設定し、承認された単発試験についてのみ `liveEnabled: true` にする。初回OAuthは人間が要求scopeを確認して許可する。GSC/GA4 read + DEV Sheetへのwrite範囲が承認対象。
6. 手動 `runSiteAnalytics` を1回実行し、5件のmetadata、期間/timezone/coverage、公式UIとの同条件照合、readback成功を確認する。同windowを再実行する試験も明示的に範囲へ含める。実機証拠は機密を除いて記録する。トリガーは設定しない。

安全な復帰: 失敗時は `liveEnabled:false` に戻して停止。専用DEV tabのバックアップが必要なら書込前に人間が保存する。UNKNOWNは既存内容を確認するまで再実行しない。検証済バックアップの復元・データ削除・本番移行は別途承認する。既存 `gas-drive-state` は影響範囲外。Production/trigger運用設計は次のmilestoneです。

## 次の実装用チャットへ渡すプロンプト

```text
kogu0507/ops-resources Issue #26 のM1成果をレビューしてください。
CODEX-HANDOFF.mdとDrive CURRENT/Knowledge Registry、MEASUREMENT-FACTS-SPEC.md、DESIGN-NOTES IV/Vをfresh readし、ai-automation/gas-site-analytics/README.mdとdocs/M0-AUDIT.mdを確認してください。
まずコードとオフラインテスト（node --test ai-automation/gas-site-analytics/test/collector.test.mjs）を確認してください。
既存gas-drive-state、Simple Runner、workflow、clasp、認証情報、既存Script/Sheet/triggerは変更しないでください。
認可・API有効化・新規GASへの反映・実データアクセス・DEV Sheet書込・再実行は、上記READMEの具体的対象/範囲を人間が承認した証拠を確認するまで停止してください。承認がなければ必要な対象確認と手順の具体化まで進めて報告してください。
承認後も専用DEV単発試験の範囲だけを実施し、readback/同キー冪等性/metadataを検証・引継ぎ記録してください。本番/定期trigger/課金は対象外です。
```

## 参照（2026-10-15に公式仕様確認）

- [Search Analytics query](https://developers.google.com/webmaster-tools/v1/searchanalytics/query)
- [GA4 runReport](https://developers.google.com/analytics/devguides/reporting/data/v1/rest/v1beta/properties/runReport)
- [GA4 schema](https://developers.google.com/analytics/devguides/reporting/data/v1/api-schema)
- [checkCompatibility](https://developers.google.com/analytics/devguides/reporting/data/v1/rest/v1beta/properties/checkCompatibility)
- [ResponseMetaData](https://developers.google.com/analytics/devguides/reporting/data/v1/rest/v1beta/ResponseMetaData)
- [Sheets batchUpdate atomic validation](https://developers.google.com/workspace/sheets/api/reference/rest/v4/spreadsheets/batchUpdate)
- [Sheets updateCells range clearing](https://developers.google.com/workspace/sheets/api/reference/rest/v4/spreadsheets/request#UpdateCellsRequest)
- 正本: [MEASUREMENT-FACTS-SPEC](https://drive.google.com/file/d/1Sz3_ryrqJUhXk5Q8-tXEDpCpxzgx2kY7/view)、[DESIGN-NOTES IV/V](https://docs.google.com/document/d/1qjhGFz8l7crlPzkjD32AP7eR0nw2hxtW6WMBppFddtI/edit)。正本本文はローカルへ複製していません。
