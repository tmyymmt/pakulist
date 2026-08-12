import assert from 'node:assert/strict';
import test from 'node:test';

import {
  InputValidationError,
  clustersToCsv,
  findDuplicateClusters,
  jaccardSimilarity,
  normalizeText,
  parseInput,
  validatePosts,
} from '../src/detection.js';

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

test('JSON入力を検証し、アカウント先頭の@を除去する', () => {
  const posts = parseInput(JSON.stringify({ posts: [post({ account: '@alpha' })] }), 'posts.json');
  assert.equal(posts.length, 1);
  assert.equal(posts[0].account, 'alpha');
});

test('引用符・改行を含むCSVを解析できる', () => {
  const csv = [
    'id,account,url,postedAt,text',
    'post-1,alpha,https://x.com/alpha/status/1,2026-08-12T00:00:00Z,"一行目',
    '二行目"',
  ].join('\n');
  const posts = parseInput(csv, 'posts.csv');
  assert.equal(posts[0].text, '一行目\n二行目');
});

test('必須項目の欠落とhttps以外のURLをエラーにする', () => {
  assert.throws(
    () => validatePosts([
      post({ url: 'http://x.com/alpha/status/1' }),
      post({ id: 'post-1', account: 'beta', url: 'https://x.com/beta/status/1', text: '' }),
    ]),
    (error) => error instanceof InputValidationError
      && error.errors.some((message) => message.includes('https://'))
      && error.errors.some((message) => message.includes('text')),
  );
});

test('重複した投稿IDをエラーにする', () => {
  assert.throws(
    () => validatePosts([
      post({ id: 'same-id', account: 'alpha' }),
      post({ id: 'same-id', account: 'beta', url: 'https://x.com/beta/status/1' }),
    ]),
    (error) => error instanceof InputValidationError
      && error.errors.some((message) => message.includes('重複')),
  );
});

test('正規化では表記ゆれ、URL、メンション、連続空白を統一する', () => {
  const normalized = normalizeText(' ＡＢＣ　@Alpha\nhttps://example.com/test  ', {
    ignoreUrls: true,
    ignoreMentions: true,
  });
  assert.equal(normalized, 'abc');
});

test('異なるアカウントの完全一致をクラスタ化する', () => {
  const clusters = findDuplicateClusters([
    post({ id: 'a1', account: 'alpha', text: '新製品のお知らせです https://example.com/a' }),
    post({ id: 'b1', account: 'beta', url: 'https://x.com/beta/status/1', text: '新製品のお知らせです https://example.com/b' }),
    post({ id: 'c1', account: 'gamma', url: 'https://x.com/gamma/status/1', text: '別の投稿です' }),
  ]);
  assert.equal(clusters.length, 1);
  assert.equal(clusters[0].matchType, 'exact');
  assert.equal(clusters[0].similarity, 1);
  assert.equal(clusters[0].accountCount, 2);
});

test('同一アカウント内だけの重複は結果から除外する', () => {
  const clusters = findDuplicateClusters([
    post({ id: 'a1', account: 'alpha' }),
    post({ id: 'a2', account: 'alpha', url: 'https://x.com/alpha/status/2' }),
  ]);
  assert.equal(clusters.length, 0);
});

test('閾値以上の異なるアカウント投稿を近似一致としてクラスタ化する', () => {
  const similarity = jaccardSimilarity('市場 ニュース 速報', '市場 ニュース 更新');
  assert.equal(similarity, 2 / 3);

  const clusters = findDuplicateClusters([
    post({ id: 'a1', account: 'alpha', text: '市場 ニュース 速報' }),
    post({ id: 'b1', account: 'beta', url: 'https://x.com/beta/status/1', text: '市場 ニュース 更新' }),
  ], { threshold: 0.65 });
  assert.equal(clusters.length, 1);
  assert.equal(clusters[0].matchType, 'approximate');
  assert.equal(clusters[0].similarity, 0.67);
});

test('閾値未満の投稿は近似一致に含めない', () => {
  const clusters = findDuplicateClusters([
    post({ id: 'a1', account: 'alpha', text: '市場 ニュース 速報' }),
    post({ id: 'b1', account: 'beta', url: 'https://x.com/beta/status/1', text: '市場 ニュース 更新' }),
  ], { threshold: 0.7 });
  assert.equal(clusters.length, 0);
});

test('出力CSVは引用符をエスケープし、数式形式の値を無害化する', () => {
  const clusters = findDuplicateClusters([
    post({ id: 'a1', account: '=alpha', text: '"重要",お知らせ' }),
    post({ id: 'b1', account: 'beta', url: 'https://x.com/beta/status/1', text: '"重要",お知らせ' }),
  ]);
  const csv = clustersToCsv(clusters);
  assert.match(csv, /"'=alpha"/u);
  assert.match(csv, /"""重要"",お知らせ"/u);
});
