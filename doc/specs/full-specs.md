# 仕様まとめ（体系版）

本ファイルは全仕様の入口（インデックス）とする。詳細は各リンク先を正とする。

## プロダクト概要

SNS（初期対応は X）上で同一または実質同一の投稿をしている複数アカウントを検出してリスト化し、利用者が SNS 運営へ通報できる状態にするツール。ベース部分は OSS（Apache License 2.0）、AI による類似投稿判定はクローズドな有料サービスとして提供する。

現在のOSS MVPは、利用者が正規な手段で取得したCSV/JSON投稿データをローカルWebアプリで読み込み、決定的な完全一致・近似一致を検出し、アカウント単位の証拠リストを表示・CSVおよびHTML証拠パッケージとして出力する。データはブラウザ内で処理し、自動通報・外部API呼び出し・AI判定は行わない。

## 仕様ファイル一覧

| 種別 | ファイル | 内容 |
| --- | --- | --- |
| ビジネス要件 | `doc/specs/business_requirements/goal_and_usecases.md` | ゴール・目的・ユースケース |
| システム要件 | `doc/specs/system_requirements/system_requirements.md` | 対象SNS、OSS/有料の切り分け、検出要件、規約遵守要件 |
| 取得ポリシー | `doc/specs/system_requirements/x_data_acquisition_policy.md` | 他アカウント投稿を正規に取得・利用する後続フェーズの条件、禁止事項、段階的導入 |
| ガバナンス要件 | `doc/specs/system_requirements/external_data_governance.md` | 外部データ連携における最小化、保持、削除、再配布、資格情報、監査、インシデント対応 |
| システム仕様 | `doc/specs/system_spec/spec.md` | 初期状態、入力・検出・出力・画面・セキュリティの仕様 |
| 概要設計 | `doc/specs/overview_design/local_web_mvp.md` | 全体構成、処理フロー、コンポーネント責務、拡張方針 |
| 方式設計 | `doc/specs/architecture_design/local_web_mvp.md` | 技術方式、モジュール境界、SNS/AI拡張点、セキュリティ設計 |
| 詳細設計 | `doc/specs/detail_design/detection_engine.md` | データモデル、検出アルゴリズム、入力検証、CSV出力 |
| 詳細設計 | `doc/specs/detail_design/x_api_input_adapter.md` | 保存済みX API Search JSONを標準Post形式へ変換する入力アダプター |
| 詳細設計 | `doc/specs/detail_design/x_api_usage_billing.md` | 有償版のX API取得における従量課金・定額利用枠、見積り、予約、停止、精算、監査 |
| 詳細設計 | `doc/specs/detail_design/performance_and_responsiveness.md` | 最大5,000件の近似一致解析における性能基準、候補絞り込み、処理中応答性 |
| 詳細設計 | `doc/specs/detail_design/browser_e2e_testing.md` | ブラウザE2Eの画面操作、入力エラー、CSV出力、安全な外部リンク、CI実行 |
| 詳細設計 | `doc/specs/detail_design/evidence_package.md` | 手動確認・通報向けHTML証拠パッケージの出力内容、安全境界、検証条件 |
| 詳細設計 | `doc/specs/detail_design/semantic_similarity_evaluation.md` | 有料AIによる意味的類似判定の評価セット、比較指標、OrcaRouter境界、原価、導入ゲート |
| 方式設計 | `doc/specs/architecture_design/relationship_graph_data_model.md` | 将来の関係性グラフ向け論理データモデル、保持境界、API契約、導入ゲート |
| 計測 | `doc/specs/measurement/product_validation_plan.md` | 利用者・価格・計測・開発優先順位を検証する計画 |
| 価格設計 | `doc/specs/pricing/monetization_policy.md` | 二層構造、有料機能の境界、LLM利用前提 |
| 横断 | `doc/specs/evaluation_criteria.md` | 審査基準への適合性 |

## 関連調査

- `doc/research/20260811_x_rules_on_duplicate_posts.md` : X における複数アカウント運用と重複投稿の扱い
- `doc/research/20260812_x_data_acquisition_options.md` : 他アカウント投稿を正規に取得・利用する経路と公式条件の調査
- `doc/research/20260812_orcarouter_semantic_similarity_validation.md` : OrcaRouterを用いる意味的類似判定の公式仕様、料金構造、実装開始前ゲートの調査
- `doc/research/20260812_spec_consistency_audit.md` : 仕様書・実装・Issueの整合性監査、解決済み事項、外部判断が必要な残課題

## 未着手または将来の設計工程

マーケティング（`marketing/`）は未着手である。計測（`measurement/`）は利用者・価格・優先順位の検証計画を定義済みだが、参加者募集、観察、結果の集計は未実施である。AIを用いた意味的類似判定は、評価・連携境界を設計済みだが、実API連携、実モデル評価、認証・データ保持を伴うサービス化は、利用者提供の資格情報、データ権限、料金・予算、統合テストの確定後に実施する。SNS API経由の取得と関係性可視化は論理設計まで完了しており、外部データ利用の承認、保持・削除・認証の実装、利用者価値の検証後に後続フェーズで扱う。
