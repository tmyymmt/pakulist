import {
  DEFAULT_OPTIONS,
  InputValidationError,
  clustersToCsv,
  copyCandidatesToCsv,
  findDuplicateClusters,
  findLaterCopyCandidates,
  parseInput,
} from '/src/detection.js';

const REPORT_HELP_URL = 'https://help.x.com/ja/forms';

const elements = {
  analyzeButton: document.querySelector('#analyze-button'),
  approximate: document.querySelector('#approximate'),
  downloadButton: document.querySelector('#download-button'),
  errorArea: document.querySelector('#error-area'),
  fileInput: document.querySelector('#post-file'),
  fileStatus: document.querySelector('#file-status'),
  ignoreMentions: document.querySelector('#ignore-mentions'),
  ignoreUrls: document.querySelector('#ignore-urls'),
  originAccount: document.querySelector('#origin-account'),
  originPostId: document.querySelector('#origin-post-id'),
  resultsArea: document.querySelector('#results-area'),
  resultsSummary: document.querySelector('#results-summary'),
  threshold: document.querySelector('#threshold'),
  thresholdValue: document.querySelector('#threshold-value'),
};

let posts = null;
let clusters = [];
let copyCandidates = [];
let analysisMode = 'clusters';

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

  card.append(header, metrics, evidenceTitle, evidence, caution);
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
    return;
  }

  elements.resultsArea.className = 'cluster-list';
  copyCandidates.forEach((item, index) => elements.resultsArea.append(renderCopyCandidate(item, index)));
  const originCount = new Set(copyCandidates.map((item) => item.origin.id)).size;
  elements.resultsSummary.textContent = `${posts.length.toLocaleString('ja-JP')}件を解析し、${originCount.toLocaleString('ja-JP')}件の起点から後発コピー候補 ${copyCandidates.length.toLocaleString('ja-JP')}件を表示しています。`;
  elements.downloadButton.disabled = false;
}

function renderClusters() {
  clearChildren(elements.resultsArea);
  if (clusters.length === 0) {
    setEmptyState('異なるアカウント間で条件に一致する重複投稿は検出されませんでした。設定を確認するか、別の入力データをお試しください。');
    elements.resultsSummary.textContent = `${posts.length.toLocaleString('ja-JP')}件を解析し、検出クラスタは0件でした。`;
    elements.downloadButton.disabled = true;
    return;
  }

  elements.resultsArea.className = 'cluster-list';
  clusters.forEach((cluster) => elements.resultsArea.append(renderCluster(cluster)));
  const evidencePosts = clusters.reduce((total, cluster) => total + cluster.postCount, 0);
  elements.resultsSummary.textContent = `${posts.length.toLocaleString('ja-JP')}件を解析し、${clusters.length.toLocaleString('ja-JP')}件の検出クラスタ（証拠投稿 ${evidencePosts.toLocaleString('ja-JP')}件）を表示しています。`;
  elements.downloadButton.disabled = false;
}

async function loadFile() {
  const [file] = elements.fileInput.files;
  posts = null;
  clusters = [];
  copyCandidates = [];
  analysisMode = 'clusters';
  elements.analyzeButton.disabled = true;
  elements.downloadButton.disabled = true;
  hideError();
  setEmptyState('ファイルを解析しています。');

  if (!file) {
    elements.fileStatus.textContent = 'ファイルは未選択です。';
    setEmptyState('検出クラスタはまだありません。');
    return;
  }

  try {
    const content = await file.text();
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
  elements.threshold.disabled = isPending || !elements.approximate.checked;
  elements.analyzeButton.disabled = isPending || !posts;
}

async function analyze() {
  if (!posts) return;
  hideError();
  clusters = [];
  copyCandidates = [];
  const origin = currentOrigin();
  analysisMode = origin ? 'copyCandidates' : 'clusters';
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

function updateThreshold() {
  elements.thresholdValue.textContent = Number(elements.threshold.value).toFixed(2);
  elements.threshold.disabled = !elements.approximate.checked;
}

function resetResultsOnSettingChange() {
  if (!posts) return;
  clusters = [];
  copyCandidates = [];
  analysisMode = 'clusters';
  elements.downloadButton.disabled = true;
  elements.resultsSummary.textContent = '設定が変わりました。再度「重複投稿を検出する」を選択してください。';
  setEmptyState('設定を変更しました。検出を再実行してください。');
}

elements.fileInput.addEventListener('change', loadFile);
elements.analyzeButton.addEventListener('click', analyze);
elements.downloadButton.addEventListener('click', downloadCsv);
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

Object.assign(elements.approximate, { checked: DEFAULT_OPTIONS.approximate });
Object.assign(elements.ignoreUrls, { checked: DEFAULT_OPTIONS.ignoreUrls });
Object.assign(elements.ignoreMentions, { checked: DEFAULT_OPTIONS.ignoreMentions });
elements.threshold.value = String(DEFAULT_OPTIONS.threshold);
updateThreshold();
