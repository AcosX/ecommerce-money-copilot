'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const os = require('node:os');
const { chromium } = require(process.env.EMC_PLAYWRIGHT_MODULE || 'playwright');
const root = path.resolve(__dirname, '../..');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.glb': 'model/gltf-binary', '.webp': 'image/webp', '.png': 'image/png', '.svg': 'image/svg+xml' };

function contrast(fg, bg) {
  const luminance = color => {
    const values = color.match(/[\d.]+/g).slice(0, 3).map(v => {
      const x = Number(v) / 255;
      return x <= .04045 ? x / 12.92 : ((x + .055) / 1.055) ** 2.4;
    });
    return values[0] * .2126 + values[1] * .7152 + values[2] * .0722;
  };
  const a = luminance(fg), b = luminance(bg);
  return (Math.max(a, b) + .05) / (Math.min(a, b) + .05);
}

(async () => {
  const server = http.createServer((req, res) => {
    const file = path.resolve(root, '.' + new URL(req.url, 'http://localhost').pathname.replace(/\/$/, '/index.html'));
    if (!file.startsWith(root + path.sep)) { res.writeHead(403).end(); return; }
    fs.readFile(file, (error, data) => {
      if (error) { res.writeHead(404).end(); return; }
      res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream' });
      res.end(data);
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    browser = await chromium.launch({ headless: true, executablePath: process.env.EMC_CHROMIUM || undefined, args: ['--no-sandbox'] });
    for (const width of [1440, 390]) {
      const page = await browser.newPage({ viewport: { width, height: 900 } });
      const posts = [], errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.addInitScript(() => {
        localStorage.setItem('emc-journey-welcome-v1', '1');
        localStorage.setItem('emc-journey-entry-v1', JSON.stringify({ saved: true, shop_name: '收纳小店', partner_name: '小商', category: '宿舍收纳', platform: 'xiaohongshu', agent: 'Codex' }));
      });
      await page.route('**/api/**', async route => {
        const url = new URL(route.request().url()).pathname;
        let result = { items: [], next_cursor: null };
        if (url === '/api/me') result = { authenticated: false };
        if (url === '/api/agent/chat') {
          posts.push(route.request().postDataJSON());
          result = {
            reply: posts.length === 1 ? '按已知成本，单笔差额51.05元，毛利率51.57%。广告费、退货和税费尚未计入。' : '加上刚才的运费，我们接着核对包材成本。',
            provider: 'ai_gateway_live',
            knowledge_citations: [{ title: '毛利与保本ROI', platform: '通用', category: '算账' }],
            roi_calculation: { selling_price: 99, total_cost: 47.95, unit_profit: 51.05, gross_margin_pct: 51.57, breakeven_roi: 1.94, verdict: '尚未计入广告费、退货损耗、税费' }
          };
        }
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(result) });
      });
      await page.goto(`http://127.0.0.1:${server.address().port}/`);
      await page.waitForFunction(() => window.render_game_to_text && !JSON.parse(render_game_to_text()).journey.loading);
      if (width <= 700) await page.locator('#copilotHistory').click();
      await page.locator('#copilotInput').fill('拿货35售价99运费6包材2佣金5%');
      await page.locator('#copilotSend').click();
      await page.locator('[data-emc-agent-card]').waitFor();
      const card = page.locator('[data-emc-agent-card]').last();
      assert.equal(await card.evaluate(el => el.open), false);
      await card.locator('summary').click();
      assert.match(await card.innerText(), /参考与计算/);
      assert.doesNotMatch(await card.innerText(), /净利率|四维加权分/);
      for (const theme of ['day', 'night']) {
        await page.evaluate(t => { document.documentElement.dataset.theme = t; }, theme);
        const colors = await card.evaluate(el => ({
          background: getComputedStyle(el).backgroundColor,
          texts: [el, ...el.querySelectorAll('summary, .emc-agent-card-source, .emc-agent-roi')].map(node => getComputedStyle(node).color)
        }));
        for (const color of colors.texts) assert.ok(contrast(color, colors.background) >= 4.5, `${width}px ${theme}: ${color} on ${colors.background}`);
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
        await page.screenshot({ path: path.join(os.tmpdir(), `emc-dialogue-${width}-${theme}.png`) });
      }
      await page.locator('#copilotInput').fill('那运费呢');
      await page.locator('#copilotSend').click();
      await page.waitForFunction(() => !JSON.parse(render_game_to_text()).chat.sending);
      assert.equal(posts.length, 2);
      assert.equal(posts[1].guest_history[0].text, '拿货35售价99运费6包材2佣金5%');
      assert.equal(posts[1].guest_history[1].role, 'assistant');
      assert.ok(!posts[1].guest_history.some(t => t.text === '那运费呢'));
      assert.deepEqual(errors, []);
      console.log(`PASS ${width}px guest context, reference card, day/night contrast and overflow`);
      await page.close();
    }
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
