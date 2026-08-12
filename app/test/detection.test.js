import assert from 'node:assert/strict';
import test from 'node:test';

import {
  InputValidationError,
  clustersToCsv,
  copyCandidatesToCsv,
  findDuplicateClusters,
  findLaterCopyCandidates,
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

test('起点投稿から後発の異なるアカウント投稿だけをコピー候補として抽出する', () => {
  const candidates = findLaterCopyCandidates([
    post({ id: 'origin', account: 'alpha', postedAt: '2026-08-12T00:00:00Z', text: '市場 ニュース 速報' }),
    post({ id: 'earlier', account: 'beta', url: 'https://x.com/beta/status/1', postedAt: '2026-08-11T23:59:59Z', text: '市場 ニュース 速報' }),
    post({ id: 'same-time', account: 'gamma', url: 'https://x.com/gamma/status/1', postedAt: '2026-08-12T00:00:00Z', text: '市場 ニュース 速報' }),
    post({ id: 'same-account', account: 'alpha', url: 'https://x.com/alpha/status/2', postedAt: '2026-08-12T00:01:00Z', text: '市場 ニュース 速報' }),
    post({ id: 'exact-later', account: 'beta', url: 'https://x.com/beta/status/2', postedAt: '2026-08-12T00:01:00Z', text: '市場 ニュース 速報' }),
    post({ id: 'approximate-later', account: 'gamma', url: 'https://x.com/gamma/status/2', postedAt: '2026-08-12T00:02:00Z', text: '市場 ニュース 更新' }),
  ], { originPostId: 'origin' }, { threshold: 0.65 });

  assert.deepEqual(candidates.map((item) => ({
    id: item.candidate.id,
    matchType: item.matchType,
    seconds: Math.round(item.timeDifferenceMs / 1000),
  })), [
    { id: 'exact-later', matchType: 'exact', seconds: 60 },
    { id: 'approximate-later', matchType: 'approximate', seconds: 120 },
  ]);
});

test('起点アカウント指定を正規化し、起点指定エラーを知らせる', () => {
  const posts = [
    post({ id: 'origin', account: 'alpha', text: '同一の投稿' }),
    post({ id: 'later', account: 'beta', url: 'https://x.com/beta/status/1', postedAt: '2026-08-12T00:01:00Z', text: '同一の投稿' }),
  ];
  const candidates = findLaterCopyCandidates(posts, { originAccount: '@alpha' });
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].candidate.id, 'later');

  assert.throws(
    () => findLaterCopyCandidates(posts, {}),
    (error) => error instanceof TypeError && error.message.includes('どちらか一方'),
  );
  assert.throws(
    () => findLaterCopyCandidates(posts, { originPostId: 'origin', originAccount: 'alpha' }),
    (error) => error instanceof TypeError && error.message.includes('どちらか一方'),
  );
  assert.throws(
    () => findLaterCopyCandidates(posts, { originPostId: 'missing' }),
    (error) => error instanceof InputValidationError && error.errors.some((message) => message.includes('見つかりません')),
  );
});

test('コピー候補CSVは起点、後発候補、時刻差を出力し、数式形式を無害化する', () => {
  const candidates = findLaterCopyCandidates([
    post({ id: 'origin', account: 'alpha', text: '同一の投稿' }),
    post({ id: 'later', account: '=beta', url: 'https://x.com/beta/status/1', postedAt: '2026-08-12T00:01:00Z', text: '同一の投稿' }),
  ], { originPostId: 'origin' });
  const csv = copyCandidatesToCsv(candidates);
  assert.match(csv, /"originId","originAccount","originUrl"/u);
  assert.match(csv, /"60","exact","1\.00"/u);
  assert.match(csv, /"'=beta"/u);
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
