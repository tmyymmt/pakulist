# 意味的類似判定・候補再構成 詳細設計

## 1. 目的と適用範囲

本書は、現行OSSに含まれる**ローカル専用の意味的類似判定プロトタイプ**と、その評価・連携境界を定義する。利用者が明示的に有効化し、ローカル意味的APIを固定モデルおよび一時的なOrcaRouter APIキーで起動した場合だけ、決定的検出結果を補助的に再評価する。

> 意味的判定は、投稿の権利侵害、規約違反、アカウントの関係性、不正行為その他の結論を自動で出すものではない。結果は利用者による手動確認の候補である。

| 区分 | 決定的検出 | ローカル意味的プロトタイプ | 将来の管理型サービス |
| --- | --- | --- | --- |
| 実行場所 | 利用者ブラウザ | 利用者端末のlocalhostプロセス | 認証済みサーバー側 |
| 入力 | 選択した投稿ファイル全体 | 選定された候補ペア本文 | 承認済みデータソース |
| 結果 | 完全一致・Jaccard近似 | 最終近似一致の追加・除外、又は棄権 | 利用枠・保存を伴う判定（未実装） |
| キー | 不要 | 一時的なプロセス環境変数 | シークレットストア |
| 保存・課金・認証 | 行わない | 行わない | 後続フェーズ |

## 2. 候補選定と最終再構成

### 2.1 候補の最小化

完全一致クラスタの投稿は意味的候補から除外する。通常のクラスタモードでのみ、次の異アカウントペアを候補にする。

| 種別 | 作成方法 | 優先順位 | 目的 |
| --- | --- | --- | --- |
| `lexical` | 決定的な近似一致クラスタ内の投稿ペア | 高 | 文字列上は近いが、否定・条件・対象範囲により非一致となる誤検知を確認する。 |
| `discovery` | 完全一致を除く投稿を日時順に並べた隣接異アカウント投稿ペア | 低 | 語彙の重なりが少ない言い換えを限定的に発見する。 |

同一ペアは一度だけ評価する。`lexical`を先に並べ、次に時刻差、投稿IDで安定して並べる。1回の実行で確認する候補は最大50組、同時要求は最大3組とする。`discovery`は全組合せ生成を避ける実験的な再現率拡張であり、時系列上離れた言い換えを検出するものではない。

### 2.2 LLM結果の適用規則

| 候補種別 | 結果 | 最終近似一致への影響 |
| --- | --- | --- |
| `lexical` | `match` | 決定的エッジを維持する。 |
| `lexical` | `non_match` | 決定的エッジを除外する。 |
| `lexical` | `abstain`、利用不可、未確認 | 決定的エッジを維持する。 |
| `discovery` | `match` | エッジを追加し、近似一致クラスタを形成又は拡張する。 |
| `discovery` | `non_match`、`abstain`、利用不可、未確認 | エッジを追加しない。 |

有効エッジだけでUnion-Findを再構成し、異なるアカウントを2つ以上含む成分だけを最終近似一致として表示する。完全一致クラスタは保持する。画面と証拠パッケージには、確認件数、`match`、`non_match`、棄権・利用不可、LLM追加件数、LLM除外件数を示す。

## 3. 評価セット

`app/evaluation/semantic-similarity-cases.json`は、モデル品質を比較するための架空テキストだけの評価セットである。`app/examples/x-timeline-50-semantic-cases.json`は、実際の入力・候補選定・再構成を試す架空のX API Search形式データである。後者は50投稿・10アカウントを含み、完全一致、文字列近似、意味的言い換え、意味の矛盾・条件差、LLMを要する言い換え、非一致対照を持つ。

| ラベル | 意味 | 例 |
| --- | --- | --- |
| `match` | 中心的な事実・意図が実質同一で表現だけが変わる | 中止の言い換え、返金の言い換え、発送と到着予定の言い換え。 |
| `non_match` | 表層が似ていても中心的な事実・意図が異なる | 公開する／公開しない、雨天時開催／中止、追加料金の有無。 |
| `abstain` | モデルが判断を保留し、人間確認へ回す | 正解ラベルとして使わず、推論時だけ使う。 |

実データへ拡張する場合は、目的、データソース、最小化、保持、削除、再配布、資格情報、監査を外部データ連携のガバナンス要件に従って確認する。[1]

## 4. 比較指標

`evaluateSemanticPredictions(cases, predictions)`は`match`を陽性として、適合率、再現率、F1、正解率、偽陽性率、棄権率を返す。候補生成も評価対象であるため、モデル単体のラベル精度とは別に、`lexical`、`discovery`、候補上限ごとの到達率と誤検知を記録する。

