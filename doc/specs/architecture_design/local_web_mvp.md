# 方式設計: ローカルWebアプリMVP

## 1. 技術選定

現行MVPの実行時はNode.js 22の標準機能と、追加の実行時依存を持たないES Modulesで実装する。利用者はNode.jsを導入した環境で`npm start`を実行するだけでローカル利用できる。テストには開発依存としてPlaywrightを用いるが、ブラウザアプリの配布・実行には含めない。静的ファイル配信以外をブラウザで行うことで、投稿データをサーバー側に送らない。

| 領域 | 採用方式 | 選定理由 |
| --- | --- | --- |
| 実行環境 | Node.js 22以降 | `node:test`を含む標準機能を使え、追加インストールを不要にする。 |
| 配信 | Node.jsの`http` | ローカル検証用に責務を限定し、入力ファイルの受信機能を実装しない。 |
| UI | HTML/CSS/JavaScript | 入力データをブラウザ内で扱うための最小構成。 |
| 判定 | 純粋なJavaScript関数 | UIから独立してテスト可能にし、有料AI機能と分離する。 |
| テスト | `node:test` / `node:assert` / Playwright Chromium | ロジック・出力を標準テストで、画面操作・安全なリンク・入力エラーをブラウザE2Eで確認する。 |

## 2. モジュール境界

```text
app/
├── server.js                 # 静的配信だけを行うローカルHTTPサーバー
├── package.json              # 実行・テストスクリプト
├── public/
│   ├── index.html            # 画面構造と利用上の注意
│   ├── styles.css            # レスポンシブな表示
│   └── app.js                # DOM操作、UTF-8読込、画面上のエラー・CSV/HTML出力
├── src/
│   ├── detection.js          # 検証・解析・検出・CSV生成（副作用なし）
│   ├── evidence.js           # HTML証拠パッケージ生成（副作用なし）
│   └── semantic-evaluation.js # 将来の有料AIを接続しない評価・原価計算ユーティリティ
├── evaluation/               # 架空の意味的類似評価セット
├── test/                     # 検出・証拠・評価・契約の単体テスト
├── e2e/                      # PlaywrightによるブラウザE2E
├── benchmarks/               # 1,000件・5,000件の性能回帰シナリオ
└── examples/                 # 架空の投稿データ
```

`public/app.js`は、`src/detection.js`と`src/evidence.js`が公開する副作用のない関数だけを呼び出す。`detection.js`と`evidence.js`はDOM・ネットワーク・ストレージAPIに依存しないため、同じロジックをCLIや将来のサーバー版から再利用できる。`semantic-evaluation.js`は評価・原価の純粋関数だけを持ち、現行ブラウザUI・`detection.js`・外部AI APIを接続しない。

## 3. 検出アルゴリズム

### 3.1 完全一致

正規化後テキストをキーとするMapで投稿をグループ化する。グループに異なるアカウントが2つ以上あるとき、完全一致クラスタを生成する。処理量は投稿数を`n`として概ね`O(n)`である。

### 3.2 近似一致

完全一致クラスタに属さない投稿の組合せを対象に、単語トークン集合のJaccard類似度を算出する。接頭辞フィルタによる候補索引とトークン数比の上界で不要な比較を除外し、閾値以上の投稿ペアをUnion-Findで連結して同一連結成分を近似一致クラスタにする。最大5,000件の上限と性能基準は`performance_and_responsiveness.md`を正とする。

### 3.3 判定の説明可能性

各クラスタに判定種別、最大類似度、正規化の設定を表示する。AI推論や非決定的な判定を使わないため、同じ入力・設定は同じ結果を返す。近似一致は候補抽出であり、通報対象の適否を確定するものではない。

## 4. 将来拡張インターフェース

将来、SNSごとに取得手段を差し替える場合は、以下の概念インターフェースを採用する。

```js
/**
 * @typedef {Object} PostProvider
 * @property {string} name
 * @property {(query: ProviderQuery) => Promise<Post[]>} searchPosts
 * @property {(id: string) => Promise<Post>} getPost
 */
```

各プロバイダーは、取得条件、レート制限、保持期間、利用規約への準拠を実装側で保証する。ローカルファイル入力は`FilePostProvider`に相当し、本MVPではUIからのみ利用する。

有料の意味的類似判定は、`SemanticSimilarityProvider`として別リポジトリまたはクローズドパッケージで提供する。OSSの`detection.js`へAPIキー、LLM SDK、OrcaRouter固有コードを混在させない。

## 5. セキュリティ設計

静的サーバーは`GET`と`HEAD`のみを受け付け、`POST`・`PUT`等の書込み要求を拒否する。公開対象は画面資産を置く`public/`と、画面が明示的に読み込むモジュールだけを置く`src/`に限定し、各ルート外のパスを返さないことでパストラバーサルを禁止する。UIはUTF-8として読めない入力を拒否し、入力を`textContent`で表示して投稿本文をHTMLとして解釈しない。出力CSVはRFC 4180形式で二重引用符をエスケープし、HTML証拠パッケージは入力値をエスケープして外部リソースを許可しないCSPを付与する。
