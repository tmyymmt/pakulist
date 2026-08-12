import {
  DEFAULT_OPTIONS,
  InputValidationError,
  clustersToCsv,
  findDuplicateClusters,
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
  resultsArea: document.querySelector('#results-area'),
  resultsSummary: document.querySelector('#results-summary'),
  threshold: document.querySelector('#threshold'),
  thresholdValue: document.querySelector('#threshold-value'),
};

let posts = null;
let clusters = [];

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

function analyze() {
  if (!posts) return;
  hideError();
  try {
    clusters = findDuplicateClusters(posts, currentOptions());
    renderClusters();
  } catch (error) {
    const errors = error instanceof InputValidationError ? error.errors : ['検出中に問題が起きました。設定と入力ファイルを確認してください。'];
    showError(errors);
  }
}

function downloadCsv() {
  if (clusters.length === 0) return;
  const blob = new Blob([clustersToCsv(clusters)], { type: 'text/csv;charset=utf-8' });
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = objectUrl;
  link.download = 'pakulist-results.csv';
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

Object.assign(elements.approximate, { checked: DEFAULT_OPTIONS.approximate });
Object.assign(elements.ignoreUrls, { checked: DEFAULT_OPTIONS.ignoreUrls });
Object.assign(elements.ignoreMentions, { checked: DEFAULT_OPTIONS.ignoreMentions });
elements.threshold.value = String(DEFAULT_OPTIONS.threshold);
updateThreshold();