| 指標 | 定義 | 確認する危険 |
| --- | --- | --- |
| 適合率 | `TP / (TP + FP)` | 不適切な候補追加。 |
| 再現率 | `TP / (TP + FN)` | 言い換えの取りこぼし。 |
| 偽陽性率 | `FP / (FP + TN)` | 文字列近似候補の誤維持。 |
| 棄権率 | `abstained / total` | モデルが十分に判断できない範囲。 |
| 候補到達率 | LLM評価へ渡せた正例 / 全正例 | 時系列隣接・上限がもたらす候補生成上の取りこぼし。 |

## 5. ローカルAPIと通信契約

`app/semantic-api-server.js`は既定で`127.0.0.1:4180`だけにバインドする。`GET /healthz`は設定状態だけを返し、キー・環境変数値を返さない。`POST /v1/semantic-judgments`は`requestId`、`candidateId`、`left.text`、`right.text`を受け付け、各本文を4,000文字以下に制限する。

`app/server.js`は、ループバック接続だけから`GET /api/semantic-status`と`POST /api/semantic-judgments`を受け付け、本文32KB以下・12秒タイムアウトでローカル意味的APIへ中継する。任意の`SEMANTIC_API_BEARER_TOKEN`はサーバー側だけで付与する。ブラウザはOrcaRouter APIキーにアクセスしない。

```json
{
  "requestId": "opaque-request-id",
  "candidateId": "semantic:post-left:post-right",
  "left": {"text": "最小化済みの投稿本文"},
  "right": {"text": "最小化済みの投稿本文"},
  "policyVersion": "semantic-v1",
  "model": "provider-prefixed-model-id"
}
```

正常応答は`status`、`label`、0〜1の`score`、`resolvedModel`、トークン使用量を返す。本文、完全なプロンプト、APIキー、上流の生エラー本文を返却・保存しない。

| 条件 | 応答 | UI・再構成への影響 |
| --- | --- | --- |
| APIキー又は固定モデルが未設定 | 503、`unavailable` / `abstain` | `lexical`は維持、`discovery`は追加しない。 |
| 正常な構造化応答 | 200、`completed`、ラベル、スコア、モデル | §2.2を適用する。 |
| 401、402、429、502、タイムアウト、応答不正 | 503、`unavailable` / `abstain` | 決定的結果を壊さない。 |
| 入力不正・本文長超過 | 400 | 当該候補を成功扱いにしない。 |

## 6. OrcaRouterアダプターと設定

OrcaRouterはOpenAI互換APIを提供し、ベースURLは`https://api.orcarouter.ai/v1`である。認証はBearer APIキー、モデルはprovider-prefixed ID、要求はチャット補完の標準形を用いる。[2] 再現性のため`orcarouter/auto`は拒否し、固定モデルを使う。

| 変数 | 必須 | 用途 | 制約 |
| --- | --- | --- | --- |
| `ORCAROUTER_API_KEY` | 実通信時 | OrcaRouterのBearer APIキー。 | 意味的APIプロセスだけが読む。 |
| `ORCAROUTER_MODEL` | 実通信時 | 固定・provider-prefixedモデル。 | `orcarouter/auto`を拒否する。 |
| `ORCAROUTER_BASE_URL` | 任意 | 既定API URLの上書き。 | `https://` URLだけを受け入れる。 |
| `SEMANTIC_API_BEARER_TOKEN` | 任意 | ローカルAPI中継トークン。 | ブラウザ・リポジトリへ保存しない。 |
| `SEMANTIC_API_HOST` / `SEMANTIC_API_PORT` | 任意 | localhost APIの上書き。 | 公開運用には使わない。 |

キーを`.env`、リポジトリ、ブラウザ、CSV/JSON、ログ、Issue、PRに保存してはならない。

## 7. 原価・導入ゲート

判定単価は入力・出力トークン単価とルーター追加費用から計算する。OrcaRouterの料金や上流プロバイダー単価は変動し得るため、モデル名と単価をソースコードに固定しない。[3] ローカル試作は利用者のキーで実行し、課金・利用枠・保存を提供しない。

管理型サービスへ進む前に、固定モデルでの実データ品質、候補到達率、原価、利用者認証、シークレットストア、保持・削除、利用枠、予算、障害時の安全な棄権を別途検証する。

## 参考資料

[1]: ../system_requirements/external_data_governance.md "外部データ連携のガバナンス要件"
[2]: https://docs.orcarouter.ai/api-reference/chat/create-a-chat-completion "OrcaRouter API Reference: Create a chat completion"
[3]: https://orcarouter.ai/pricing "OrcaRouter Pricing"
