/* Only bundled example content is accepted. User reports stay in private artifacts. */
(async function () {
  'use strict';
  const kind = new URLSearchParams(location.search).get('example') || 'category';
  const host = document.getElementById('reportContent');
  try {
    if (!['category', 'selection'].includes(kind)) throw new Error('unknown example');
    document.getElementById('reportTheme').href = kind + '.css';
    const response = await fetch(kind + '.json');
    if (!response.ok) throw new Error('load failed');
    const data = await response.json();
    document.title = data.title + ' · 示例';
    host.innerHTML = DOMPurify.sanitize(data.body_html, {
      FORBID_TAGS: ['script', 'iframe', 'object', 'embed', 'style', 'link', 'form'],
      ADD_ATTR: ['target']
    });
    host.querySelectorAll('a').forEach(a => { a.rel = 'noopener noreferrer'; });
    const charts = [];
    for (const [id, options] of Object.entries(data.charts || {})) {
      const node = host.querySelector('#' + CSS.escape(id));
      if (!node) continue;
      if (typeof echarts === 'undefined') {
        node.textContent = '图表暂不可用，数据见报告正文。';
        continue;
      }
      const chart = echarts.init(node);
      chart.setOption(options);
      charts.push(chart);
    }
    window.addEventListener('resize', () => charts.forEach(chart => chart.resize()));
    if (kind === 'selection') {
      const script = document.createElement('script');
      script.src = 'selection-effects.js';
      document.body.appendChild(script);
    }
    document.documentElement.dataset.reportReady = kind;
  } catch (_) {
    host.className = 'report-error';
    host.textContent = '报告示例暂时无法打开，请返回小店后重试。';
  }
})();
