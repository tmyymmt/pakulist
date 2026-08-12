import { performance } from 'node:perf_hooks';

import { findDuplicateClusters } from '../src/detection.js';

const SIZES = [1000, 5000];
const LIMITS_MS = Object.freeze({
  '完全一致:1000': 1000,
  '完全一致:5000': 2500,
  '近似一致:1000': 1500,
  '近似一致:5000': 5000,
});

function createPost(index, text) {
  const account = `account_${index % 200}`;
  return {
    id: `benchmark-${index + 1}`,
    account,
    url: `https://x.com/${account}/status/${index + 1}`,
    postedAt: new Date(Date.UTC(2026, 0, 1, 0, 0, index % 60)).toISOString(),
    text,
  };
}

function createExactPosts(size) {
  return Array.from({ length: size }, (_, index) => {
    const group = Math.floor(index / 10);
    return createPost(index, `完全一致ベンチマーク グループ ${group}`);
  });
}

function createApproximatePosts(size) {
  return Array.from({ length: size }, (_, index) => {
    const group = Math.floor(index / 50);
    const sharedTerms = Array.from({ length: 10 }, (_, termIndex) => `topic${group}_${termIndex}`).join(' ');
    return createPost(index, `${sharedTerms} unique_${index}`);
  });
}

function measure(label, size, posts, options) {
  const startedAt = performance.now();
  const clusters = findDuplicateClusters(posts, options);
  const elapsedMs = performance.now() - startedAt;
  return {
    key: `${label}:${size}`,
    scenario: label,
    posts: size,
    clusters: clusters.length,
    elapsedMs: Number(elapsedMs.toFixed(1)),
    limitMs: LIMITS_MS[`${label}:${size}`],
  };
}

function run() {
  const results = [];
  for (const size of SIZES) {
    results.push(measure('完全一致', size, createExactPosts(size), { approximate: true, threshold: 0.8 }));
    results.push(measure('近似一致', size, createApproximatePosts(size), { approximate: true, threshold: 0.8 }));
  }

  console.table(results.map(({ key, ...result }) => result));

  if (process.argv.includes('--assert')) {
    const failures = results.filter((result) => result.elapsedMs > result.limitMs);
    if (failures.length > 0) {
      const detail = failures.map((result) => `${result.key}: ${result.elapsedMs}ms > ${result.limitMs}ms`).join(', ');
      throw new Error(`性能基準を超過しました: ${detail}`);
    }
  }
}

run();
