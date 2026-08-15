import { createEvidencePackage } from '/src/evidence.js';
import {
  DEFAULT_OPTIONS,
  InputValidationError,
  clustersToCsv,
  copyCandidatesToCsv,
  findDuplicateClusters,
  findLaterCopyCandidates,
  parseInput,
} from '/src/detection.js';
import { createSemanticCandidates, reconcileSemanticClusters } from '/src/semantic-cluster-reconciliation.js';

const REPORT_HELP_URL = 'https://help.x.com/ja/forms';
const PREVIEW_ACCESS_STORAGE_KEY = 'pakulist_preview_access';
const MAX_SEMANTIC_JUDGMENTS = 50;
const SEMANTIC_CONCURRENCY = 3;

const elements = {
  analyzeButton: document.querySelector('#analyze-button'),
  approximate: document.querySelector('#approximate'),
  downloadButton: document.querySelector('#download-button'),
  evidenceButton: document.querySelector('#evidence-button'),
  errorArea: document.querySelector('#error-area'),
  fileInput: document.querySelector('#post-file'),
  fileStatus: document.querySelector('#file-status'),
  ignoreMentions: document.querySelector('#ignore-mentions'),
  ignoreUrls: document.querySelector('#ignore-urls'),
  originAccount: document.querySelector('#origin-account'),
  originPostId: document.querySelector('#origin-post-id'),
  resultsArea: document.querySelector('#results-area'),
  resultsSummary: document.querySelector('#results-summary'),
  semantic: document.querySelector('#semantic'),
  semanticStatus: document.querySelector('#semantic-status'),
  threshold: document.querySelector('#threshold'),
  thresholdValue: document.querySelector('#threshold-value'),
};

let posts = null;
let clusters = [];
let copyCandidates = [];
let analysisMode = 'clusters';
let semanticSummary = null;

function initializePreviewAccessToken() {
  const url = new URL(window.location.href);
  const accessToken = url.searchParams.get('access');
  if (!accessToken) return;
  try {
    window.sessionStorage.setItem(PREVIEW_ACCESS_STORAGE_KEY, accessToken);
  } catch {
    return;
  }
  url.searchParams.delete('access');
  window.history.replaceState({}, document.title, `${url.pathname}${url.search}${url.hash}`);
}

function previewAccessHeaders() {
  try {
    const accessToken = window.sessionStorage.getItem(PREVIEW_ACCESS_STORAGE_KEY);
    return accessToken ? { 'X-Pakulist-Preview-Access': accessToken } : {};
  } catch {
    return {};
  }
}

function clearChildren(element) {
  while (element.firstChild) element.removeChild(element.firstChild);
}

function showError(errors) {
  clearChildren(elements.errorArea);
  const list = document.createElement('ul');
  errors.forEach((error) => {
    const item = document.createElement('li');
    item.textContent = error;
    list.append(item);
  });
  elements.errorArea.append(list);
  elements.errorArea.hidden = false;
}

function hideError() {
  clearChildren(elements.errorArea);
  elements.errorArea.hidden = true;
}

function setEmptyState(message) {
  clearChildren(elements.resultsArea);
  elements.resultsArea.className = 'empty-state';
  const paragraph = document.createElement('p');
  paragraph.textContent = message;
  elements.resultsArea.append(paragraph);
}

function currentOptions() {
  return {
    approximate: elements.approximate.checked,
    threshold: Number(elements.threshold.value),
    ignoreUrls: elements.ignoreUrls.checked,
    ignoreMentions: elements.ignoreMentions.checked,
  };
}

function currentOrigin() {
  const originPostId = elements.originPostId.value.trim();
  const originAccount = elements.originAccount.value.trim();
  return originPostId === '' && originAccount === '' ? null : { originPostId, originAccount };
}

function createExternalLink(url, label) {
  const link = document.createElement('a');
  link.href = url;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  link.textContent = label;
  return link;
}

