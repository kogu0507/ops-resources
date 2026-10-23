# Offline analytics Sheet checker

GSC／GA4 snapshotのSheet readback JSONをローカルで点検する、独立したNode.jsの補助検証器です。Google API接続、認証、GAS配備、Sheet書込み、collector実行は行いません。

## 入力

`expected.json` は、点検対象から独立に確認した接続先・期間・timezoneを記述します。以下は合成例です。

```json
{
  "gscSite": "sc-domain:example.invalid",
  "ga4Property": "123",
  "gscEnd": "2026-10-10",
  "ga4End": "2026-10-10",
  "gscConfirmedThrough": "2026-10-10",
  "ga4ConfirmedThrough": "2026-10-10",
  "ga4Timezone": "Asia/Tokyo"
}
```

readbackは、ヘッダー `snapshot_key, record_type, json_v1` を持つ3列の値配列、またはその配列を `values` に持つJSON objectです。freshな専用Sheetで、5report（GSC total／query／page、GA4 pages／acquisition）だけを保持する形式を対象にします。履歴windowが複数残る一般的なSheetの検査器ではありません。

同一条件の初回と再実行後に取得した、非空使用範囲全体のreadbackを用意します。途中で切れたcaptureや、expectedを対象metadataから単純に写したものでは、独立確認になりません。実readback／接続先／Sheet・Script ID／認可記録は公開sourceへ含めず、利用者のprivateな場所で保持してください。

## 実行

Node.jsのみを使い、外部packageのinstallは不要です。このディレクトリで実行します。

```sh
node --test check.test.mjs
node check.mjs expected.json first-readback.json second-readback.json
```

第2readbackは省略可能です。1回分だけなら再実行の証拠を `UNKNOWN` として、全体を `PARTIAL` にします。`check.test.mjs` は合成fixtureのみを生成し、実データやGoogle権限を使用しません。

## 判定と限界

検証器は5reportの構造・metadata・semantic key・28日窓・実在する日付／JST観測日時・数値の基本条件・dimension重複などを点検します。2回分があれば同一key／異なる観測時刻、dimensionの増減と行の変化を比較します。CLI成功出力はreport件数等の要約であり、入力の実dimensionやmetric値を列挙しません。失敗時のJSON parser診断等は入力断片を含む可能性があるため、実データによる出力logもprivateに扱ってください。

`PASS_SHEET_CHECKS` は保存artifactに対する限定的な整合検査の成功です。OAuth／API provenance、APIページの完全性、権限・実接続先の真正性、データ取得・全M2受入を証明しません。dimensionが減っていなければ実際のstale-row削除は `NOT OBSERVED`。増えた場合は `REVIEW_SOURCE_CHANGE` とし、上流更新が正当だったと自動判断しません。

欠損・不一致・未知の書込み状態があっても、この検証器の結果は実APIの再取得やGASの再実行を許可しません。入力は利用者が明示的に選んだローカルJSONだけを読み取り、修復・削除・再書込みをしません。
