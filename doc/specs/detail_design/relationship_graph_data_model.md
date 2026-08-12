# 関係性グラフのデータモデルと保持境界

## 1. 目的と非対象

本設計は、将来の関係性可視化に必要な論理スキーマ、集計契約、保持境界を定義する。現行OSS MVPはブラウザ内で解析し、入力・結果をサーバーへ保存しない。この設計は、DB、ユーザー認証、サーバー保存、外部X API、実際のグラフUIを現行MVPへ追加するものではない。

> 関係性エッジは、同一・近似文面の観測、または時系列上の後発候補を表す分析上の根拠であり、共同運用、不正行為、権利侵害その他の事実・法的結論を表すものではない。

## 2. 論理エンティティ

| エンティティ | 主キー | 最小フィールド | 役割 |
| --- | --- | --- | --- |
| `case` | `caseId` | `purposeCode`、`createdAt`、`retentionPolicyVersion` | 利用目的と保持ルールを持つ分析事案。 |
| `data_source` | `sourceId` | `sourceType`、`acquiredAt`、`queryHash`、`termsVersion` | ローカル利用者ファイルと将来の公式API取得を区別する。秘密情報・生クエリは保持しない。 |
| `account` | `accountId` | `provider`、`externalAccountRef`、`firstObservedAt`、`lastObservedAt` | Xアカウントを表すノード。`externalAccountRef`はデータソースごとに正規化する。 |
| `post_reference` | `postRefId` | `externalPostId`、`accountId`、`postedAt`、`canonicalUrl`、`sourceId`、`availability` | 投稿の最小参照。本文は必要な期間だけ別区分で扱う。 |
| `detection_run` | `runId` | `algorithmVersion`、`settingsHash`、`executedAt`、`inputManifestHash` | 同じ根拠を再現するための解析実行記録。 |
| `cluster` | `clusterId` | `runId`、`matchType`、`maxSimilarity`、`memberCount` | 完全一致・近似一致の分析結果。 |
| `cluster_member` | `(clusterId, postRefId)` | `role`、`similarityToAnchor` | 投稿とクラスタの対応。`role`は通常`member`、UC-03では`origin`または`candidate`。 |
| `relationship_edge` | `edgeId` | `fromAccountId`、`toAccountId`、`relationType`、`weight`、`evidenceCount`、`firstObservedAt`、`lastObservedAt` | グラフ表示用の導出エッジ。 |
| `edge_evidence` | `(edgeId, clusterId, postRefId)` | `evidenceRole`、`similarity`、`timeDifferenceSeconds` | エッジの説明可能性を担保する最小の根拠参照。 |

`relationship_edge.relationType`は、少なくとも`shared_content`（アカウント間の同一・近似文面の観測、無向）と`later_copy_candidate`（起点から後発候補、方向付き）を持つ。重みは確定的な集計値であり、例として`evidenceCount`と最大類似度の組合せを表示用に利用する。本文・推定属性・人間関係・違法性を重みに含めない。

## 3. グラフ投影と集計契約

将来のサービス層は、保存済みの論理エンティティから画面専用の`GraphProjection`を生成する。`GraphProjection`は表示に必要な導出値だけを返し、本文・認証情報・内部クエリ・不必要なプロフィール項目を含めない。

```json
{
  "caseId": "case_01H...",
  "generatedAt": "2026-08-12T00:00:00Z",
  "filter": {
    "from": "2026-08-01T00:00:00Z",
    "to": "2026-08-12T00:00:00Z",
    "relationTypes": ["shared_content", "later_copy_candidate"],
    "minimumEvidenceCount": 2
  },
  "nodes": [
    {
      "accountId": "x:alpha",
      "label": "@alpha",
      "firstObservedAt": "2026-08-01T00:00:00Z",
      "lastObservedAt": "2026-08-12T00:00:00Z",
      "degree": 3
    }
  ],
  "edges": [
    {
      "edgeId": "edge_01H...",
      "fromAccountId": "x:alpha",
      "toAccountId": "x:beta",
      "directed": true,
      "relationType": "later_copy_candidate",
      "evidenceCount": 2,
      "maxSimilarity": 1,
      "firstObservedAt": "2026-08-03T00:00:00Z",
      "lastObservedAt": "2026-08-10T00:00:00Z",
      "evidenceRefs": ["cluster_01H..."]
    }
  ]
}
```

