# Issue #3 作業計画: 許可済みX APIデータを標準Post形式へ変換する

## 1. 目的

#2で決定した正規データ取得方針と#9のガバナンス要件を前提に、X API v2 Searchの保存済みレスポンスを、pakulistの既存標準`Post`形式へブラウザ内で変換し、重複検出に利用できるようにする。

## 2. 対象範囲

| 区分 | 内容 |
| --- | --- |
| 入力 | X API v2 Search形式のJSON。`data`、`includes.users`、Postの`id`・`text`・`created_at`・`author_id`、Userの`id`・`username`を利用する。 |
| 変換 | `id`、`account`、`url`、`postedAt`、`text`を生成し、既存の入力検証・5,000件上限・検出エンジンを再利用する。 |
| 実装 | ネットワーク通信をしない純粋な変換関数、`parseInput`の形式判定、単体テスト、入力ガイドを追加する。 |
| 非対象 | X API認証、トークン、課金、ネットワーク取得、保存、削除同期、ユーザー認証、スクリーンショット、自動通報。 |

## 3. 変換規則

| 標準Post | X API v2 Searchレスポンス | 変換規則 |
| --- | --- | --- |
| `id` | `data[].id` | 文字列として必須。 |
| `account` | `includes.users[]`の`id`と`data[].author_id`を結合した`username` | User情報が見つからない場合はエラーにする。 |
| `url` | `https://x.com/{username}/status/{id}` | `username`と`id`から生成する。 |
| `postedAt` | `data[].created_at` | タイムゾーンを含むISO 8601として必須。 |
| `text` | `data[].text` | 空白以外を含む文字列として必須。 |

## 4. 競合回避

担当は `tmyymmt`、作業ブランチは `issue/20260812_05_x-api-input-adapter` とする。変更範囲は入力解析・検証、単体テスト、入力ガイド、仕様、README、本Issueの作業記録に限定する。外部API実装、認証、データベース、他の検出アルゴリズム、UI全体の改修には触れない。

## 5. 受入条件

- [ ] 正常なX API v2 Search JSONを読み込むと、標準Post配列に変換して既存検出処理へ渡せる。
- [ ] `data`、`includes.users`、`author_id`、`username`、`id`、`text`、`created_at`の欠損を行番号または配列番号付きでエラーにする。
- [ ] X APIレスポンス由来の投稿が5,000件を超える場合に拒否する。
- [ ] 標準JSON/CSV入力の既存挙動を変えず、既存テストを維持する。
- [ ] X APIからのネットワーク取得、トークン・資格情報の受け取り・保存を行わない。
- [ ] #2と#9の許可・ガバナンス要件を利用案内と仕様に明記する。
