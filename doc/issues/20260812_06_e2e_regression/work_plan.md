# Issue #10: ブラウザE2E回帰検証

## 対象範囲

ローカル Web MVP のファイル読込、判定設定、検出結果、CSV 出力、入力エラー、外部リンク、投稿本文の安全な表示を Playwright でブラウザレベル検証する。外部 API、SNS への投稿、通報操作、利用者データの保存は対象外とする。

## 追加内容

| ファイル | 目的 |
|---|---|
| `app/playwright.config.js` | ローカルサーバーを起動し、Chromium で E2E テストを実行する設定 |
| `app/e2e/app.spec.js` | 主要な正常系・異常系・安全性に関する6シナリオ |
| `app/package.json` | `npm run test:e2e` と構文検査対象を追加 |
| `.github/workflows/test.yml` | Node.js 22 で構文検査、ユニットテスト、Chromium E2E を実行 |

## ローカル実行

```bash
cd app
npm install
npx playwright install chromium
npm run check
npm test
npm run test:e2e
```

## 自動化する確認

1. JSON/CSV の読込、完全一致・近似一致の表示、CSV 保存。
2. 近似一致、URL・メンション除外の設定変更と再計算。
3. 不正拡張子・JSON・CSV、URL、日時、重複 ID、5,000 件超過のエラー。
4. 結果なしと、同一アカウントだけの重複の除外。
5. 投稿本文が HTML として実行されないこと、および外部リンクが利用者のクリック時にだけ別タブで開くこと。

## 検証結果

2026-08-12 にローカルで `npm run check`、`npm test`（10件成功）、`npm run test:e2e`（6件成功）を実行した。
