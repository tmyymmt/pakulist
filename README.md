# pakulist

SNS（初期対応は X）上で同一または実質同一の投稿をしている複数アカウントを検出してリスト化し、利用者が SNS 運営へ通報できる状態にするツール。

- ベース部分は OSS として公開（Apache License 2.0）
- AI による類似投稿判定はクローズドな有料サービスとして提供する
- 現在のローカルアプリは、正規に取得済みのCSV/JSON投稿データを決定的に検出・出力する
- 利用者が明示的に有効化し、ローカルのOrcaRouter意味的類似APIを起動した場合だけ、文字列近似候補と時系列近傍の発見候補の本文を意味的類似の補助判定に送る。LLMの一致は最終近似一致へ追加し、LLMの不一致は文字列近似候補から除外する。完全一致はブラウザ内だけで判定し、外部APIへ送信しない

仕様の入口は `doc/specs/full-specs.md` を参照。現行ローカルアプリの入力・検出仕様は `doc/specs/system_spec/spec.md`、意味的類似判定の評価・外部連携境界は `doc/specs/detail_design/semantic_similarity_evaluation.md` を参照する。

## ローカルWebアプリの実行

Node.js 22以降を用意してから、以下を実行する。

```bash
cd app
npm start
```

表示されたURL（既定では `http://127.0.0.1:4173`）をブラウザで開く。既定の決定的検出では、投稿ファイルをサーバーへ送信・保存せず、ブラウザ内で処理する。意味的類似判定を有効にする場合は、下記のローカルAPIも起動する。実行前に必要な入力形式、検出範囲、制約を `doc/specs/system_spec/spec.md` で確認すること。

## OrcaRouter意味的類似APIプロトタイプ

`app/semantic-api-server.js`は、OrcaRouterを使う**ローカル専用の試作API**である。画面上で「OrcaRouterで意味的類似を確認する」を明示的に有効化した場合だけ、文字列近似候補と時系列近傍の発見候補の投稿本文を受け付ける。LLMの一致は最終近似一致へ追加し、LLMの不一致は文字列近似候補から除外する。完全一致はブラウザ内だけで判定し、APIへ送らない。本番の利用者認証、保存、課金、利用枠、X API取得は実装しない。既定で`127.0.0.1:4180`にだけバインドするため、公開インターネットへ公開してはならない。

APIキー未設定でも、外部通信を行わずにHTTP境界を確認できる。

```bash
cd app
npm run start:semantic-api
curl http://127.0.0.1:4180/healthz
```

実APIを使うローカル試作では、取得したキーを**一時的なサーバープロセス環境変数**としてだけ設定する。キーを`.env`、リポジトリ、ブラウザ、CSV/JSON、ログ、Issue、PRへ保存してはならない。

```bash
cd app
export ORCAROUTER_API_KEY='<OrcaRouterで取得したキー>'
export ORCAROUTER_MODEL='openai/gpt-4o-mini'
npm run start:semantic-api
```

別のターミナルで`npm start`を実行し、`http://127.0.0.1:4173`を開く。画面で意味的類似判定を有効にすると、文字列近似候補と時系列上で隣接する発見候補をローカルAPI経由で判定する。LLMの一致は最終近似一致へ追加し、LLMの不一致は文字列近似候補から除外する。完全一致はAPI対象外であり、ブラウザ内だけで確定する。1回の実行では最大50組を同時3件まで確認し、起点指定による時系列コピー候補モードでは意味的類似判定を実行しない。

`ORCAROUTER_MODEL`はプロバイダー接頭辞付きの固定モデルを指定する。再現性を保つため`orcarouter/auto`は受け付けない。APIキーを`.env`、リポジトリ、ブラウザ、CSV/JSON、ログ、Issue、PRへ保存してはならない。設定、入力・出力、障害時の棄権、実運用の導入ゲートは`doc/specs/detail_design/semantic_similarity_evaluation.md`を正とする。

テストは以下で実行する。

```bash
cd app
npm test
npm run test:all
```

性能ベンチマークと回帰チェックは以下で実行する。`bench:check`は、完全一致・近似一致それぞれ1,000件・5,000件の固定シナリオが性能基準を超えると失敗する。

```bash
cd app
npm run bench
npm run bench:check
```

### サンプルでの確認

`app/examples/sample-posts.json` は標準形式の架空投稿データである。起動後にこのファイルを選択し、既定値で検出を実行すると、URL差を無視した完全一致クラスタが1件表示される。近似一致の例を確認する場合は、閾値を0.65以下に変更して再実行する。

