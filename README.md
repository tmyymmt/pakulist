# pakulist

SNS（初期対応は X）上で同一または実質同一の投稿をしている複数アカウントを検出してリスト化し、利用者が SNS 運営へ通報できる状態にするツール。

- ベース部分は OSS として公開（Apache License 2.0）
- AI による類似投稿判定はクローズドな有料サービスとして提供する
- 現在のMVPは、正規に取得済みのCSV/JSON投稿データをブラウザ内だけで検出・出力するローカルWebアプリである

仕様の入口は `doc/specs/system_spec/spec.md` を参照。

## ローカルWebアプリの実行

Node.js 22以降を用意してから、以下を実行する。

```bash
cd app
npm start
```

表示されたURL（既定では `http://localhost:4173`）をブラウザで開く。アプリは投稿ファイルをサーバーへ送信・保存せず、ブラウザ内で処理する。実行前に必要な入力形式、検出範囲、制約を `doc/specs/system_spec/spec.md` で確認すること。

テストは以下で実行する。

```bash
cd app
npm test
```

### サンプルでの確認

`app/examples/sample-posts.json` は架空の投稿データである。起動後にこのファイルを選択し、既定値で検出を実行すると、URL差を無視した完全一致クラスタが1件表示される。近似一致の例を確認する場合は、閾値を0.65以下に変更して再実行する。

## ドキュメント配置ルール

- ルールは `doc/rules/` に格納する
- 調査結果は `doc/research/` に格納する
- issue単位の変更仕様・作業計画は `doc/issues/` にフォルダ単位で格納する（命名: `YYYYMMDD_NN_概要英語`）
- 仕様書は `doc/specs/` に格納し、内容の種別ごとにサブフォルダで分類する
  - 標準カテゴリ: `business_requirements/`（ビジネス要件）、`system_requirements/`（システム要件）、`system_spec/`（システムの仕様）、`overview_design/`（概要設計）、`architecture_design/`（方式設計）、`detail_design/`（詳細設計）
  - 追加カテゴリ: `marketing/`（マーケティング）、`pricing/`（価格設計）、`measurement/`（計測）
  - 複数カテゴリを横断する全体メモは `doc/specs/` 直下に置く（例: `important.md`）

## フォルダ構成

```text
.
|-- README.md                        # プロジェクト概要、実行方法、ドキュメント方針
|-- LICENSE                          # Apache License 2.0
|-- app                              # ローカルWebアプリの実装（詳細は各ディレクトリ内を参照）
|-- doc                              # ドキュメント一式
|   |-- issues                       # issue単位の変更仕様・作業計画
|   |   `-- 20260812_01_local_web_mvp
|   |       |-- 20260812_0000-handover.md # 作業状況・引継ぎ
|   |       |-- 20260812_browser_check.md # ブラウザでの動作確認記録
|   |       `-- work_plan.md         # ローカルWebアプリMVPの作業計画
|   |-- research                     # 調査結果を格納
|   |   `-- 20260811_x_rules_on_duplicate_posts.md # Xの複数アカウント運用と重複投稿の扱い
|   |-- rules                        # 運用・編集ルール
|   |   `-- rules_for_ai_and_human.md # AI・人間共通の作業/編集ルール
|   `-- specs                        # 仕様書を種別ごとに格納
|       |-- evaluation_criteria.md   # 審査基準への適合性（横断）
|       |-- full-specs.md            # 全体仕様（各仕様へのインデックス）
|       |-- business_requirements
|       |   `-- goal_and_usecases.md # ゴール・目的・ユースケース
|       |-- system_requirements
|       |   `-- system_requirements.md # 対象SNS・OSS/有料の切り分け・検出要件・規約遵守要件
|       |-- system_spec
|       |   `-- spec.md              # ローカルWebアプリMVPのシステム仕様
|       |-- overview_design
|       |   `-- local_web_mvp.md     # 全体構成・処理フローの概要設計
|       |-- architecture_design
|       |   `-- local_web_mvp.md     # 技術方式・拡張点・セキュリティ設計
|       |-- detail_design
|       |   `-- detection_engine.md  # 入力検証・検出・CSV出力の詳細設計
|       |-- marketing                # マーケティング（未着手）
|       |-- pricing
|       |   `-- monetization_policy.md # マネタイズ方針・有料機能の境界
|       `-- measurement              # 計測（未着手）
`-- experiments                      # 実験・検証用の一時的な成果物
```