function formatDate(value) {
  return new Intl.DateTimeFormat('ja-JP', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}

function matchLabel(matchType) {
  return matchType === 'exact' ? '完全一致' : '近似一致';
}

function formatTimeDifference(timeDifferenceMs) {
  const totalSeconds = Math.round(timeDifferenceMs / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const segments = [];
  if (days > 0) segments.push(`${days}日`);
  if (hours > 0 || days > 0) segments.push(`${hours}時間`);
  if (minutes > 0 || hours > 0 || days > 0) segments.push(`${minutes}分`);
  segments.push(`${seconds}秒`);
  return segments.join('');
}

function semanticStatusText(summary) {
  if (!summary) return '';
  if (summary.total === 0) return ' 意味的類似の確認対象はありませんでした。';
  const parts = [`意味的確認 ${summary.completed}/${summary.reviewed}件完了`];
  if (summary.matches > 0) parts.push(`match ${summary.matches}件`);
  if (summary.nonMatches > 0) parts.push(`non_match ${summary.nonMatches}件`);
  if (summary.abstained > 0) parts.push(`棄権 ${summary.abstained}件`);
  if (summary.unavailable > 0) parts.push(`利用不可 ${summary.unavailable}件`);
  if (summary.skipped > 0) parts.push(`上限により未確認 ${summary.skipped}件`);
  if (summary.addedBySemantic > 0) parts.push(`LLM追加 ${summary.addedBySemantic}件`);
  if (summary.excludedBySemantic > 0) parts.push(`LLM除外 ${summary.excludedBySemantic}件`);
  return ` ${parts.join('、')}。`;
}

function createSemanticAnnotation(cluster) {
  if (!cluster.semantic) return null;
  const annotation = document.createElement('p');
  annotation.className = 'semantic-annotation';
  const { completed, matches, nonMatches, abstained, unavailable, highestScore, resolvedModels } = cluster.semantic;
  const parts = [`意味的類似API: ${completed}件を確認`];
  if (matches > 0) parts.push(`match ${matches}件`);
  if (nonMatches > 0) parts.push(`non_match ${nonMatches}件`);
  if (abstained > 0) parts.push(`棄権 ${abstained}件`);
  if (unavailable > 0) parts.push(`利用不可 ${unavailable}件`);
  if (Number.isFinite(highestScore)) parts.push(`最高スコア ${highestScore.toFixed(2)}`);
  if (resolvedModels.length > 0) parts.push(`モデル ${resolvedModels.join(', ')}`);
  annotation.textContent = parts.join(' ／ ');
  return annotation;
}

function renderPost(post) {
  const item = document.createElement('article');
  item.className = 'evidence-post';

  const meta = document.createElement('div');
  meta.className = 'post-meta';
  const account = document.createElement('strong');
  account.textContent = `@${post.account}`;
  const date = document.createElement('time');
  date.dateTime = post.postedAt;
  date.textContent = formatDate(post.postedAt);
  meta.append(account, date);

  const text = document.createElement('p');
  text.className = 'post-text';
  text.textContent = post.text;

  const links = document.createElement('p');
  links.className = 'post-links';
  links.append(createExternalLink(post.url, '投稿を別タブで開く'));

  item.append(meta, text, links);
  return item;
}

function renderCluster(cluster) {
  const card = document.createElement('article');
  card.className = 'cluster-card';
  const header = document.createElement('div');
  header.className = 'cluster-header';

  const title = document.createElement('h3');
  title.textContent = cluster.id;
  const badge = document.createElement('span');
  badge.className = `match-badge ${cluster.matchType}`;
  badge.textContent = matchLabel(cluster.matchType);
  header.append(title, badge);

  const metrics = document.createElement('dl');
  metrics.className = 'metrics';
  const metricData = [
    ['最大類似度', cluster.similarity.toFixed(2)],
    ['アカウント', `${cluster.accountCount}件`],
    ['投稿', `${cluster.postCount}件`],
  ];
  metricData.forEach(([label, value]) => {
    const group = document.createElement('div');
    const term = document.createElement('dt');
    term.textContent = label;
    const description = document.createElement('dd');
    description.textContent = value;
    group.append(term, description);
    metrics.append(group);
  });

  const evidenceTitle = document.createElement('h4');
  evidenceTitle.textContent = '証拠投稿';
  const evidence = document.createElement('div');
  evidence.className = 'evidence-list';
  cluster.posts.forEach((post) => evidence.append(renderPost(post)));

  const caution = document.createElement('p');
  caution.className = 'cluster-caution';
  caution.append('通報の要否は利用者が確認・判断してください。 ', createExternalLink(REPORT_HELP_URL, 'Xの通報ヘルプを開く'));

  card.append(header, metrics);
  const semanticAnnotation = createSemanticAnnotation(cluster);
  if (semanticAnnotation) card.append(semanticAnnotation);
  card.append(evidenceTitle, evidence, caution);
  return card;
}

function renderCopyCandidate(item, index) {
  const card = document.createElement('article');
  card.className = 'cluster-card copy-candidate-card';
  const header = document.createElement('div');
  header.className = 'cluster-header';

  const title = document.createElement('h3');
  title.textContent = `後発候補 ${String(index + 1).padStart(3, '0')}`;
  const badge = document.createElement('span');
  badge.className = `match-badge ${item.matchType}`;
  badge.textContent = matchLabel(item.matchType);
  header.append(title, badge);

  const metrics = document.createElement('dl');
  metrics.className = 'metrics';
  [
    ['類似度', item.similarity.toFixed(2)],
    ['起点からの時刻差', formatTimeDifference(item.timeDifferenceMs)],
    ['候補アカウント', `@${item.candidate.account}`],
  ].forEach(([label, value]) => {
    const group = document.createElement('div');
    const term = document.createElement('dt');
    term.textContent = label;
    const description = document.createElement('dd');
    description.textContent = value;
    group.append(term, description);
    metrics.append(group);
  });

  const originTitle = document.createElement('h4');
  originTitle.textContent = '起点投稿';
  const originEvidence = document.createElement('div');
  originEvidence.className = 'evidence-list';
  originEvidence.append(renderPost(item.origin));

  const candidateTitle = document.createElement('h4');
  candidateTitle.textContent = '後発候補';
  const candidateEvidence = document.createElement('div');
  candidateEvidence.className = 'evidence-list';
  candidateEvidence.append(renderPost(item.candidate));

  const caution = document.createElement('p');
  caution.className = 'cluster-caution';
  caution.append('時刻順と本文の類似に基づく候補です。権利侵害等の法的結論ではありません。通報の要否は利用者が確認・判断してください。 ', createExternalLink(REPORT_HELP_URL, 'Xの通報ヘルプを開く'));

  card.append(header, metrics, originTitle, originEvidence, candidateTitle, candidateEvidence, caution);
  return card;
}

function renderCopyCandidates() {
  clearChildren(elements.resultsArea);
  if (copyCandidates.length === 0) {
    setEmptyState('指定した起点投稿・アカウントより後に投稿された一致候補は検出されませんでした。起点と設定を確認してください。');
    elements.resultsSummary.textContent = `${posts.length.toLocaleString('ja-JP')}件を解析し、後発コピー候補は0件でした。`;
    elements.downloadButton.disabled = true;
    elements.evidenceButton.disabled = true;
    return;
  }

  elements.resultsArea.className = 'cluster-list';
  copyCandidates.forEach((item, index) => elements.resultsArea.append(renderCopyCandidate(item, index)));
  const originCount = new Set(copyCandidates.map((item) => item.origin.id)).size;
  elements.resultsSummary.textContent = `${posts.length.toLocaleString('ja-JP')}件を解析し、${originCount.toLocaleString('ja-JP')}件の起点から後発コピー候補 ${copyCandidates.length.toLocaleString('ja-JP')}件を表示しています。`;
  elements.downloadButton.disabled = false;
  elements.evidenceButton.disabled = false;
}

function renderClusters() {
  clearChildren(elements.resultsArea);
  if (clusters.length === 0) {
    setEmptyState('異なるアカウント間で条件に一致する重複投稿は検出されませんでした。設定を確認するか、別の入力データをお試しください。');
    elements.resultsSummary.textContent = `${posts.length.toLocaleString('ja-JP')}件を解析し、検出クラスタは0件でした。${semanticStatusText(semanticSummary)}`;
    elements.downloadButton.disabled = true;
    elements.evidenceButton.disabled = true;
    return;
  }

  elements.resultsArea.className = 'cluster-list';
  clusters.forEach((cluster) => elements.resultsArea.append(renderCluster(cluster)));
  const evidencePosts = clusters.reduce((total, cluster) => total + cluster.postCount, 0);
  elements.resultsSummary.textContent = `${posts.length.toLocaleString('ja-JP')}件を解析し、${clusters.length.toLocaleString('ja-JP')}件の検出クラスタ（証拠投稿 ${evidencePosts.toLocaleString('ja-JP')}件）を表示しています。${semanticStatusText(semanticSummary)}`;
  elements.downloadButton.disabled = false;
  elements.evidenceButton.disabled = false;
}

async function readUtf8File(file) {
  try {
    const bytes = await file.arrayBuffer();
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new InputValidationError(['入力ファイルはUTF-8として読めません。文字コードをUTF-8に変換してから選択してください。']);
  }
}

async function loadFile() {
  const [file] = elements.fileInput.files;
  posts = null;
  clusters = [];
  copyCandidates = [];
  semanticSummary = null;
  analysisMode = 'clusters';
  elements.analyzeButton.disabled = true;
  elements.downloadButton.disabled = true;
  elements.evidenceButton.disabled = true;
  hideError();
  setEmptyState('ファイルを解析しています。');

  if (!file) {
    elements.fileStatus.textContent = 'ファイルは未選択です。';
    setEmptyState('検出クラスタはまだありません。');
    return;
  }

  try {
    const content = await readUtf8File(file);
    posts = parseInput(content, file.name);
    elements.fileStatus.textContent = `${file.name}（${posts.length.toLocaleString('ja-JP')}件）を読み込みました。データはブラウザ内でのみ処理されます。`;
    elements.resultsSummary.textContent = '設定を確認して「重複投稿を検出する」を選択してください。';
    setEmptyState('ファイルの読み込みが完了しました。まだ検出は実行していません。');
    elements.analyzeButton.disabled = false;
  } catch (error) {
    const errors = error instanceof InputValidationError ? error.errors : ['ファイルを読み込めませんでした。文字コードと形式を確認してください。'];
    elements.fileStatus.textContent = `${file.name} を読み込めませんでした。`;
    elements.resultsSummary.textContent = '入力エラーを修正して、再度ファイルを選択してください。';
    setEmptyState('入力を修正すると、ここに検出結果を表示します。');
    showError(errors);
  }
}

function nextPaint() {
  return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
}

function setAnalysisPending(isPending) {
  elements.fileInput.disabled = isPending;
  elements.approximate.disabled = isPending;
  elements.ignoreUrls.disabled = isPending;
  elements.ignoreMentions.disabled = isPending;
  elements.originAccount.disabled = isPending;
  elements.originPostId.disabled = isPending;
  elements.semantic.disabled = isPending;
  elements.threshold.disabled = isPending || !elements.approximate.checked;
  elements.analyzeButton.disabled = isPending || !posts;
  elements.evidenceButton.disabled = isPending || (analysisMode === 'copyCandidates' ? copyCandidates.length === 0 : clusters.length === 0);
}

function createSemanticPairs(clusterList) {
  return createSemanticCandidates(posts, clusterList);
}

async function semanticApiRequest(path, options = {}) {
  const response = await fetch(path, {
    headers: { Accept: 'application/json', ...previewAccessHeaders(), ...(options.headers || {}) },
    ...options,
  });
  let payload = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }
  return { response, payload };
}

async function ensureSemanticApiReady() {
  elements.semanticStatus.textContent = 'ローカル意味的類似APIの設定を確認しています。';
  try {
    const { response, payload } = await semanticApiRequest('/api/semantic-status');
    if (!response.ok || !payload || payload.provider !== 'orcarouter') {
      throw new Error(payload?.error?.message || 'ローカル意味的類似APIに接続できません。');
    }
    if (!payload.configured) {
      elements.semantic.checked = false;
      elements.semanticStatus.textContent = '意味的類似判定は利用できません。ローカルAPIを、固定モデルとOrcaRouter APIキーを設定して起動してください。';
      return false;
    }
    elements.semanticStatus.textContent = '意味的類似判定を利用できます。文字列近似候補と時系列近傍の発見候補をローカルAPI経由で確認します。完全一致は送信しません。';
    return true;
  } catch (error) {
    elements.semantic.checked = false;
    elements.semanticStatus.textContent = error instanceof Error ? error.message : 'ローカル意味的類似APIに接続できません。';
    return false;
  }
}

async function requestSemanticJudgment(pair, index) {
  const requestId = `semantic-${Date.now()}-${index + 1}`;
  try {
    const { response, payload } = await semanticApiRequest('/api/semantic-judgments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        requestId,
        candidateId: pair.candidateId,
        left: { text: pair.left.text },
        right: { text: pair.right.text },
      }),
    });
    if (payload?.status === 'completed' || payload?.status === 'unavailable') return payload;
    return {
      requestId,
      candidateId: pair.candidateId,
      status: 'unavailable',
      label: 'abstain',
      score: 0,
      provider: 'orcarouter',
      resolvedModel: null,
      usage: { inputTokens: 0, outputTokens: 0 },
      reason: payload?.error?.code || `semantic_api_http_${response.status}`,
      retryAfterSeconds: null,
    };
  } catch {
    return {
      requestId,
      candidateId: pair.candidateId,
      status: 'unavailable',
      label: 'abstain',
      score: 0,
      provider: 'orcarouter',
      resolvedModel: null,
      usage: { inputTokens: 0, outputTokens: 0 },
      reason: 'semantic_api_unreachable',
      retryAfterSeconds: null,
    };
  }
}