将来の読み取りAPIは、事案単位の認可を前提に、次のような契約を採用する。

| 操作 | 将来の契約 | 必須フィルタ・制約 |
| --- | --- | --- |
| グラフ取得 | `GET /cases/{caseId}/graph` | 期間、関係種別、最小根拠数。`caseId`の利用権限を確認する。 |
| エッジ根拠取得 | `GET /cases/{caseId}/edges/{edgeId}/evidence` | 表示前に投稿の可用性・削除状態・出力条件を再確認する。 |
| エクスポート | `POST /cases/{caseId}/exports` | データソース・権限・再配布条件を確認し、本文を含む出力は個別許可を必須とする。 |

現行MVPは上記APIを提供しない。ブラウザ内の検出結果からグラフを自動保存・送信・共有してはならない。

## 4. データ境界

| 区分 | 保存先 | 保持 | 許容する内容 | 禁止事項 |
| --- | --- | --- | --- | --- |
| ブラウザ一時データ | メモリのみ | タブを閉じるまで | 利用者が選んだ入力、検出結果、設定 | サーバー送信、ブラウザストレージへの自動保存。 |
| 利用者明示エクスポート | 利用者が選択した端末・保存先 | 利用者の方針に従う | CSV、HTML証拠レポート、利用者が手動取得した添付物 | アプリによる自動アップロード・共有・同期。 |
| 将来のサービス保存 | 承認済みのサーバー側ストア | `external_data_governance.md`の上限に従う | 事案、最小の投稿参照、導出データ、監査情報 | 無許可の本文再配布、DM・保護投稿・位置情報・トークンの保存。 |

ローカル入力と将来のAPI取得データは`sourceType`で区別する。API取得X Contentは初期上限30日、導出データ・監査ログは初期上限90日とし、削除要求・利用不能化・事案終了時にはより早い時点で削除または非表示にする。対応する本文・アカウント・URLを削除した後は、品質測定に必要な非識別の集計値だけを残せる。詳細は`doc/specs/system_requirements/external_data_governance.md`のGOV-04〜GOV-09を正とする。

## 5. 再現性と削除

`detection_run`は、アルゴリズムバージョン、設定ハッシュ、入力マニフェストハッシュ、データソース、実行日時を記録する。本文・URL・アカウントを監査ログへ複製しない。再計算時は、投稿参照の可用性と削除状態を確認し、削除・保護化・利用不能な投稿をグラフと根拠表示から除外する。

削除は`post_reference`から`cluster_member`、`edge_evidence`、`relationship_edge`、検索・キャッシュ・エクスポート一時ファイルへ伝播する。根拠がなくなったエッジは削除し、残る根拠数・重みを再集計する。

## 6. 導入ゲート

将来のDB・認証・外部取得・グラフUIの実装前に、次をすべて満たす。

1. 公式データ取得と利用目的の承認を得る。
2. 事案単位の利用者認証・権限分離・監査を実装する。
3. 保存・削除・再配布・データソース区分を統合テストする。
4. 投稿の可用性・削除状態を表示・エクスポート直前に確認する。
5. グラフ表示に候補・根拠・限界を明示し、推定属性や法的結論を表示しない。

## 7. テスト観点

将来の実装では、同じ入力・設定で同じエッジが得られること、期間・関係種別・最小根拠数フィルタ、削除伝播、データソース別の出力制約、事案をまたぐアクセス拒否、本文を含まない監査ログを自動テストする。
