import assert from 'node:assert/strict';
import test from 'node:test';

import { createEvidencePackage } from '../src/evidence.js';

const origin = {
  id: 'origin-1',
  account: 'alpha',
  url: 'https://x.com/alpha/status/1',
  postedAt: '2026-08-12T00:00:00Z',
  text: '原投稿 <img src=x onerror=alert(1)>',
};

const candidate = {
  id: 'candidate-1',
  account: 'beta',
  url: 'https://x.com/beta/status/2',
  postedAt: '2026-08-12T00:02:00Z',
  text: '後発候補',
};

const options = {
  approximate: true,
  threshold: 0.8,
  ignoreUrls: true,
  ignoreMentions: true,
  analysisMode: 'copyCandidates',
  originPostId: 'origin-1',
};

test('時系列コピー候補を必要な注意事項・設定・投稿証拠とともにHTML出力する', () => {
  const html = createEvidencePackage({
    copyCandidates: [{
      origin,
      candidate,
      matchType: 'exact',
      similarity: 1,
      timeDifferenceMs: 120_000,
    }],
    options,
    generatedAt: new Date('2026-08-12T03:00:00Z'),
  });

  assert.match(html, /Content-Security-Policy/u);
  assert.match(html, /候補/u);
  assert.match(html, /確認して最終判断/u);
  assert.match(html, /スクリーンショットを取得・保存しません/u);
  assert.match(html, /起点からの時刻差/u);
  assert.match(html, /2分0秒/u);
  assert.match(html, /https:\/\/x\.com\/alpha\/status\/1/u);
  assert.match(html, /rel="noopener noreferrer"/u);
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/u);
  assert.doesNotMatch(html, /<img src=x/u);
});

test('クラスタ出力では各証拠投稿と判定設定を出力する', () => {
  const html = createEvidencePackage({
    clusters: [{
      id: 'C-001',
      matchType: 'exact',
      similarity: 1,
      accountCount: 2,
      postCount: 2,
      posts: [origin, candidate],
    }],
    options: { ...options, analysisMode: 'clusters', originPostId: '' },
    generatedAt: new Date('2026-08-12T03:00:00Z'),
  });

  assert.match(html, /C-001/u);
  assert.match(html, /証拠投稿 1/u);
  assert.match(html, /近似一致の閾値/u);
  assert.match(html, /0\.80/u);
});

test('候補データまたは判定設定が不正な場合はエラーにする', () => {
  assert.throws(
    () => createEvidencePackage({ clusters: {}, options }),
    /候補データは配列/u,
  );
  assert.throws(
    () => createEvidencePackage({ clusters: [], options: null }),
    /判定設定が必要/u,
  );
});