function summarizeSemanticResults(pairs, results, totalPairCount) {
  const judgments = new Map();
  const summary = {
    total: totalPairCount,
    reviewed: pairs.length,
    completed: 0,
    matches: 0,
    nonMatches: 0,
    abstained: 0,
    unavailable: 0,
    skipped: Math.max(0, totalPairCount - pairs.length),
    addedBySemantic: 0,
    excludedBySemantic: 0,
  };

  results.forEach((result, index) => {
    const pair = pairs[index];
    judgments.set(pair.candidateId, result);
    if (result.status === 'completed') {
      summary.completed += 1;
      if (result.label === 'match') summary.matches += 1;
      else if (result.label === 'non_match') summary.nonMatches += 1;
      else summary.abstained += 1;
    } else {
      summary.unavailable += 1;
    }
  });

  const reconciled = reconcileSemanticClusters({
    posts,
    baselineClusters: clusters,
    candidates: pairs,
    judgments,
  });
  clusters = reconciled.clusters;
  summary.addedBySemantic = reconciled.addedBySemantic;
  summary.excludedBySemantic = reconciled.excludedBySemantic;
  return summary;
}

async function judgeSemanticCandidates() {
  const allPairs = createSemanticPairs(clusters);
  const reviewPairs = allPairs.slice(0, MAX_SEMANTIC_JUDGMENTS);
  if (reviewPairs.length === 0) {
    return {
      total: 0,
      reviewed: 0,
      completed: 0,
      matches: 0,
      nonMatches: 0,
      abstained: 0,
      unavailable: 0,
      skipped: 0,
      addedBySemantic: 0,
      excludedBySemantic: 0,
    };
  }

  const results = new Array(reviewPairs.length);
  let nextIndex = 0;
  const worker = async () => {
    while (nextIndex < reviewPairs.length) {
      const index = nextIndex;
      nextIndex += 1;
      elements.resultsSummary.textContent = `${posts.length.toLocaleString('ja-JP')}件を解析し、意味的類似を確認しています（${index + 1}/${reviewPairs.length}件）。`;
      results[index] = await requestSemanticJudgment(reviewPairs[index], index);
    }
  };
  await Promise.all(Array.from({ length: Math.min(SEMANTIC_CONCURRENCY, reviewPairs.length) }, worker));
  return summarizeSemanticResults(reviewPairs, results, allPairs.length);
}