`app/examples/sample-x-api-search.json` は、資格情報を含まないX API v2 Search形式の架空レスポンスである。このファイルを選択しても同じ完全一致クラスタが1件表示され、ローカル変換を確認できる。`app/examples/x-timeline-dummy-pakulist.json` は、5アカウント・16投稿からなり、完全一致、URL差、メンション差、近似一致を含む架空タイムラインである。意味的類似判定を有効にした画面フローの確認にも使用できる。`app/examples/x-timeline-50-semantic-cases.json` は、10アカウント・50投稿からなり、完全一致、文字列近似、語彙が近い意味的言い換え、否定・条件による非一致、非一致対照に加え、文字列近似では候補化されにくいLLM必須の言い換え4組を含む。既定の閾値0.80では、完全一致3クラスタと文字列近似・否定文の近似4クラスタが表示される。投稿038–045の4組は文字列Jaccard類似度0.00–0.09であり、最小閾値0.50にも届かないため、現行の文字列候補化の後にLLM判定を行う構成ではAPIへ送られない。これらを自動検出するには、候補生成段階に意味検索・埋め込み検索・LLMを追加する必要がある。語彙が近い意味的言い換え049–050の事前候補を含めるには、近似一致の閾値を0.70へ下げる。完全一致はOrcaRouterへ送信されず、近似一致だけが意味的類似判定の対象になる。これらのサンプルは実APIへ接続しない。実際のX API由来データを取得・利用する場合には `doc/specs/system_requirements/x_data_acquisition_policy.md` と `doc/specs/system_requirements/external_data_governance.md` の条件を満たす必要がある。

`app/evaluation/semantic-similarity-cases.json` は、将来の有料AI機能を評価するための架空ラベル付きテキストである。アプリの入力ファイルではなく、外部AI APIを呼び出さない評価ユーティリティの回帰用データとして扱う。

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
|   |   |-- 20260812_01_local_web_mvp
|   |   |   |-- 20260812_0000-handover.md # 作業状況・引継ぎ
|   |   |   |-- 20260812_browser_check.md # ブラウザでの動作確認記録
|   |   |   `-- work_plan.md         # ローカルWebアプリMVPの作業計画
|   |   |-- 20260812_02_update_evaluation_criteria
|   |   |   |-- 20260812_1300-handover.md # 評価基準更新の引継ぎ記録
|   |   |   `-- work_plan.md         # 評価基準更新の作業計画
|   |   |-- 20260812_03_x_data_acquisition_decision
|   |   |   |-- 20260812_1315-handover.md # Xデータ取得方針の引継ぎ記録
|   |   |   `-- work_plan.md         # Xデータ取得方針の作業計画
|   |   |-- 20260812_04_external_data_governance
|   |   |   |-- 20260812_1330-handover.md # 外部データ管理方針の引継ぎ記録
|   |   |   `-- work_plan.md         # 外部データ管理方針の作業計画
|   |   |-- 20260812_05_x_api_input_adapter
|   |   |   |-- 20260812_1345-handover.md # X API入力アダプターの引継ぎ記録
|   |   |   `-- work_plan.md         # X API入力アダプターの作業計画
|   |   |-- 20260812_06_detection_performance
|   |   |   |-- 20260812_1400-handover.md # 検出性能改善の引継ぎ記録
|   |   |   `-- work_plan.md         # 検出性能改善の作業計画
|   |   `-- 20260812_07_browser_e2e
|   |       |-- 20260812_1415-handover.md # ブラウザE2Eの引継ぎ記録
|   |       `-- work_plan.md         # ブラウザE2Eの作業計画
|   |-- research                     # 調査結果を格納
|   |   |-- 20260811_x_rules_on_duplicate_posts.md # Xの複数アカウント運用と重複投稿の扱い
|   |   `-- 20260812_x_data_acquisition_options.md # X投稿データの正規取得・利用経路の調査
|   |-- rules                        # 運用・編集ルール
|   |   `-- rules_for_ai_and_human.md # AI・人間共通の作業/編集ルール
|   `-- specs                        # 仕様書を種別ごとに格納
|       |-- evaluation_criteria.md   # 審査基準への適合性（横断）
|       |-- full-specs.md            # 全体仕様（各仕様へのインデックス）
|       |-- business_requirements
|       |   `-- goal_and_usecases.md # ゴール・目的・ユースケース
|       |-- system_requirements
|       |   |-- system_requirements.md # 対象SNS・OSS/有料の切り分け・検出要件・規約遵守要件
|       |   |-- x_data_acquisition_policy.md # X投稿データの正規取得・利用ポリシー
|       |   `-- external_data_governance.md # 外部データ連携のガバナンス要件
|       |-- system_spec
|       |   `-- spec.md              # ローカルWebアプリMVPのシステム仕様
|       |-- overview_design
|       |   `-- local_web_mvp.md     # 全体構成・処理フローの概要設計
|       |-- architecture_design
|       |   `-- local_web_mvp.md     # 技術方式・拡張点・セキュリティ設計
|       |-- detail_design
|       |   |-- detection_engine.md  # 入力検証・検出・CSV出力の詳細設計
|       |   |-- x_api_input_adapter.md # 保存済みX API Search JSONの変換設計
|       |   |-- performance_and_responsiveness.md # 検出性能と処理中応答性の設計
|       |   `-- browser_e2e_testing.md # ブラウザE2Eのテスト設計
|       |-- marketing                # マーケティング（未着手）
|       |-- pricing
|       |   `-- monetization_policy.md # マネタイズ方針・有料機能の境界
|       `-- measurement              # 計測（未着手）
`-- experiments                      # 実験・検証用の一時的な成果物
```
