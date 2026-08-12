# X API Search入力アダプター詳細設計

## 1. 目的

`parseXApiSearchResponse`は、X API v2 Searchの**保存済みJSON**をpakulistの標準`Post`形式へ変換する純粋関数である。X APIへの通信、認証、資格情報、保存、同期、削除要求の処理は行わない。

X API v2ではPostの`id`・`text`が既定フィールドであり、`created_at`・`author_id`はPost fieldとして取得できる。`author_id`は`expansions=author_id`と`user.fields=username`により返る`includes.users`と結合する。[1] Recent Searchのレスポンスは`data`および任意の`includes`を含む。[2]

## 2. 入力契約

```json
{
  "data": [
    {
      "id": "123",
      "author_id": "456",
      "created_at": "2026-08-12T00:00:00Z",
      "text": "投稿本文"
    }
  ],
  "includes": {
    "users": [
      {
        "id": "456",
        "username": "example_account"
      }
    ]
  }
}
```

| 入力パス | 必須 | 用途 |
| --- | --- | --- |
| `data` | はい | X API Postオブジェクトの配列。 |
| `data[].id` | はい | 標準`Post.id`を生成する。 |
| `data[].author_id` | はい | `includes.users[].id`と結合してアカウントを特定する。 |
| `data[].created_at` | はい | 標準`Post.postedAt`を生成する。既存のISO 8601検証を適用する。 |
| `data[].text` | はい | 標準`Post.text`を生成する。 |
| `includes.users` | はい | 投稿者IDとユーザー名の結合表。 |
| `includes.users[].id` | 対象投稿に対して必須 | `author_id`との結合キー。 |
| `includes.users[].username` | 対象投稿に対して必須 | 標準`Post.account`とURL生成に使う。 |

## 3. 変換規則

| 標準`Post` | 生成規則 |
| --- | --- |
| `id` | `data[].id`をトリムして使用する。 |
| `account` | `author_id`に一致する`includes.users[].username`をトリムし、先頭の`@`を除いて使用する。 |
| `url` | `https://x.com/{account}/status/{id}`を生成する。動的部分はURLエンコードする。 |
| `postedAt` | `data[].created_at`を使用し、既存のタイムゾーン付きISO 8601検証を適用する。 |
| `text` | `data[].text`をそのまま使用する。 |

変換後は既存の`validatePosts`を必ず実行するため、通常JSON/CSVと同じ必須項目、重複ID、5,000件上限、URL、日時の検証が適用される。

## 4. エラー処理

| 条件 | エラー方針 |
| --- | --- |
| JSONのルートがオブジェクトでない | X API JSONの形式エラーとして拒否する。 |
| `data`または`includes.users`が配列でない | 必須構造のエラーとして拒否する。 |
| Postがオブジェクトでない | `data[n]`を示して拒否する。 |
| `id`・`author_id`・`created_at`・`text`が欠損または空 | `data[n]`を示して拒否する。 |
| `author_id`に対応する`username`がない | 誤ったアカウント・URLを生成せず、`author_id`を示して拒否する。 |
| 変換後が5,000件超 | 既存の上限検証で拒否する。 |

## 5. セキュリティ・規約上の境界

このアダプターは、利用者がローカルに保存したJSONを端末内で変換するだけである。Bearer Token、OAuthトークン、APIキーを入力・保存・送信・ログ出力しない。アダプターが受け入れることは、データ取得経路の適法性・規約適合性を保証するものではない。

API由来データを実際に取得・利用・表示する機能は、`x_data_acquisition_policy.md`の許可ゲートと`external_data_governance.md`の保持・削除・再配布・資格情報・監査要件を満たした後に別途実装する。特にX API/X Contentを使って重複投稿候補を収集・分析・表示する前には、Developer Policy上必要な書面許可を確認する。[3]

## 6. 参照資料

[1]: https://docs.x.com/x-api/fundamentals/data-dictionary "X API v2 Data Dictionary"
[2]: https://docs.x.com/x-api/posts/search-recent-posts "X API: Search Posts Recent"
[3]: https://docs.x.com/developer-terms/policy "X Developer Policy"
