import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { expect, test } from '@playwright/test';

const directory = path.dirname(fileURLToPath(import.meta.url));
const fixturePath = (name) => path.join(directory, 'fixtures', name);

async function uploadJson(page, payload, name = 'posts.json') {
  await page.locator('#post-file').setInputFiles({
    name,
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(payload)),
  });
}

function standardPost(overrides = {}) {
  return {
    id: 'post-1',
    account: 'alpha',
    url: 'https://x.com/alpha/status/1',
    postedAt: '2026-08-12T00:00:00Z',
    text: 'E2E確認用の投稿',
    ...overrides,
  };
}

test('JSONを読み込み、候補を安全に表示し、CSVを保存できる', async ({ page, context }) => {
  const dialogs = [];
  page.on('dialog', (dialog) => {
    dialogs.push(dialog.message());
    dialog.dismiss();
  });

  await page.goto('/');
  await page.locator('#post-file').setInputFiles(fixturePath('valid-posts.json'));
  await expect(page.locator('#file-status')).toContainText('valid-posts.json（2件）を読み込みました');

  await page.locator('#analyze-button').click();
  await expect(page.locator('#results-summary')).toContainText('1件の検出クラスタ');
  await expect(page.locator('.cluster-card')).toHaveCount(1);
  await expect(page.locator('.post-text').first()).toContainText('<img src=x onerror=alert(1)>');
  await expect(page.locator('.post-text img')).toHaveCount(0);
  expect(dialogs).toEqual([]);

  const postLink = page.locator('.post-links a').first();
  await expect(postLink).toHaveAttribute('target', '_blank');
  await expect(postLink).toHaveAttribute('rel', /noopener/);
  await expect(postLink).toHaveAttribute('href', 'https://x.com/alpha/status/1');
  expect(context.pages()).toHaveLength(1);

  const downloadPromise = page.waitForEvent('download');
  await page.locator('#download-button').click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('pakulist-results.csv');
  const stream = await download.createReadStream();
  let csv = '';
  for await (const chunk of stream) csv += chunk;
  expect(csv).toContain('clusterId');
  expect(csv).toContain('https://x.com/alpha/status/1');

  const evidenceDownloadPromise = page.waitForEvent('download');
  await page.locator('#evidence-download-button').click();
  const evidenceDownload = await evidenceDownloadPromise;
  expect(evidenceDownload.suggestedFilename()).toBe('pakulist-evidence-report.html');
  const evidenceStream = await evidenceDownload.createReadStream();
  let report = '';
  for await (const chunk of evidenceStream) report += chunk;
  expect(report).toContain('手動確認用証拠レポート');
  expect(report).toContain('自動通報は行いません');
  expect(report).toContain('&lt;img src=x onerror=alert(1)&gt;');
  expect(report).not.toContain('<img src=x onerror=alert(1)>');
});

test('CSVを読み込み、URL・メンション無視の設定変更を反映する', async ({ page }) => {
  const csv = [
    'id,account,url,postedAt,text',
    'csv-1,alpha,https://x.com/alpha/status/1,2026-08-12T00:00:00Z,"@alpha 同じ本文 https://example.com/a"',
    'csv-2,beta,https://x.com/beta/status/2,2026-08-12T00:01:00Z,"@beta 同じ本文 https://example.com/b"',
  ].join('\n');

  await page.goto('/');
  await page.locator('#post-file').setInputFiles({
    name: 'posts.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(csv),
  });
  await page.locator('#approximate').uncheck();
  await page.locator('#analyze-button').click();
  await expect(page.locator('#results-summary')).toContainText('1件の検出クラスタ');

  await page.locator('#ignore-urls').uncheck();
  await page.locator('#ignore-mentions').uncheck();
  await page.locator('#analyze-button').click();
  await expect(page.locator('#results-summary')).toContainText('検出クラスタは0件');
});

