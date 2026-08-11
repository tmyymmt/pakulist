# 仕様まとめ（体系版）

本ファイルは全仕様の入口（インデックス）とする。詳細は各リンク先を正とする。

## プロダクト概要

SNS（初期対応は X）上で同一または実質同一の投稿をしている複数アカウントを検出してリスト化し、
利用者が SNS 運営へ通報できる状態にするツール。ベース部分は OSS（Apache License 2.0）、
AI による類似投稿判定はクローズドな有料サービスとして提供する。

## 仕様ファイル一覧

| 種別 | ファイル | 内容 |
| --- | --- | --- |
| ビジネス要件 | `doc/specs/business_requirements/goal_and_usecases.md` | ゴール・目的・ユースケース |
| システム要件 | `doc/specs/system_requirements/system_requirements.md` | 対象SNS、OSS/有料の切り分け、検出要件、規約遵守要件 |
| 価格設計 | `doc/specs/pricing/monetization_policy.md` | 二層構造、有料機能の境界、LLM 利用前提 |
| 横断 | `doc/specs/evaluation_criteria.md` | 審査基準への適合性 |

## 関連調査

- `doc/research/20260811_x_rules_on_duplicate_posts.md` : X における複数アカウント運用と重複投稿の扱い

## 未着手の設計工程

概要設計（`overview_design/`）、方式設計（`architecture_design/`）、詳細設計（`detail_design/`）、
マーケティング（`marketing/`）、計測（`measurement/`）は未着手。
