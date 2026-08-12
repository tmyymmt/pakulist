# 意味的類似判定の評価・連携境界 詳細設計

## 1. 目的と適用範囲

本書は、将来のクローズドな有料サービスで提供する**AIによる意味的類似判定**を、再現可能な評価と安全な外部連携の境界に基づいて導入するための設計である。現行OSS MVPは対象外であり、ブラウザ内の決定的な完全一致・近似一致検出を変更しない。

> AI判定は、決定的手法で絞り込んだ候補に対する補助的な候補順位付けである。権利侵害、利用規約違反、アカウントの関係性、不正行為その他の結論を自動で出してはならない。

| 区分 | 現行OSS MVP | 将来の有料サービス |
| --- | --- | --- |
| 実行場所 | 利用者ブラウザ内 | 認証済みのサーバー側サービス |
| 検出方法 | 完全一致・近似一致 | 決定的候補を入力とする意味的類似判定 |
| 外部通信 | 行わない | 承認済みのAIプロバイダーに限定 |
| APIキー | 保持・利用しない | シークレットストアだけで保持 |
| 結果の意味 | 類似候補 | 意味的類似の補助的候補、又は棄権 |

## 2. 評価セット

評価セットは`app/evaluation/semantic-similarity-cases.json`に保存する。初版は架空テキストのみで構成し、外部SNS投稿、ユーザーID、URL、個人情報、資格情報を含めない。ケースごとにID、カテゴリ、左右テキスト、正解ラベルを持つ。

| ラベル | 意味 | 初版の例 |
| --- | --- | --- |
| `match` | 中心的な事実・意図が実質同一で、表現だけが変わる | 言い換え、語順変更、略記、情報追加を伴う同一告知 |
| `non_match` | 表層が似ていても中心的な事実・意図が異なる | 定型挨拶、同一語を含む別話題、日付・場所・立場が異なる文 |
| `abstain` | モデルが判断を保留し、人間確認へ回す出力 | 正解ラベルとしては使わず、推論時だけ使用 |

実データへ拡張する場合は、目的、データソース、最小化、保持、削除、再配布、資格情報、監査を外部データ連携のガバナンス要件に従って先に確認する。[1]

## 3. 比較指標

評価実装の`evaluateSemanticPredictions(cases, predictions)`は、全ケースについて単一の予測を受け取り、`match`を陽性として以下を返す。`abstain`は誤判定として数えず、棄権率で独立して監視する。

| 指標 | 定義 | 導入判断での意味 |
| --- | --- | --- |
| 適合率（precision） | `TP / (TP + FP)` | 誤って候補化する危険を抑える。 |
| 再現率（recall） | `TP / (TP + FN)` | 実質同一の候補を取りこぼさない。 |
| F1 | `2 × precision × recall / (precision + recall)` | 適合率と再現率の均衡を比較する。 |
| 正解率（accuracy） | `(TP + TN) / decided` | 棄権を除く二値判定の概況を示す。 |
| 偽陽性率（FPR） | `FP / (FP + TN)` | 無関係投稿を候補化する比率を示す。 |
| 棄権率 | `abstained / total` | モデルが十分な確信を持てない範囲を示す。 |

AI導入候補は、同じ評価セット・同じ閾値・同じ棄権ルールで現行の決定的手法と比較する。単一のスコアだけで採用せず、特に偽陽性率、棄権率、ケースカテゴリ別の誤り、判定当たり原価を合わせてレビューする。

## 4. サービス境界と通信契約

`app/src/detection.js`、ブラウザUI、CSV/HTML出力は、AIプロバイダー、APIキー、HTTPクライアント、モデル名に依存してはならない。有料サービス側に`SemanticSimilarityProvider`を置き、正規化済みの候補ペアだけを渡す。外部ゲートウェイは現時点でOrcaRouterを候補とするが、プロバイダー固有のコードはこのアダプターに閉じ込める。

```json
{
  "requestId": "opaque-request-id",
  "candidateId": "opaque-candidate-id",
  "left": {"text": "最小化済みの投稿本文"},
  "right": {"text": "最小化済みの投稿本文"},
  "policyVersion": "semantic-v1",
  "model": "provider-prefixed-model-id"
}
```

正常時の応答は、下記の最小スキーマで保存・返却する。本文そのもの、トークン、自由記述の根拠、完全なプロンプト、APIキーは監査ログに含めない。

