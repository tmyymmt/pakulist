import { test, expect } from '@playwright/test';

function post(overrides = {}) {
  return {
    id: 'post-1',
    account: 'alpha',
    url: 'https://x.com/alpha/status/1',
    postedAt: '2026-08-12T00:00:00Z',
    text: '新製品のお知らせです',
    ...overrides,
  };
}

function jsonFile(posts, name = 'posts.json') {
  return {
    name,
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify({ posts })),
  };
}

function csvFile(content, name = 'posts.csv') {
  return {
    name,
    mimeType: 'text/csv',
    buffer: Buffer.from(content),
  };
}

async function loadFile(page, file) {
  await page.locator('#post-file').setInputFiles(file);
}

async function analyze(page) {
  await expect(page.locator('#analyze-button')).toBeEnabled();
  await page.locator('#analyze-button').click();
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
});

test('JSONを読み込み、完全一致を表示してCSVを保存できる', async ({ page }) => {
  await loadFile(page, jsonFile([
    post({ id: 'a1', account: 'alpha', text: '共通の投稿 https://example.com/one' }),
    post({ id: 'b1', account: 'beta', url: 'https://x.com/beta/status/1', text: '共通の投稿 https://example.com/two' }),
    post({ id: 'c1', account: 'gamma', url: 'https://x.com/gamma/status/1', text: '別の投稿' }),
  ], 'valid-posts.json'));

  await expect(page.locator('#file-status')).toContainText('valid-posts.json（3件）を読み込みました');
  await analyze(page);
  await expect(page.locator('#results-summary')).toContainText('1件の検出クラスタ');
  await expect(page.locator('.cluster-card')).toHaveCount(1);
  await expect(page.locator('.match-badge.exact')).toHaveText('完全一致');

  const downloadPromise = page.waitForEvent('download');
  await page.locator('#download-button').click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('pakulist-results.csv');
});

test('CSVを読み込み、近似一致の設定変更を反映する', async ({ page }) => {
  await loadFile(page, csvFile([
    'id,account,url,postedAt,text',
    'a1,alpha,https://x.com/alpha/status/1,2026-08-12T00:00:00Z,市場 ニュース 速報',
    'b1,beta,https://x.com/beta/status/1,2026-08-12T00:01:00Z,市場 ニュース 更新',
  ].join('\n'), 'approximate.csv'));

  await page.locator('#threshold').fill('0.65');
  await analyze(page);
  await expect(page.locator('.match-badge.approximate')).toHaveText('近似一致');

  await page.locator('#approximate').uncheck();
  await expect(page.locator('#threshold')).toBeDisabled();
  await expect(page.locator('#results-summary')).toContainText('設定が変わりました');
  await expect(page.locator('#download-button')).toBeDisabled();
});

test('URL・メンションの除外設定によって結果を再計算できる', async ({ page }) => {
  await loadFile(page, jsonFile([
    post({ id: 'a1', text: '告知 @alpha https://example.com/one' }),
    post({ id: 'b1', account: 'beta', url: 'https://x.com/beta/status/1', text: '告知 @beta https://example.com/two' }),
  ]));

  await analyze(page);
  await expect(page.locator('.cluster-card')).toHaveCount(1);

  await page.locator('#ignore-urls').uncheck();
  await page.locator('#ignore-mentions').uncheck();
  await analyze(page);
  await expect(page.locator('.cluster-card')).toHaveCount(0);
  await expect(page.locator('#results-summary')).toContainText('検出クラスタは0件');
});

test('不正な形式と入力内容を行番号付きエラーで知らせる', async ({ page }) => {
  await loadFile(page, jsonFile([post()], 'posts.txt'));
  await expect(page.locator('#error-area')).toContainText('.csv または .json');

  await loadFile(page, {
    name: 'broken.json',
    mimeType: 'application/json',
    buffer: Buffer.from('{ invalid json }'),
  });
  await expect(page.locator('#error-area')).toContainText('JSONの形式が正しくありません');

  await loadFile(page, csvFile('id,account\na1,alpha', 'missing-columns.csv'));
  await expect(page.locator('#error-area')).toContainText('CSVヘッダには id, account, url, postedAt, text がすべて必要です');

  await loadFile(page, jsonFile([
    post({ id: 'duplicate' }),
    post({ id: 'duplicate', account: 'beta', url: 'https://x.com/beta/status/1' }),
    post({ id: 'invalid', account: 'gamma', url: 'http://x.com/gamma/status/1', postedAt: '2026-08-12', text: '' }),
  ]));
  await expect(page.locator('#error-area')).toContainText('入力行 2: id "duplicate" が重複しています');
  await expect(page.locator('#error-area')).toContainText('入力行 3: url は https://');
  await expect(page.locator('#error-area')).toContainText('入力行 3: postedAt はタイムゾーン付き');
  await expect(page.locator('#error-area')).toContainText('入力行 3: text は空白以外');
});

test('5,000件超過、結果なし、同一アカウントだけの重複を適切に扱う', async ({ page }) => {
  const tooManyPosts = Array.from({ length: 5001 }, (_, index) => post({
    id: `too-many-${index}`,
    account: `account-${index}`,
    url: `https://x.com/account-${index}/status/${index}`,
  }));
  await loadFile(page, jsonFile(tooManyPosts, 'too-many.json'));
  await expect(page.locator('#error-area')).toContainText('最大5,000件までです');

  await loadFile(page, jsonFile([
    post({ id: 'same-1', text: '同一アカウントの重複' }),
    post({ id: 'same-2', url: 'https://x.com/alpha/status/2', text: '同一アカウントの重複' }),
  ], 'same-account.json'));
  await analyze(page);
  await expect(page.locator('.cluster-card')).toHaveCount(0);
  await expect(page.locator('#results-area')).toContainText('異なるアカウント間で条件に一致する重複投稿は検出されませんでした');
});

test('投稿本文をHTMLとして実行せず、外部リンクは利用者のクリックでだけ開く', async ({ page, context }) => {
  const maliciousText = '<img src=x onerror="window.__xss = true">安全な本文';
  await loadFile(page, jsonFile([
    post({ id: 'a1', text: maliciousText }),
    post({ id: 'b1', account: 'beta', url: 'https://x.com/beta/status/1', text: maliciousText }),
  ], 'safe-text.json'));
  await analyze(page);

  await expect(page.locator('.post-text').first()).toHaveText(maliciousText);
  await expect(page.locator('#results-area img')).toHaveCount(0);
  await expect(page.locator('body')).not.toHaveAttribute('data-xss');

  const postLink = page.getByRole('link', { name: '投稿を別タブで開く' }).first();
  await expect(postLink).toHaveAttribute('target', '_blank');
  await expect(postLink).toHaveAttribute('rel', 'noopener noreferrer');
  const openedPage = context.waitForEvent('page');
  await postLink.click();
  await openedPage;
});
