function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function formatDate(value) {
  return new Intl.DateTimeFormat('ja-JP', {
    dateStyle: 'medium',
    timeStyle: 'medium',
    timeZone: 'UTC',
  }).format(new Date(value));
}

function formatDuration(milliseconds) {
  const totalSeconds = Math.round(milliseconds / 1000);
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

function postEvidence(post, heading) {
  return `<section class="post-evidence">
  <h4>${escapeHtml(heading)}</h4>
  <dl>
    <div><dt>アカウント</dt><dd>@${escapeHtml(post.account)}</dd></div>
    <div><dt>投稿日時</dt><dd><time datetime="${escapeHtml(post.postedAt)}">${escapeHtml(formatDate(post.postedAt))}（${escapeHtml(post.postedAt)}）</time></dd></div>
    <div><dt>投稿URL</dt><dd><a href="${escapeHtml(post.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(post.url)}</a></dd></div>
  </dl>
  <p class="post-text">${escapeHtml(post.text)}</p>
</section>`;
}

function semanticEvidence(semantic) {
  if (!semantic) return '';
  const values = [
    `意味的類似API: ${semantic.completed}件を確認`,
    `match: ${semantic.matches}件`,
    `non_match: ${semantic.nonMatches}件`,
    `棄権: ${semantic.abstained}件`,
    `利用不可: ${semantic.unavailable}件`,
  ];
  if (Number.isFinite(semantic.highestScore)) values.push(`最高スコア: ${Number(semantic.highestScore).toFixed(2)}`);
  if (Array.isArray(semantic.resolvedModels) && semantic.resolvedModels.length > 0) values.push(`モデル: ${semantic.resolvedModels.join(', ')}`);
  return `<p>\n    ${escapeHtml(values.join(' ／ '))}\n  </p>`;
}

function clusterEvidence(cluster) {
  return `<article class="evidence-item">
  <header>
    <h3>${escapeHtml(cluster.id)} <span class="badge">${cluster.matchType === 'exact' ? '完全一致' : '近似一致'}</span></h3>
    <p>最大類似度: <strong>${escapeHtml(Number(cluster.similarity).toFixed(2))}</strong> ／ アカウント: ${escapeHtml(cluster.accountCount)}件 ／ 投稿: ${escapeHtml(cluster.postCount)}件</p>
    ${semanticEvidence(cluster.semantic)}
  </header>
  ${cluster.posts.map((post, index) => postEvidence(post, `証拠投稿 ${index + 1}`)).join('\n')}
</article>`;
}

function copyCandidateEvidence(item, index) {
  return `<article class="evidence-item">
  <header>
    <h3>後発コピー候補 ${String(index + 1).padStart(3, '0')} <span class="badge">${item.matchType === 'exact' ? '完全一致' : '近似一致'}</span></h3>
    <p>類似度: <strong>${escapeHtml(Number(item.similarity).toFixed(2))}</strong> ／ 起点からの時刻差: <strong>${escapeHtml(formatDuration(item.timeDifferenceMs))}</strong></p>
  </header>
  ${postEvidence(item.origin, '起点投稿')}
  ${postEvidence(item.candidate, '後発候補')}
</article>`;
}

function optionEvidence(options) {
  const values = [
    ['近似一致', options.approximate ? '有効' : '無効'],
    ['近似一致の閾値', Number(options.threshold).toFixed(2)],
    ['URLを比較から除外', options.ignoreUrls ? '有効' : '無効'],
    ['メンションを比較から除外', options.ignoreMentions ? '有効' : '無効'],
    ['意味的類似API', options.semantic ? '有効' : '無効'],
    ['解析モード', options.analysisMode === 'copyCandidates' ? '時系列コピー候補' : '重複クラスタ'],
  ];
  if (options.semanticSummary) {
    values.push(['意味的類似の確認件数', `${options.semanticSummary.completed}/${options.semanticSummary.reviewed}件`]);
    values.push(['意味的類似のmatch件数', `${options.semanticSummary.matches}件`]);
    values.push(['意味的類似の棄権・利用不可', `${options.semanticSummary.abstained + options.semanticSummary.unavailable}件`]);
    values.push(['LLMによる近似一致の追加', `${options.semanticSummary.addedBySemantic || 0}件`]);
    values.push(['LLMによる文字列近似候補の除外', `${options.semanticSummary.excludedBySemantic || 0}件`]);
  }
  if (options.originPostId) values.push(['起点投稿ID', options.originPostId]);
  if (options.originAccount) values.push(['起点アカウント', `@${options.originAccount.replace(/^@+/, '')}`]);
  return values.map(([label, value]) => `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`).join('\n');
}

export function createEvidencePackage({
  clusters = [],
  copyCandidates = [],
  options,
  generatedAt = new Date(),
}) {
  if (!Array.isArray(clusters) || !Array.isArray(copyCandidates)) {
    throw new TypeError('証拠パッケージの候補データは配列である必要があります。');
  }
  if (!options || typeof options !== 'object') {
    throw new TypeError('証拠パッケージには判定設定が必要です。');
  }

  const isCopyCandidateMode = options.analysisMode === 'copyCandidates';
  const evidenceItems = isCopyCandidateMode
    ? copyCandidates.map(copyCandidateEvidence).join('\n')
    : clusters.map(clusterEvidence).join('\n');
  const itemCount = isCopyCandidateMode ? copyCandidates.length : clusters.length;
  const itemLabel = isCopyCandidateMode ? '後発コピー候補' : '検出クラスタ';

  return `<!doctype html>
<html lang="ja">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'" />
  <title>pakulist 証拠パッケージ</title>
  <style>
    :root { color: #16231c; background: #f4f6f1; font-family: system-ui, -apple-system, "Hiragino Sans", "Yu Gothic", sans-serif; }
    body { max-width: 940px; margin: 0 auto; padding: 32px 20px 56px; line-height: 1.65; }
    h1, h2, h3, h4 { line-height: 1.3; } h1 { margin-bottom: 4px; } h2 { margin-top: 40px; border-bottom: 2px solid #0e6b4c; padding-bottom: 8px; }
    .meta, .notice, .evidence-item { margin-top: 18px; padding: 18px; border: 1px solid #d8dfd6; border-radius: 10px; background: #fff; }
    .notice { border-left: 5px solid #b57612; background: #fff9eb; } .notice p:last-child { margin-bottom: 0; }
    dl { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; margin: 0; } dl div { padding: 10px; background: #f4f7f3; } dt { color: #53625a; font-size: 0.85rem; } dd { margin: 2px 0 0; overflow-wrap: anywhere; }
    .evidence-item { page-break-inside: avoid; } .evidence-item > header { padding-bottom: 10px; border-bottom: 1px solid #d8dfd6; } .evidence-item h3 { margin: 0; }
    .badge { display: inline-block; padding: 2px 8px; border-radius: 999px; color: #064333; background: #dff4e7; font-size: 0.8rem; } .post-evidence { margin-top: 18px; padding: 14px; border-left: 3px solid #89a595; background: #f8faf7; }
    .post-evidence h4 { margin: 0 0 10px; } .post-text { white-space: pre-wrap; overflow-wrap: anywhere; } a { color: #064c35; font-weight: 700; }
    @media print { body { max-width: none; padding: 0; background: #fff; } .notice, .meta, .evidence-item { break-inside: avoid; } a { color: #000; text-decoration: none; } }
  </style>
</head>
<body>
  <header>
    <p>PAKULIST EVIDENCE PACKAGE</p>
    <h1>手動確認・通報向け証拠パッケージ</h1>
    <p>生成日時: <time datetime="${escapeHtml(generatedAt.toISOString())}">${escapeHtml(formatDate(generatedAt.toISOString()))}（${escapeHtml(generatedAt.toISOString())}）</time></p>
  </header>
  <section class="notice">
    <h2>利用前の確認</h2>
    <p>この出力は投稿時刻と本文の決定的な一致・類似に基づく<strong>候補</strong>です。著作権侵害、規約違反その他の法的結論を示すものではありません。通報やその他の対応の要否は、利用者が原投稿、投稿の公開状況、適用される規約・法律を確認して最終判断してください。</p>
    <p>このアプリは通報フォームの送信や通報操作を自動化しません。投稿URLは利用者が明示的に開くための参照です。</p>
  </section>
  <section class="notice">
    <h2>スクリーンショットの扱い</h2>
    <p>このアプリはスクリーンショットを取得・保存しません。添付が必要な場合は、利用者が投稿の公開範囲、利用許諾、SNSの規約を確認し、必要最小限のスクリーンショットを自身の端末で取得・保管してください。</p>
  </section>
  <section class="meta">
    <h2>判定設定</h2>
    <dl>${optionEvidence(options)}</dl>
  </section>
  <main>
    <h2>検出結果</h2>
    <p>${escapeHtml(itemLabel)}: ${escapeHtml(itemCount)}件</p>
    ${evidenceItems || '<p>証拠として出力できる候補はありません。</p>'}
  </main>
</body>
</html>`;
}