test('起点投稿を指定して後発コピー候補と時刻差を表示・CSV出力できる', async ({ page }) => {
  await page.goto('/');
  await uploadJson(page, {
    posts: [
      standardPost({ id: 'origin', account: 'alpha', postedAt: '2026-08-12T00:00:00Z', text: '市場 ニュース 速報' }),
      standardPost({ id: 'earlier', account: 'beta', url: 'https://x.com/beta/status/1', postedAt: '2026-08-11T23:59:00Z', text: '市場 ニュース 速報' }),
      standardPost({ id: 'same-time', account: 'gamma', url: 'https://x.com/gamma/status/1', postedAt: '2026-08-12T00:00:00Z', text: '市場 ニュース 速報' }),
      standardPost({ id: 'same-account', account: 'alpha', url: 'https://x.com/alpha/status/2', postedAt: '2026-08-12T00:01:00Z', text: '市場 ニュース 速報' }),
      standardPost({ id: 'later', account: 'beta', url: 'https://x.com/beta/status/2', postedAt: '2026-08-12T00:02:00Z', text: '市場 ニュース 速報' }),
    ],
  });

  await page.locator('#origin-post-id').fill('origin');
  await page.locator('#analyze-button').click();
  await expect(page.locator('#results-summary')).toContainText('後発コピー候補 1件');
  await expect(page.locator('.copy-candidate-card')).toHaveCount(1);
  await expect(page.locator('.copy-candidate-card')).toContainText('起点からの時刻差');
  await expect(page.locator('.copy-candidate-card')).toContainText('2分0秒');
  await expect(page.locator('.copy-candidate-card')).toContainText('権利侵害等の法的結論ではありません');

  const downloadPromise = page.waitForEvent('download');
  await page.locator('#download-button').click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('pakulist-copy-candidates.csv');
  const stream = await download.createReadStream();
  let csv = '';
  for await (const chunk of stream) csv += chunk;
  expect(csv).toContain('originId');
  expect(csv).toContain('timeDifferenceSeconds');
  expect(csv).toContain('"120"');
});

test('同一アカウントだけの重複は候補にしない', async ({ page }) => {
  await page.goto('/');
  await uploadJson(page, {
    posts: [
      standardPost({ id: 'same-1', account: 'alpha' }),
      standardPost({ id: 'same-2', account: 'alpha', url: 'https://x.com/alpha/status/2' }),
    ],
  });
  await page.locator('#analyze-button').click();
  await expect(page.locator('#results-summary')).toContainText('検出クラスタは0件');
});

test.describe('入力エラー', () => {
  test('不正な拡張子と壊れたJSONを理由付きで拒否する', async ({ page }) => {
    await page.goto('/');
    await page.locator('#post-file').setInputFiles({
      name: 'posts.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('invalid'),
    });
    await expect(page.locator('#error-area')).toContainText('.csv または .json');

    await page.locator('#post-file').setInputFiles({
      name: 'posts.json',
      mimeType: 'application/json',
      buffer: Buffer.from('{invalid'),
    });
    await expect(page.locator('#error-area')).toContainText('JSONの形式が正しくありません');
  });

  test('CSVヘッダ、URL・日時、重複ID、5,000件超過を拒否する', async ({ page }) => {
    await page.goto('/');
    await page.locator('#post-file').setInputFiles({
      name: 'broken.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from('id,account\n1,alpha'),
    });
    await expect(page.locator('#error-area')).toContainText('CSVヘッダ');

    await uploadJson(page, {
      posts: [standardPost({ url: 'http://example.com', postedAt: '2026-08-12' })],
    });
    await expect(page.locator('#error-area')).toContainText('url は https://');
    await expect(page.locator('#error-area')).toContainText('postedAt はタイムゾーン付き');

    await uploadJson(page, {
      posts: [
        standardPost({ id: 'duplicate' }),
        standardPost({ id: 'duplicate', account: 'beta', url: 'https://x.com/beta/status/1' }),
      ],
    });
    await expect(page.locator('#error-area')).toContainText('id "duplicate" が重複しています');

    await uploadJson(page, {
      posts: Array.from({ length: 5001 }, (_, index) => standardPost({
        id: `limit-${index}`,
        account: `account${index}`,
        url: `https://x.com/account${index}/status/${index}`,
      })),
    });
    await expect(page.locator('#error-area')).toContainText('最大5,000件');
  });
});