```json
{
  "requestId": "opaque-request-id",
  "candidateId": "opaque-candidate-id",
  "status": "completed",
  "label": "match",
  "score": 0.0,
  "policyVersion": "semantic-v1",
  "provider": "orcarouter",
  "resolvedModel": "provider-prefixed-model-id",
  "usage": {"inputTokens": 0, "outputTokens": 0},
  "cost": {"currency": "USD", "amount": 0}
}
```

`score`は0以上1以下の数値であり、`label`は`match`、`non_match`、`abstain`だけを許容する。スコアは判定の信頼度として扱わず、モデル・プロンプト・評価セット・閾値の組み合わせの範囲でだけ解釈する。

## 5. OrcaRouterアダプター

OrcaRouterはOpenAI互換APIを提供し、ベースURLは`https://api.orcarouter.ai/v1`である。認証はBearer APIキー、モデルはprovider-prefixed ID、リクエストはチャット補完の標準形を用いる。[2] デフォルトの`orcarouter/auto`は、安価な稼働モデルを動的に選ぶため、再現性を必要とする評価実験では禁止する。[2]

可用性のためにフォールバックチェーンを構成するときは、最大5モデルまでの`extra_body.models`と`route: fallback`を使える。[2] ただし、品質比較はモデル・プロンプトの版を固定して別途実行し、フォールバックの結果と混在させない。応答ヘッダー又は応答情報から、実際に解決されたモデルとフォールバック段階だけを記録する。

| 事象 | サービスの応答 | OSSへの影響 |
| --- | --- | --- |
| 401（認証失敗） | `status: unavailable`、`label: abstain`。資格情報の再設定を運用者に通知する。 | 影響なし。決定的候補だけを表示する。 |
| 402（クォータ不足） | AIキューを停止し、`label: abstain`を返す。 | 影響なし。 |
| 429（レート制限） | `Retry-After`を尊重して限定的に再試行し、上限後は棄権する。 | 影響なし。 |
| 502（上流障害） | 一時障害として限定的に再試行し、上限後は棄権する。 | 影響なし。 |
| JSON不正・スキーマ違反 | 応答を拒否して棄権する。 | 影響なし。 |

## 6. 原価計算と予算制御

OrcaRouterはルーティングのトークンマークアップを0と説明している一方、上流プロバイダーのトークン料金、任意の月額プラン、税、為替は別途発生し得る。[3] モデル名と単価は運用時設定として保持し、ソースコードへ固定値を埋め込まない。

```text
costPerJudgment = (inputTokens / 1,000,000 × inputPricePerMToken)
                + (outputTokens / 1,000,000 × outputPricePerMToken)
                + routerSurcharge
monthlyCost = costPerJudgment × monthlyJudgments + subscriptionFee
```

評価ユーティリティの`estimateSemanticJudgmentCost`は上式の1判定部分を計算する。運用では実測使用量を採用し、リトライ・フォールバック・キャッシュを別の見積もり係数として可視化する。月額予算の80%で警告し、100%で新規AI判定を停止して決定的手法へフォールバックする。

## 7. 導入ゲート

実API連携を実装又は有効化する前に、次の全条件を満たす必要がある。

| ゲート | 必要な証跡 |
| --- | --- |
| 資格情報 | 利用者提供のAPIキーをサーバー側シークレットストアへ設定し、クライアント・コード・ログへ出ないことを確認する。 |
| 料金 | 利用モデル、入力・出力単価、月額費、通貨、予算上限、アラートを当日の公式料金表で確定する。 |
| データ | 評価データの権限、利用目的、最小化、保持・削除・再配布方針を承認する。 |
| 品質 | 決定的手法との比較結果、カテゴリ別の失敗、F1、偽陽性率、棄権率、原価をレビューする。 |
| 障害 | 401、402、429、502、タイムアウト、構造化出力不正時に、候補を成功扱いにせず安全に棄権できることを統合テストする。 |

## 参考資料

[1]: ../system_requirements/external_data_governance.md "外部データ連携のガバナンス要件"
[2]: https://docs.orcarouter.ai/api-reference/chat/create-a-chat-completion "OrcaRouter API Reference: Create a chat completion"
[3]: https://orcarouter.ai/pricing "OrcaRouter Pricing"
