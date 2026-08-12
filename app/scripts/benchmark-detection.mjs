import { performance } from 'node:perf_hooks';

import { findDuplicateClusters } from '../src/detection.js';

const SIZES = [1000, 5000];
const defaultIterations = 1;

function parseIterations(value) {
  if (value === undefined) return defaultIterations;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 20) {
    throw new RangeError('BENCHMARK_ITERATIONS は1から20までの整数にしてください。');
  }
  return parsed;
}

function createPost(index, text) {
  const account = `account${String(index % 250).padStart(3, '0')}`;
  return {
    id: `post-${String(index).padStart(5, '0')}`,
    account,
    url: `https://x.com/${account}/status/${index}`,
    postedAt: new Date(Date.UTC(2026, 0, 1, 0, 0, index)).toISOString(),
    text,
  };
}

function createExactPosts(size) {
  return Array.from({ length: size }, (_, index) => {
    const group = Math.floor(index / 2);
    return createPost(index, `重複検出の性能計測用テキスト ${group}`);
  });
}

function createApproximatePosts(size) {
  return Array.from({ length: size }, (_, index) => createPost(index, `benchmarktoken${index} uniqueword${index}`));
}

function measure(name, posts, options, iterations) {
  // ウォームアップにより初回JITコンパイルの影響を本計測から分離する。
  findDuplicateClusters(posts, options);

  const measurements = [];
  let clusterCount = 0;
  for (let index = 0; index < iterations; index += 1) {
    const startedAt = performance.now();
    clusterCount = findDuplicateClusters(posts, options).length;
    measurements.push(performance.now() - startedAt);
  }

  const totalMs = measurements.reduce((total, value) => total + value, 0);
  const averageMs = totalMs / measurements.length;
  return {
    scenario: name,
    postCount: posts.length,
    iterations,
    clusterCount,
    minMs: Number(Math.min(...measurements).toFixed(2)),
    maxMs: Number(Math.max(...measurements).toFixed(2)),
    averageMs: Number(averageMs.toFixed(2)),
    postsPerSecond: Number(((posts.length / averageMs) * 1000).toFixed(2)),
  };
}

const iterations = parseIterations(process.env.BENCHMARK_ITERATIONS);
const results = [];
for (const size of SIZES) {
  results.push(measure('exact', createExactPosts(size), { approximate: false }, iterations));
  results.push(measure('approximate', createApproximatePosts(size), {
    approximate: true,
    threshold: 0.8,
    ignoreUrls: true,
    ignoreMentions: true,
  }, iterations));
}

const report = {
  generatedAt: new Date().toISOString(),
  node: process.version,
  platform: process.platform,
  arch: process.arch,
  iterations,
  results,
};

if (process.argv.includes('--json')) {
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
} else {
  console.table(results);
}
