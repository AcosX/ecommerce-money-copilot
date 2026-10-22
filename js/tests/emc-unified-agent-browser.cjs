'use strict';
const assert = require('node:assert/strict');
const path = require('node:path');
const os = require('node:os');
const { chromium } = require(process.env.EMC_PLAYWRIGHT_MODULE || 'playwright');

const url = process.env.EMC_TEST_URL || 'http://127.0.0.1:5191';
const outDir = process.env.EMC_SHOTS_DIR || os.tmpdir();
const image = {
  name: 'l1-report.png',
  mimeType: 'image/png',
  buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACklEQVR4nGNgAAIAAAUAAen63NgAAAAASUVORK5CYII=', 'base64')
};

(async () => {
  const browser = await chromium.launch({
    headless: true,
    channel: process.env.EMC_BROWSER_CHANNEL || undefined,
    executablePath: process.env.EMC_CHROMIUM || undefined,
    args: ['--no-sandbox']
  });
  try {
    for (const [width, height] of [[1440, 900], [390, 844]]) {
      const context = await browser.newContext({ viewport: { width, height } });
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', e => errors.push(e.message));

      const store = {
        artifacts: [],
        verifications: [],
        reviewCalls: 0
      };

      await page.route('**/api/**', async route => {
        const req = route.request();
        const uri = new URL(req.url()).pathname;
        const method = req.method();
        let status = 200;
        let result = {};

        if (uri === '/api/me') {
          result = {
            authenticated: true,
            player: { id: 'ply_unified', display_name: '店主小满' },
            roles: ['player'],
            csrf_token: 'csrf-unified'
          };
        } else if (uri === '/api/projects' && method === 'GET') {
          result = {
            items: [{ id: 'prj_unified', name: '小满杂货铺', platform: 'xiaohongshu', category: '家居收纳', version: 1, status: 'active' }],
            next_cursor: null
          };
        } else if (uri === '/api/artifacts' && method === 'GET') {
          result = { items: store.artifacts, next_cursor: null };
        } else if (uri === '/api/verifications' && method === 'GET') {
          result = { items: store.verifications, next_cursor: null };
        } else if (uri === '/api/agent/memory') {
          result = {
            memory: { intimacy_score: 68, interactions_count: 3, current_focus_level: 'L1' },
            recent_conversation: []
          };
        } else if (uri === '/api/agent/chat' && method === 'POST') {
          const body = req.postDataJSON();
          const msg = String(body.message || '');
          if (msg.includes('保存') || msg.includes('草稿') || msg.includes('交成果')) {
            const draft = {
              id: 'art_l1_draft',
              project_id: 'prj_unified',
              artifact_type: 'direction_plan',
              title: 'L1 经营方向规划（小商共创草稿）',
              origin: 'formal',
              status: 'draft',
              version: 1
            };
            store.artifacts = [draft];
            result = {
              reply: '我已经帮你把 L1 方向草稿整理好并打开提交页了，核对后直接补充凭证即可。',
              provider: 'ai_gateway_live',
              model: 'xiaoshang-v1',
              pose: 'celebrate',
              tool_calls: [
                { tool: 'save_business_draft', status: 'ok', summary: '已保存 L1 草稿 (art_l1_draft)' },
                { tool: 'open_game_card', status: 'ok', summary: '已触发打开正式经营成果抽屉' }
              ],
              saved_artifact: {
                artifact_id: 'art_l1_draft',
                level_id: 'L1',
                title: draft.title,
                status: 'draft'
              },
              ui_actions: [
                { type: 'open_game_card', card_id: 'formal_drawer', level_id: 'L1' }
              ]
            };
          } else {
            result = {
              reply: '先从你的预算、货源和每周可投入时间开始梳理。',
              provider: 'ai_gateway_live',
              model: 'xiaoshang-v1',
              pose: 'speak',
              tool_calls: [{ tool: 'get_player_progress', status: 'ok', summary: '读取 L1 进度' }]
            };
          }
        } else if (uri === '/api/evidence' && method === 'POST') {
          status = 201;
          result = { id: 'evd_l1_1', original_filename: 'l1-report.png' };
        } else if (uri === '/api/artifacts' && method === 'POST') {
          const body = req.postDataJSON();
          status = 201;
          result = { ...body, id: 'art_l1_formal', status: 'draft', version: 1 };
          store.artifacts = [result];
        } else if (uri === '/api/verifications' && method === 'POST') {
          const body = req.postDataJSON();
          status = 201;
          result = { ...body, id: 'ver_l1_1', status: 'pending', method: 'manual', created_at: new Date().toISOString() };
          store.verifications = [result];
          if (store.artifacts[0]) store.artifacts[0].status = 'submitted';
        } else if ((uri.startsWith('/api/agent/reviews/') || uri === '/api/agent/review-artifact') && method === 'POST') {
          store.reviewCalls += 1;
          result = {
            level_id: 'L1',
            recommendation: 'approve_candidate',
            recommendation_label: '建议通过（进入人工复核）',
            score: 94,
            summary: 'L1 赛道分析结构完整，预算与货源边界清晰，建议通过预审。',
            feedback: 'L1 赛道分析结构完整，预算与货源边界清晰，建议通过预审。',
            checklist: [
              { item: '目标人群与细分场景明确', passed: true },
              { item: '启动预算与货源条件真实可核查', passed: true }
            ]
          };
        }

        await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(result) });
      });

      await page.goto(url);
      await page.waitForFunction(() => window.render_game_to_text && !JSON.parse(render_game_to_text()).journey.loading);

      // 1. 验证两套 Agent 已合并为一个：#emcAvatarStage 挂载在 .copilot-dock 内，不存在独立 #cpPanel
      assert.equal(await page.locator('#cpPanel').count(), 0);
      assert.equal(await page.locator('.copilot-dock #emcAvatarStage').count(), 1);

      // 2. 打开《小商的第一封信 / 先认识这间小店》，验证 UI 与单页分页隐藏
      await page.locator('#continueButton').click();
      await page.locator('.mail-letter-sheet.mail-welcome').waitFor();
      assert.equal(await page.locator('.mail-letter-sheet.mail-welcome .mail-letter-pages').isHidden(), true);
      const pocketShadow = await page.locator('.mail-art-pocket').evaluate(el => getComputedStyle(el).boxShadow);
      assert.equal(pocketShadow, 'none');
      await page.screenshot({ path: path.join(outDir, `emc-welcome-letter-fixed-${width}x${height}.png`) });

      // 点击「好，我们从哪里开始？」进入 L1 任务信，再点击「和小商聊这一步 ↗」进入对话
      await page.locator('[data-j-action="begin"]').click();
      await page.locator('[data-j-action="ask"]').waitFor();
      await page.locator('[data-j-action="ask"]').click();
      await page.waitForFunction(() => document.getElementById('drawer').hidden === true);
      assert.match(await page.locator('#copilotInput').inputValue(), /家居收纳|判断赛道/);
      await page.screenshot({ path: path.join(outDir, `emc-unified-agent-dock-${width}x${height}.png`) });

      // 3. 验证 Agent 主导关卡集成：发送指令自动保存 L1 草稿并打开正式成果提交页
      if (width <= 700 && !await page.locator('#copilotInput').isVisible()) {
        await page.locator('#copilotHistory').click();
      }
      await page.locator('#copilotInput').fill('帮我保存L1草稿并我来交成果');
      await page.locator('#copilotSend').click();
      await page.locator('#journeyDelivery').waitFor({ timeout: 10000 });
      assert.equal(await page.locator('[data-emc-draft-card]').count(), 1);

      // 提交 L1 真实成果，验证进入 pending 视图且不回退，并可执行「请小商立即预审」
      await page.locator('[data-j-files="report"]').setInputFiles(image);
      await page.locator('[name="notes"]').fill('已完成家居收纳赛道与货源对比报告。');
      await page.locator('[name="confirm"]').check();
      await page.locator('#journeyDelivery button[type="submit"]').click();
      await page.waitForFunction(() => JSON.parse(render_game_to_text()).journey.status === 'pending' && !JSON.parse(render_game_to_text()).journey.busy);

      const aiReviewBtn = page.locator('[data-j-action="ai-review"]');
      await aiReviewBtn.waitFor();
      await aiReviewBtn.click();
      await page.locator('[data-emc-ai-review-result]').waitFor();
      assert.equal(store.reviewCalls, 1);
      assert.match(await page.locator('[data-emc-ai-review-result]').innerText(), /得分 94 \/ 100/);
      await page.screenshot({ path: path.join(outDir, `emc-agent-led-pending-review-${width}x${height}.png`) });

      assert.deepEqual(errors, []);
      await context.close();
      console.log(`PASS ${width}x${height} unified agent dock, welcome letter UI, and agent-led L1-L6 workflow`);
    }
  } finally {
    await browser.close();
  }
})().catch(e => {
  console.error(e);
  process.exitCode = 1;
});
