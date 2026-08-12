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

test('X API v2 Search JSONを標準Post形式に変換できる', () => {
  const posts = parseInput(JSON.stringify({
    data: [
      {
        id: '1001',
        author_id: 'user-a',
        created_at: '2026-08-12T00:00:00Z',
        text: '同じ投稿です',
      },
      {
        id: '1002',
        author_id: 'user-b',
        created_at: '2026-08-12T00:01:00Z',
        text: '同じ投稿です',
      },
    ],
    includes: {
      users: [
        { id: 'user-a', username: 'alpha' },
        { id: 'user-b', username: '@beta' },
      ],
    },
  }), 'x-api-search.json');

  assert.deepEqual(posts, [
    {
      id: '1001',
      account: 'alpha',
      url: 'https://x.com/alpha/status/1001',
      postedAt: '2026-08-12T00:00:00Z',
      text: '同じ投稿です',
    },
    {
      id: '1002',
      account: 'beta',
      url: 'https://x.com/beta/status/1002',
      postedAt: '2026-08-12T00:01:00Z',
      text: '同じ投稿です',
    },
  ]);
});

test('X API v2 Search JSONでauthor_idに対応するusernameがない場合はエラーにする', () => {
  assert.throws(
    () => parseInput(JSON.stringify({
      data: [{
        id: '1001',
        author_id: 'unknown-user',
        created_at: '2026-08-12T00:00:00Z',
        text: '投稿本文',
      }],
      includes: { users: [] },
    }), 'x-api-search.json'),
    (error) => error instanceof InputValidationError
      && error.errors.some((message) => message.includes('unknown-user')),
  );
});

test('X API v2 Search JSONでincludes.usersがない場合はエラーにする', () => {
  assert.throws(
    () => parseInput(JSON.stringify({
      data: [{
        id: '1001',
        author_id: 'user-a',
        created_at: '2026-08-12T00:00:00Z',
        text: '投稿本文',
      }],
    }), 'x-api-search.json'),
    (error) => error instanceof InputValidationError
      && error.errors.some((message) => message.includes('includes.users')),
  );
});

test('X API v2 Search JSONでも5,000件を超える投稿は拒否する', () => {
  const data = Array.from({ length: 5001 }, (_, index) => ({
    id: String(index + 1),
    author_id: 'user-a',
    created_at: '2026-08-12T00:00:00Z',
    text: `投稿 ${index + 1}`,
  }));

  assert.throws(
    () => parseInput(JSON.stringify({
      data,
      includes: { users: [{ id: 'user-a', username: 'alpha' }] },
    }), 'x-api-search.json'),
    (error) => error instanceof InputValidationError
      && error.errors.some((message) => message.includes('最大5,000件')),
  );
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

test('接頭辞フィルタでも閾値以上の近似一致を検出する', () => {
  const sharedTerms = Array.from({ length: 10 }, (_, index) => `topic${index}`).join(' ');
  const clusters = findDuplicateClusters([
    post({ id: 'a1', account: 'alpha', text: `${sharedTerms} alpha_only` }),
    post({ id: 'b1', account: 'beta', url: 'https://x.com/beta/status/1', text: `${sharedTerms} beta_only` }),
  ], { threshold: 0.8 });

  assert.equal(clusters.length, 1);
  assert.equal(clusters[0].matchType, 'approximate');
  assert.equal(clusters[0].similarity, 0.83);
});

test('閾値未満の投稿は近似一致に含めない', () => {
  const clusters = findDuplicateClusters([
    post({ id: 'a1', account: 'alpha', text: '市場 ニュース 速報' }),
    post({ id: 'b1', account: 'beta', url: 'https://x.com/beta/status/1', text: '市場 ニュース 更新' }),
  ], { threshold: 0.7 });
  assert.equal(clusters.length, 0);
});

test('起点アカウントの最初の投稿より後の完全一致だけをコピー候補にする', () => {
  const clusters = findDuplicateClusters([
    post({ id: 'origin', account: 'alpha', postedAt: '2026-08-12T00:00:00Z', text: 'コピー候補の確認' }),
    post({ id: 'later', account: 'beta', url: 'https://x.com/beta/status/1', postedAt: '2026-08-12T01:30:00Z', text: 'コピー候補の確認' }),
    post({ id: 'earlier', account: 'gamma', url: 'https://x.com/gamma/status/1', postedAt: '2026-08-11T23:00:00Z', text: 'コピー候補の確認' }),
    post({ id: 'same-time', account: 'delta', url: 'https://x.com/delta/status/1', postedAt: '2026-08-12T00:00:00Z', text: 'コピー候補の確認' }),
  ], { approximate: false, originAccount: '@alpha' });

  assert.equal(clusters.length, 1);
  assert.equal(clusters[0].originAccount, 'alpha');
  assert.equal(clusters[0].originPostId, 'origin');
  assert.equal(clusters[0].copyCandidateCount, 1);
  assert.deepEqual(clusters[0].posts.map(({ id, copyRole, delaySeconds }) => ({ id, copyRole, delaySeconds })), [
    { id: 'origin', copyRole: 'origin', delaySeconds: 0 },
    { id: 'later', copyRole: 'candidate', delaySeconds: 5400 },
  ]);

  const csv = clustersToCsv(clusters);
  assert.match(csv, /"originAccount"/u);
  assert.match(csv, /"candidate"/u);
  assert.match(csv, /"5400"/u);
});

test('起点アカウント指定でも後発の近似一致候補を検出する', () => {
  const clusters = findDuplicateClusters([
    post({ id: 'origin', account: 'alpha', postedAt: '2026-08-12T00:00:00Z', text: '市場 ニュース 速報' }),
    post({ id: 'later', account: 'beta', url: 'https://x.com/beta/status/1', postedAt: '2026-08-12T00:10:00Z', text: '市場 ニュース 更新' }),
  ], { threshold: 0.65, originAccount: 'alpha' });

  assert.equal(clusters.length, 1);
  assert.equal(clusters[0].matchType, 'approximate');
  assert.equal(clusters[0].copyCandidateCount, 1);
  assert.equal(clusters[0].posts[1].copyRole, 'candidate');
});

test('起点アカウントがクラスタにない場合と不正な起点設定は候補を作らない', () => {
  const clusters = findDuplicateClusters([
    post({ id: 'a1', account: 'alpha', text: '同じ投稿' }),
    post({ id: 'b1', account: 'beta', url: 'https://x.com/beta/status/1', text: '同じ投稿' }),
  ], { originAccount: 'missing' });

  assert.equal(clusters.length, 0);
  assert.throws(
    () => findDuplicateClusters([post()], { originAccount: 1 }),
    /起点アカウント/u,
  );
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
