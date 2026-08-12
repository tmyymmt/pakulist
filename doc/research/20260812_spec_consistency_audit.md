# 仕様整合性監査記録

**監査日:** 2026-08-12
**対象:** `doc/specs/` 配下のMarkdown仕様書15件、現行ローカルWebアプリ実装、GitHub Issue一覧

## 1. 結論

`doc/specs/` 配下の全15文書を確認し、現行MVPの実装範囲、完了済みIssue、将来の有料・外部データ連携の境界を照合した。現行MVPは、ローカル入力の決定的検出、UC-03の時系列候補、CSV・HTML証拠パッケージ、性能回帰、ブラウザE2Eまで実装済みである。一方、外部Xデータの本番取得、利用者検証、実AI連携は、資格情報、書面許可、データ権限、運用責任又は参加者協力が必要なため、現セッションだけでは完了できない。

> 仕様は、現行OSS MVPに外部通信・自動通報・AI判定を導入する根拠にはならない。後続サービスを開始する前に、外部データとAIの導入ゲートをすべて満たす必要がある。

## 2. 監査対象

| 分類 | 確認した文書 |
| --- | --- |
| ビジネス・横断 | `business_requirements/goal_and_usecases.md`、`evaluation_criteria.md`、`full-specs.md` |
| システム・取得・ガバナンス | `system_requirements/system_requirements.md`、`system_requirements/x_data_acquisition_policy.md`、`system_requirements/external_data_governance.md`、`system_spec/spec.md` |
| MVPの設計 | `overview_design/local_web_mvp.md`、`architecture_design/local_web_mvp.md` |
| 後続設計 | `architecture_design/relationship_graph_data_model.md`、`measurement/product_validation_plan.md`、`pricing/monetization_policy.md` |
| 詳細設計 | `detail_design/detection_engine.md`、`detail_design/x_api_input_adapter.md`、`detail_design/performance_and_responsiveness.md`、`detail_design/browser_e2e_testing.md`、`detail_design/semantic_similarity_evaluation.md` |

## 3. 解決済みの矛盾・不明点

| ID | 確認結果 | 解決内容 |
| --- | --- | --- |
| AUD-01 | 仕様索引が関係性グラフ設計・計測計画を列挙せず、計測を「未着手」と誤記していた。 | `full-specs.md`へ両文書を追加し、計測は「計画済み・実施未了」と明確化した。 |
| AUD-02 | HTML証拠パッケージは実装済みだが、詳細設計書と索引がなかった。 | `detail_design/evidence_package.md`を追加し、出力条件、内容、安全境界、外部データへの拡張条件、テストを定義した。 |
| AUD-03 | 評価基準が旧来の「単体10件」「CSV出力のみ」「未実装のUC-03・E2E・証拠拡張」を記載していた。 | `evaluation_criteria.md`を、単体30件、性能4シナリオ、E2E 6シナリオ、UC-03、HTML出力、閉じたIssueの完了状況へ更新した。 |
| AUD-04 | X取得ポリシーが完了済みの#3・#9を将来の前提として参照していた。 | Issue番号依存を設計・実装状態の記述へ置換し、実API取得の開始条件を必要な承認・運用ゲートとして明示した。 |
| AUD-05 | 単一アカウントのアーカイブでは候補が検出できない場合があるというポリシー上の注意が、利用画面に存在しなかった。 | 画面の利用前注意へ追加し、E2Eで表示を回帰検証する。 |
| AUD-06 | 仕様がUTF-8入力を求める一方、ブラウザ読込は不正UTF-8を明示的に拒否していなかった。 | fatal UTF-8デコードを導入し、不正バイト列を理由付きで拒否するE2Eを追加した。 |
| AUD-07 | 方式設計の実行時依存、モジュール構成、候補絞り込み、証拠出力、検査対象が古かった。 | Playwrightを開発依存として明記し、現行モジュール・接頭辞フィルタ・HTML安全性を反映した。`check`へ評価ユーティリティも追加した。 |
| AUD-08 | 意味的類似設計ではOrcaRouterが「候補」と表現され、価格設計・システム要件の必須方針と弱く矛盾していた。 | OrcaRouterを必須ゲートウェイとして明記し、変更時は明示的な方針変更を要するものとした。 |

## 4. 外部判断が必要な未解決事項

| まとまり | 現時点での阻害要因 | 対応方針 |
| --- | --- | --- |
| 実AI評価・原価 | OrcaRouter APIキー、サーバー側シークレットストア、固定モデル、当日の単価、承認済み評価データがない。 | 既存Issue #8で継続する。重複Issueは作成しない。 |
| 外部Xデータ連携の本番開始 | Xとの書面許可、課金プラン、利用目的、責任者、予算、削除窓口、認証・監査・削除を実装するサーバー基盤が未確定である。 | Issue #32で開始判断・運用準備を管理する。 |
| 利用者・価格・優先順位の実証 | 参加者募集、インタビュー実施、匿名観察、結果集計は実行しておらず、参加者協力が必要である。 | Issue #33で計画を実施し、Go/No-goと次の優先順位を確定する。 |

## 5. 作成したGitHub Issue

| Issue | 区分 | 目的 |
| --- | --- | --- |
| [#32](https://github.com/tmyymmt/pakulist/issues/32) | P0・外部判断 | X外部データ連携の承認、課金、資格情報、認証、保持・削除・監査、運用開始条件を確定する。 |
| [#33](https://github.com/tmyymmt/pakulist/issues/33) | P1・利用者検証 | 匿名・最小化した利用者検証により、価格と次の開発優先順位を決定する。 |
| [#8](https://github.com/tmyymmt/pakulist/issues/8) | P2・既存 | 実AI精度・原価・障害時統合検証を、資格情報とデータ権限が揃った後に行う。 |

## 6. 参照資料

- [仕様体系の索引](../specs/full-specs.md)
- [ローカルWebアプリMVP仕様](../specs/system_spec/spec.md)
- [X投稿データ取得・利用ポリシー](../specs/system_requirements/x_data_acquisition_policy.md)
- [外部データ連携のガバナンス要件](../specs/system_requirements/external_data_governance.md)
- [意味的類似判定の評価・連携境界](../specs/detail_design/semantic_similarity_evaluation.md)
- [プロダクト検証計画](../specs/measurement/product_validation_plan.md)
