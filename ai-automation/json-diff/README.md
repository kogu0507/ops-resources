# JSON structural diff core

2つのUTF-8 JSONと比較profileから、レコード単位・フィールド単位の構造化差分を返す小型JavaScriptコアです。このディレクトリはservice非依存の比較処理と合成fixtureによるローカル試験だけを含みます。

`src/JsonDiffCore.gs` はGAS V8形式の通常JavaScriptです。外部通信、Drive／Sheets書込み、認証、Webアプリ配備、triggerは行いません。運用設定や実データ、privateな承認・研究資料は含めていません。プロジェクト全体のWeb／GAS実証・受入を表すものではありません。

## 入力と出力

`JsonDiffCore.compareUtf8(beforeBytes, afterBytes, profileBytes)` は整数byte配列または `Uint8Array` を受け取ります。成功は `{ ok: true, result }`、失敗は `{ ok: false, error }` です。文字列からUTF-8 byteへの変換は呼出し側で行います。

```json
{
  "schemaVersion": "json-diff-profile/1",
  "profileVersion": "1",
  "recordsPath": "/items",
  "idKey": "id",
  "ignorePaths": ["/capturedAt"]
}
```

`recordsPath` はレコード配列へのJSON Pointer、`idKey` は各レコードの直接の一意な文字列キーです。レコード順やオブジェクトキー順は差分にならず、配列の変更は配列全体の置換として扱います。欠落と `null` は区別します。`ignorePaths` は各レコードから比較前に除外するJSON Pointerです。

`samples/golden-three-records.json` は合成入力と完全な期待結果の例です。前後に存在するIDの変更は `FIELD`、追加・削除されたレコードは `RECORD` として返します。各entryにpresenceと値を持たせます。出力は入力の値を含むため、利用者は入力と同じ機密度で扱う必要があります。

## 固定上限

- 前後JSON各1 MiB、profile16 KiB、レコード1,000件。
- コンテナ深さ20、JSON node50,000、文字列／キー262,144 UTF-16 code units。
- ID256、Pointer1,024 UTF-16 code units、ignore32件。
- 差分entry10,000件、成功出力8 MiB。

BOM、不正UTF-8、重複JSONキー、曖昧な数値表現、上限超過などは拒否します。実装の固定上限を超える保証やGAS上の性能保証はしません。補助API `parseConfigUtf8` は設定構造を解析するだけで、file IDの実在確認やIOは行いません。

## ローカル検証

Node.jsを用意し、このディレクトリで次を実行します。外部package依存はありません。

```sh
npm test
npm run check
```

`npm run self-review` は固定seedのmetamorphic試験、`npm run benchmark` はローカルNodeでの観測です。GAS実行時間や実Google環境の成功を示すものではありません。

検証結果は実行環境とsource hashを添えて記録してください。ローカルの合成fixtureによる成功から、実Google環境の比較・保存・運用受入を推定しないでください。
