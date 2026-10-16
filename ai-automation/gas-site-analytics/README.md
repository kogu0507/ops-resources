# GSC + GA4 独立スナップショットGAS — Issue #26 M0/M1・M2-DEV

**状態: M1オフライン試験43件PASS。限定M2-DEVは承認済み。新規専用GAS・Sheetを準備し、接続先をUI確認しましたが、専用GASのdefault→standard Cloud project切替が不可逆なためSTOP_BOUNDARYで停止しています。collector実行は0回で、公式API取得・Sheet保存/readback・同キー再実行は未実測。** 最新の準備状況と必要な判断は [docs/M2-DEV.md](docs/M2-DEV.md) を参照してください。Google本人OAuth同意は未完了です。

既存 `gas-drive-state` / Simple Runnerとは別プロジェクト。`src` の4ファイルだけが新規専用GASへ反映するソースです。既存Script/Sheet ID、clasp設定、workflow、認証情報をコピーしません。初期設定 `liveEnabled: false` は、トークン取得・HTTP・ロック前に停止します。実行にはさらに新規専用GASの `expectedScriptId` 一致が必要です。Web配布物はなく、FTP・public_htmlミラーへの配置は不要です。

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

次の操作は [2026-10-15の限定DEV承認](https://github.com/kogu0507/ops-resources/pull/27#issuecomment-6187414057) と [運用補足](https://github.com/kogu0507/ops-resources/pull/27#issuecomment-6187525064) の範囲で**承認済み**です。本人OAuth同意を除き、対象の照合・準備・手動単発1回と同条件再実行1回・結果記録を自律的に進めます。承認は認証完了や実測PASSを意味しません。

1. 対象の1 GSCサイト/1 GA4 property、実行アカウントの既存閲覧権限、GA4計測対象/プロパティtimezoneを確認する。IDを推定しない。
2. 新規独立DEV GASと専用DEV Spreadsheet/tab（初期空、最低3列、必要行数）を用意し、正確なID/titleを確認する。既存GAS/Sheetへ接続しない。
3. その新規GASのCloud projectでSearch Console API、Analytics Data API、Google Sheets APIの必要な有効化を確認し、必要なら承認済みのこの対象だけで有効化する。新たな課金を有効にしない。
4. ローカル `ai-automation/gas-site-analytics/src/{Collector.gs,GasIo.gs,Config.gs,appsscript.json}` → **承認した新規DEV Apps Scriptプロジェクトの同名ファイル**へ反映する。既存clasp設定/デプロイ先は使わない。FTPは該当しない。
5. Configにexact IDs、sourceごとの確認済終了日を設定し、承認された単発試験についてのみ `liveEnabled: true` にする。初回OAuthは人間が要求scopeを確認して許可する。GSC/GA4 read + DEV Sheetへのwrite範囲が承認対象。
6. 手動 `runSiteAnalytics` を1回実行し、5件のmetadata、期間/timezone/coverage、公式UIとの同条件照合、readback成功を確認する。同window・意味キーで手動再実行を1回行い、重複しない置換を確認する。古い行の消去は実際に減少が観測された場合だけ実測証拠とし、減少がなければ未観測と記録する。実機証拠は機密を除いて記録する。トリガーは設定しない。

既承認DEV内の可逆で局所的な修正・回帰試験は運用補足の範囲で進めます。本番、既存GAS/Sheet/トリガー、workflow/clasp変更、課金、外部権限やアカウントの拡張、PRマージは承認対象外です。本人操作が必要なら、確認済み事項を再依頼せず、画面入口・対象・期待結果・戻り報告を一通にまとめます。

安全な復帰: 失敗時は `liveEnabled:false` に戻して停止。専用DEV tabのバックアップが必要なら書込前に人間が保存する。UNKNOWNは既存内容を確認するまで再実行しない。検証済バックアップの復元・データ削除・本番移行は別途承認する。既存 `gas-drive-state` は影響範囲外。Production/trigger運用設計は次のmilestoneです。

## 次の実装用チャットへ渡すプロンプト

```text
kogu0507/ops-resources Issue #26 / PR #27 の承認済みM2-DEVを継続してください。
CODEX-HANDOFF.mdとDrive CURRENT/Knowledge Registry、MEASUREMENT-FACTS-SPEC.md、DESIGN-NOTES IV/Vをfresh readし、ai-automation/gas-site-analytics/README.mdとdocs/M0-AUDIT.mdを確認してください。
PR #27 の承認コメント6187414057・運用補足6187525064をfresh readし、docs/M2-DEV.mdの確認済み事項と未実測を区別してください。まず現在のDEV資産・設定・実行回数を照合し、既存成果を重複作成しないでください。コード変更が必要ならオフラインテスト（node --test ai-automation/gas-site-analytics/test/collector.test.mjs）で再検証してください。
既存gas-drive-state、Simple Runner、workflow、clasp、認証情報、既存Script/Sheet/triggerは変更しないでください。
限定DEVの準備・必要API有効化・対象4ファイル反映・単発取得1回と同キー再実行1回は承認済みです。Cloud default→standardの不可逆切替は別承認の証拠を確認し、未承認なら切替前に停止してください。OAuth同意そのものは本人操作を待ち、必要な操作を一通にまとめてください。エラー/書込UNKNOWNはSheet確認前に独断で再試行しないでください。
承認範囲でreadback/同キー冪等性/metadataを検証し、PRとDrive currentへ証拠・制約・次の作業を記録してください。本番/定期trigger/課金/PRマージは対象外です。M2 PASS後はM3提案とpreflightまでまとめ、本番操作は実施しないでください。
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
