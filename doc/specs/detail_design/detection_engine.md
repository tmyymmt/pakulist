# 詳細設計: 決定的検出と意味的再構成

## 1. データモデル

```js
/** @typedef {{ id: string, account: string, url: string, postedAt: string, text: string }} Post */
/** @typedef {{ id: string, matchType: 'exact'|'approximate', similarity: number, posts: Post[], accountCount: number, postCount: number, semantic?: SemanticSummary|null }} DetectionCluster */
/** @typedef {{ approximate: boolean, threshold: number, ignoreUrls: boolean, ignoreMentions: boolean }} DetectionOptions */
/** @typedef {{ completed: number, matches: number, nonMatches: number, abstained: number, unavailable: number, highestScore: number|null, resolvedModels: string[] }} SemanticSummary */
```

入力投稿は検証後に空白を除去した`id`・`account`・`url`・`postedAt`・`text`を持つ。クラスタIDは実行ごとに`C-001`から連番で発行し、永続化しない。意味的確認の集計は近似一致クラスタだけに付与する。

## 2. モジュールと公開関数

| モジュール | 関数 | 入力 | 出力 | 副作用 |
| --- | --- | --- | --- | --- |
| `detection.js` | `parseInput` | ファイル本文、拡張子 | 投稿配列 | なし |
| `detection.js` | `validatePosts` | 投稿配列 | 検証済み投稿配列 | なし |
| `detection.js` | `normalizeText` | 本文、設定 | 正規化文字列 | なし |
| `detection.js` | `jaccardSimilarity` | 2つの正規化文字列 | `0`〜`1` | なし |
| `detection.js` | `findDuplicateClusters` | 投稿配列、設定 | 決定的クラスタ配列 | なし |
| `detection.js` | `clustersToCsv` | クラスタ配列 | CSV文字列 | なし |
| `semantic-cluster-reconciliation.js` | `createSemanticCandidates` | 投稿、決定的クラスタ | 優先順候補ペア | なし |
| `semantic-cluster-reconciliation.js` | `reconcileSemanticClusters` | 投稿、決定的クラスタ、候補、LLM結果 | 最終クラスタ、追加・除外件数 | なし |

## 3. 入力検証と決定的検出

JSONは投稿配列、`posts`配列、又はX API v2 Search形式を受理する。最大5,000件、必須項目、`https:` URL、タイムゾーンを含むISO 8601日時、重複しない投稿IDを確認する。

比較用本文はNFKC、小文字化、URL・メンション除去（有効時）、改行・連続空白の単一空白化、前後空白除去を行う。正規化後の空文字列はクラスタ化しない。

1. 空でない同じ正規化本文をMapへ入れ、異アカウント2つ以上を含む集合を完全一致クラスタにする。
2. 完全一致クラスタの投稿を除く。
3. 近似一致が有効なら、残りの異アカウント投稿を接頭辞フィルタとトークン数比で絞り、Jaccard類似度が閾値以上のペアをUnion-Findで連結する。
4. 異アカウント2つ以上を含む連結成分を決定的な近似一致クラスタにする。

## 4. 意味的候補選定

意味的候補選定は通常クラスタモードだけで行う。完全一致クラスタの投稿、同一アカウントのペア、自己ペアは対象外である。

| 候補 | 生成方法 | 優先 |
| --- | --- | --- |
| `lexical` | 決定的な近似一致クラスタ内の異アカウント投稿ペア。 | 先に評価する。 |
| `discovery` | 完全一致を除いた投稿を投稿日時順に並べ、隣接する異アカウント投稿ペア。 | `lexical`の後に評価する。 |

同一ペアは候補種別を併合する。候補は時刻差、投稿IDで安定して並び、UIは先頭50組だけを同時3件まで意味的APIへ送る。`discovery`は全組合せを避ける限定的な候補生成であり、時系列上離れた意味的言い換えを保証しない。

## 5. 最終クラスタの再構成

意味的APIの完了結果だけを適用する。`match`は候補エッジを有効にし、`non_match`は`lexical`エッジを無効にする。`discovery`エッジは`match`の場合だけ有効になる。未確認、`abstain`、利用不可の`lexical`エッジは決定的結果として残る。

1. 完全一致クラスタをそのまま保持する。
2. 完全一致以外の投稿をUnion-Findへ入れる。
3. 有効な`lexical`又は`match`の`discovery`エッジだけを結合する。
4. 異アカウント2つ以上の成分を最終近似一致クラスタにする。
5. 完全一致を先頭にし、近似一致の類似度、アカウント数、先頭投稿日時で安定して並べ、IDを再採番する。
6. 近似一致には、成分内の意味的完了件数、ラベル集計、最大スコア、モデル名を付与する。

## 6. 出力保護

CSVはすべてのセルを二重引用符で囲み、二重引用符を`""`へ置換する。先頭が`=`, `+`, `-`, `@`の値にはアポストロフィを付け、CSVインジェクションを防ぐ。HTML証拠パッケージは投稿本文・URL・アカウント・意味的集計をエスケープして表示する。

## 7. テスト観点

| 観点 | 確認内容 |
| --- | --- |
| 完全一致 | 異アカウントの正規化済み一致をクラスタ化し、意味的候補から除外する。 |
| 決定的近似 | 閾値以上のJaccard類似をクラスタ化し、同一アカウントだけの成分を除外する。 |
| LLM除外 | `non_match`が文字列近似エッジを除外し、クラスタが消滅又は分割される。 |
| LLM追加 | `match`が`discovery`エッジを追加し、文字列近似外のクラスタを形成又は拡張する。 |
| 棄権・障害 | 未確認、棄権、利用不可の文字列近似候補を維持し、発見候補は追加しない。 |
| 上限・順序 | 最大50候補、候補種別優先、時刻差とIDによる安定順序を確認する。 |
| 出力保護 | CSVとHTMLで特殊文字、数式、投稿本文を安全に出力する。 |