async function analyze() {
  if (!posts) return;
  hideError();
  clusters = [];
  copyCandidates = [];
  semanticSummary = null;
  const origin = currentOrigin();
  analysisMode = origin ? 'copyCandidates' : 'clusters';
  const useSemantic = elements.semantic.checked && !origin;
  if (elements.semantic.checked && origin) {
    elements.semanticStatus.textContent = '起点指定モードでは意味的類似判定を実行せず、決定的な後発候補だけを表示します。';
  }
  setAnalysisPending(true);
  const count = posts.length.toLocaleString('ja-JP');
  elements.resultsSummary.textContent = `${count}件を解析しています。近似一致は投稿数に応じて時間がかかることがあります。`;
  setEmptyState('ブラウザ内で検出処理を実行しています。完了までこの画面を閉じずにお待ちください。');

  try {
    await nextPaint();
    if (origin) {
      copyCandidates = findLaterCopyCandidates(posts, origin, currentOptions());
      renderCopyCandidates();
    } else {
      clusters = findDuplicateClusters(posts, currentOptions());
      if (useSemantic) {
        semanticSummary = await judgeSemanticCandidates();
      }
      renderClusters();
    }
  } catch (error) {
    const errors = error instanceof InputValidationError
      ? error.errors
      : error instanceof TypeError
        ? [error.message]
        : ['検出中に問題が起きました。設定と入力ファイルを確認してください。'];
    showError(errors);
  } finally {
    setAnalysisPending(false);
  }
}

