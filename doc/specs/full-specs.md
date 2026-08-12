# 仕様まとめ（体系版）

本ファイルは全仕様の入口（インデックス）とする。詳細は各リンク先を正とする。

## プロダクト概要

SNS（初期対応は X）上で同一または実質同一の投稿をしている複数アカウントを検出してリスト化し、利用者が SNS 運営へ通報できる状態にするツール。ベース部分は OSS（Apache License 2.0）、AI による類似投稿判定はクローズドな有料サービスとして提供する。

現在のOSS MVPは、利用者が正規な手段で取得したCSV/JSON投稿データをローカルWebアプリで読み込み、決定的な完全一致・近似一致を検出し、アカウント単位の証拠リストを表示・CSV出力する。データはブラウザ内で処理し、自動通報・外部API呼び出し・AI判定は行わない。

## 仕様ファイル一覧

| 種別 | ファイル | 内容 |
| --- | --- | --- |
| ビジネス要件 | `doc/specs/business_requirements/goal_and_usecases.md` | ゴール・目的・ユースケース |
| システム要件 | `doc/specs/system_requirements/system_requirements.md` | 対象SNS、OSS/有料の切り分け、検出要件、規約遵守要件 |
| 取得ポリシー | `doc/specs/system_requirements/x_data_acquisition_policy.md` | 他アカウント投稿を正規に取得・利用する後続フェーズの条件、禁止事項、段階的導入 |
| システム仕様 | `doc/specs/system_spec/spec.md` | 初期状態、入力・検出・出力・画面・セキュリティの仕様 |
| 概要設計 | `doc/specs/overview_design/local_web_mvp.md` | 全体構成、処理フロー、コンポーネント責務、拡張方針 |
| 方式設計 | `doc/specs/architecture_design/local_web_mvp.md` | 技術方式、モジュール境界、SNS/AI拡張点、セキュリティ設計 |
| 詳細設計 | `doc/specs/detail_design/detection_engine.md` | データモデル、検出アルゴリズム、入力検証、CSV出力 |
| 価格設計 | `doc/specs/pricing/monetization_policy.md` | 二層構造、有料機能の境界、LLM利用前提 |
| 横断 | `doc/specs/evaluation_criteria.md` | 審査基準への適合性 |

## 関連調査

- `doc/research/20260811_x_rules_on_duplicate_posts.md` : X における複数アカウント運用と重複投稿の扱い
- `doc/research/20260812_x_data_acquisition_options.md` : 他アカウント投稿を正規に取得・利用する経路と公式条件の調査

## 未着手または将来の設計工程

マーケティング（`marketing/`）と計測（`measurement/`）は未着手である。AIを用いた意味的類似判定、SNS API経由の取得、関係性可視化、認証・データ保持を伴うサービス化は、MVPの利用検証と規約・コスト・セキュリティ要件の確定後に設計する。
