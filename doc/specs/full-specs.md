# 仕様まとめ（体系版）

本ファイルは全仕様の入口（インデックス）とする。詳細は各リンク先を正とする。

## プロダクト概要

SNS（初期対応は X）上で同一または実質同一の投稿をしている複数アカウントを検出してリスト化し、利用者が SNS 運営へ手動通報できる状態に整理するツールである。ベース部分は OSS（Apache License 2.0）であり、認証、保存、課金、X APIによる投稿取得を伴うサービスはクローズドな有料サービスとして後続で提供する。

現在のOSS MVPは、利用者が正規な手段で取得したCSV/JSON投稿データをローカルWebアプリで読み込み、決定的な完全一致・近似一致を検出し、アカウント単位の証拠リストを表示・CSVおよびHTML証拠パッケージとして出力する。利用者が明示的に有効化し、ローカルのOrcaRouter意味的類似APIを起動した場合は、完全一致を除いた文字列近似候補と時系列近傍の発見候補だけを意味的に判定する。LLMの`match`は最終近似一致へ追加し、LLMの`non_match`は文字列近似候補から除外する。外部通信はこの任意機能に限定し、自動通報、投稿取得、永続化、利用者認証は行わない。

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
| 詳細設計 | `doc/specs/detail_design/semantic_similarity_evaluation.md` | ローカル意味的類似プロトタイプの候補選定・再構成、OrcaRouter境界、評価、原価、導入ゲート |
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

マーケティング（`marketing/`）は未着手である。計測（`measurement/`）は利用者・価格・優先順位の検証計画を定義済みだが、参加者募集、観察、結果の集計は未実施である。AIを用いた意味的類似判定は、利用者提供キーによるローカル試作、固定モデル、候補の追加・除外、棄権、回帰テストまでを実装済みとする。一方で、実データでの品質・原価評価、認証・利用枠・保存を伴うサービス化、料金確定は未実施である。SNS API経由の取得と関係性可視化は論理設計まで完了しており、外部データ利用の承認、保持・削除・認証の実装、利用者価値の検証後に後続フェーズで扱う。