function downloadCsv() {
  if (analysisMode === 'copyCandidates' ? copyCandidates.length === 0 : clusters.length === 0) return;
  const content = analysisMode === 'copyCandidates'
    ? copyCandidatesToCsv(copyCandidates)
    : clustersToCsv(clusters);
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' });
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = objectUrl;
  link.download = analysisMode === 'copyCandidates'
    ? 'pakulist-copy-candidates.csv'
    : 'pakulist-results.csv';
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(objectUrl);
}

function downloadEvidencePackage() {
  if (analysisMode === 'copyCandidates' ? copyCandidates.length === 0 : clusters.length === 0) return;
  const origin = currentOrigin() || {};
  const content = createEvidencePackage({
    clusters,
    copyCandidates,
    options: {
      ...currentOptions(),
      semantic: elements.semantic.checked,
      semanticSummary,
      analysisMode,
      ...origin,
    },
  });
  const blob = new Blob([content], { type: 'text/html;charset=utf-8' });
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = objectUrl;
  link.download = 'pakulist-evidence-package.html';
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(objectUrl);
}

function updateThreshold() {
  elements.thresholdValue.textContent = Number(elements.threshold.value).toFixed(2);
  elements.threshold.disabled = !elements.approximate.checked;
}

function resetResultsOnSettingChange() {
  if (!posts) return;
  clusters = [];
  copyCandidates = [];
  semanticSummary = null;
  analysisMode = 'clusters';
  elements.downloadButton.disabled = true;
  elements.evidenceButton.disabled = true;
  elements.resultsSummary.textContent = '設定が変わりました。再度「重複投稿を検出する」を選択してください。';
  setEmptyState('設定を変更しました。検出を再実行してください。');
}

