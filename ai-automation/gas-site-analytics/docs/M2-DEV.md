# Issue #26 — M2-DEV 準備・検証記録

更新: 2026-10-16 JST。状態: **STOP_BOUNDARY / collector実行0回 / API実測未実施**。新規DEV GASのdefault→standard Cloud project切替は旧default削除を伴い元へ戻せないため、運用補足の「削除・不可逆変更」の別承認境界で停止しています。新規Cloud project作成、切替、API有効化、OAuth同意はいずれも未実施です。本記録はoperatorのUI確認報告を集約したものです。M1の43件PASSおよび独立オフライン検証器の合成fixture 11件PASSは、実API・OAuth・本番の成功証拠ではありません。

## 承認と境界

- [限定DEV承認](https://github.com/kogu0507/ops-resources/pull/27#issuecomment-6187414057): 新規専用GAS/Sheet、接続先と権限の照合、必要API有効化、対象4ファイル反映、手動取得1回・同window/意味キー再実行1回、結果記録。
- [運用補足](https://github.com/kogu0507/ops-resources/pull/27#issuecomment-6187525064): 既承認範囲を一括遂行し、局所修正・再検証・証拠整備まで進める。本人操作を一通に集約する。
- OAuth同意はユーザー本人が実際の要求権限を画面で確認する。本番、既存GAS/Sheets/トリガー、workflow/clasp、課金、権限・アカウント拡張、PRマージは対象外。書込UNKNOWNで独断の再試行をしない。

## 準備と確認の現在地

| 項目 | 確認状況 | 証拠の限界・残件 |
| --- | --- | --- |
| 新規専用DEV Sheet | 作成済み。`analytics_snapshots`、sheetId `453977514`、20,000行×3列、空を検証済み | collectorによる保存/readbackは未実施 |
| 新規専用DEV GAS | 対象4ファイル保存済み。保存したeditorのCollector/GasIo/Config全文をLF正規化して一致確認。manifestは既定4 scopeのみ。Configは`liveEnabled:false`、対象IDsとGSC終了日を設定 | 再ロード後の永続化readbackは未完了。GA4終了日は未確定のため空欄。実行可能確認を意味しない |
| GSC接続候補 | `https://seegmund-music-labo.com/` の確認済み所有者権限をUI確認 | API側の権限・応答は未確認 |
| GSC期間 | UIで2026-09-15〜2026-10-12の表示を確認し、Configの終了日に2026-10-12を保存・readback一致 | UI表示はcollector取得やAPI確定日検証の証拠ではない |
| GA4接続候補 | property `487148965`、管理者権限、GMT+9、web stream 1件のみで対象site一致をUI確認 | ブラウザfocus timeoutにより期間確認未完了。終了日は未確定・Config空欄、API応答timezoneは未確認 |
| 必要API / Cloud project | default projectではAPI手動有効化が通常できず、必要APIを明示管理するため新規standard projectへの切替を採用予定 | 切替にはdefault project削除・元へ戻せない不可逆性があるためSTOP_BOUNDARY。Cloud作成・切替・API有効化は未実施 |
| Cloud作成条件 | 新規作成画面のname/parent/create/cancelを確認、billing欄は表示なし | loadingが残り、課金アカウントが自動接続されないことは未確認。作成条件確定と課金なし経路の確認が必要 |
| OAuth | `liveEnabled:false` の `siteAnalyticsConfig` 実行操作で「承認が必要 / 権限を確認」の入口到達。同意なし | project切替前に同意すると再同意が必要になるため、現段階で本人同意を依頼しない。collectorは未実行 |
| collector実行 | 0回 | 初回・同キー再実行とも未実施 |

専用資産の識別子は公開ソースのConfigへ埋め込まず、専用DEV Configとoperatorのローカル非公開記録で管理します。ローカルの `assets.json`、`operator-evidence.md`、`source-hashes.json`、`Config.pre-oauth.gs` は保存済みで内容を照合しました。上表は保存時editor readbackの証拠であり、再ロード後readbackの未完了を含みます。アカウントメール、認証情報、トークン、検索語やURL別の実データはこの文書へ記録しません。

## 実測結果

| 検証 | 結果 |
| --- | --- |
| Google公式APIによる5レポート取得 | 未実施 |
| metadata 5件、期間・scope・timezone・coverage検証 | 未実施 |
| 専用Sheet保存と完全readback | 未実施 |
| 同条件再実行による意味キー維持・重複防止 | 未実施 |
| 古いdimension行・末尾セルの消去 | 未実施。2回の実測で減少が観測されなければ「未観測」と記録する |
| 公式UIとの同条件比較 | 接続準備のUI確認のみ。API結果との比較は未実施 |

再実行後に行数が増えた場合はdistinct dimensionの増減を調べ、単にソース更新と断定しません。空応答は0実績へ変換しません。GA4 finality、匿名化query、thresholding/sampling、API top rowsの制限はmetadataとともに保持します。

## 次の作業

必要な判断は **「この新DEV GASだけを、新規専用standard Cloud projectへ不可逆に切り替えることを承認する」** です。課金アカウントは接続せず、対象3 APIと既定4 scopeに限定し、既存資産は変更しません。この判断を求める根拠は [PR運用補足の不可逆変更境界](https://github.com/kogu0507/ops-resources/pull/27#issuecomment-6187525064) と [Google公式Cloud projectガイド](https://developers.google.com/apps-script/guides/cloud-platform-projects) です。

不可逆切替の承認と、本人によるOAuth同意は別の段階です。承認後はAIが課金なしの作成経路を確認してから専用Cloud準備・対象API/OAuth設定・紐付けを進め、GA4の期間を確認してConfigを完成させます。その後、準備済みの画面で本人が4 scopeに同意し、AIが承認済みの2回のcollector実行とreadback検証を続けます。課金なしが確認できなければ作成を進めず報告します。現default projectのOAuthダイアログが残っていても、切替後に再同意が必要となるため現段階で同意は不要です。

1. ブラウザ状態を再取得し、対象4ファイルの再ロード後readback、GA4の28日期間、必要API、Cloud project新規作成条件と課金不要の可否を確定する。defaultからstandardへの不可逆な切替は、運用補足のSTOP境界として別途判断を求める。
2. Cloud project方針確定後、未解決の本人操作を依存順に一通へまとめる。確認済み権限・資産の再確認をユーザーへ重複依頼しない。OAuth画面の実際の要求が4 scopeに対応することを本人が確認する。切替前の暫定OAuth同意は依頼しない。
3. 準備完了・本人同意後、承認された初回1回と同キー再実行1回について実行結果・全A:C readbackを保存し、独立検証する。途中でUNKNOWNならSheetを調査して停止する。
4. 実測結果、残る制約、次の境界をPR/Issue/Drive currentへ整合させる。M2 PASS後はM3提案・preflightをまとめる。本番反映やtrigger設定を先取りしない。

GASのためFTPアップロード・public_htmlミラー配置は不要です。