async function handleSemanticSettingChange() {
  if (!elements.semantic.checked) {
    elements.semanticStatus.textContent = '意味的類似判定は無効です。投稿本文はブラウザ外へ送信されません。';
    resetResultsOnSettingChange();
    return;
  }
  if (currentOrigin()) {
    elements.semantic.checked = false;
    elements.semanticStatus.textContent = '起点指定モードでは意味的類似判定を利用できません。';
    return;
  }
  elements.semantic.disabled = true;
  const ready = await ensureSemanticApiReady();
  elements.semantic.disabled = false;
  if (ready) resetResultsOnSettingChange();
}

elements.fileInput.addEventListener('change', loadFile);
elements.analyzeButton.addEventListener('click', analyze);
elements.downloadButton.addEventListener('click', downloadCsv);
elements.evidenceButton.addEventListener('click', downloadEvidencePackage);
elements.threshold.addEventListener('input', () => {
  updateThreshold();
  resetResultsOnSettingChange();
});
[elements.approximate, elements.ignoreUrls, elements.ignoreMentions].forEach((element) => {
  element.addEventListener('change', () => {
    updateThreshold();
    resetResultsOnSettingChange();
  });
});
[elements.originPostId, elements.originAccount].forEach((element) => {
  element.addEventListener('input', resetResultsOnSettingChange);
});
elements.semantic.addEventListener('change', handleSemanticSettingChange);

initializePreviewAccessToken();
Object.assign(elements.approximate, { checked: DEFAULT_OPTIONS.approximate });
Object.assign(elements.ignoreUrls, { checked: DEFAULT_OPTIONS.ignoreUrls });
Object.assign(elements.ignoreMentions, { checked: DEFAULT_OPTIONS.ignoreMentions });
elements.threshold.value = String(DEFAULT_OPTIONS.threshold);
updateThreshold();
