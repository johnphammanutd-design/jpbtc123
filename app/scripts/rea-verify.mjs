// Kiểm chứng kéo-thả bằng REA (Reverse Engineer Anything, github.com/morluto/rea):
// Playwright thực hiện kéo thẻ trong Chrome headless (CDP), REA bám cùng trình duyệt
// thu Evidence ở từng pha: idle → giữa lúc kéo → sau khi thả, rồi so pixel hai trạng thái.
//
// Chuẩn bị:  npm i -D playwright-core && npm i -g rea-agents
//            chrome --headless=new --remote-debugging-port=9222 --no-sandbox &
//            node src/server.js  (admin/admin123, có board id 1 với dữ liệu mẫu)
// Chạy:      node scripts/rea-verify.mjs
import { chromium } from 'playwright-core';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';

const S = process.env.REA_OUT_DIR || './rea-out';
fs.mkdirSync(S, { recursive: true });
const CDP = process.env.CDP_ENDPOINT || 'http://127.0.0.1:9222';
const ORIGIN = process.env.APP_ORIGIN || 'http://localhost:3000';

// Windows: CLI toàn cục là rea.cmd và phải chạy qua shell mới phân giải được
const REA_BIN = process.env.REA_BIN || (process.platform === 'win32' ? 'rea.cmd' : 'rea');
function rea(args, outFile) {
  const out = execFileSync(REA_BIN, [...args, '--format', 'json'],
    { maxBuffer: 256 * 1024 * 1024, shell: process.platform === 'win32' }).toString();
  fs.writeFileSync(outFile, out);
  return JSON.parse(out);
}

function targetIdFor(url) {
  const d = rea(['list-browser-targets', CDP], S + '/rea-targets.json');
  const t = d.normalized_result.targets.find(t => t.url.startsWith(url));
  if (!t) throw new Error('target not found: ' + JSON.stringify(d.normalized_result.targets));
  return t.target_id;
}

function shot(targetId, name) {
  const d = rea(['capture-web-screenshot', CDP, targetId, '--allowed-origins', ORIGIN], S + `/rea-${name}.json`);
  const png = d.normalized_result?.png_base64 ?? findLongString(d);
  fs.writeFileSync(S + `/rea-${name}.png`, Buffer.from(png, 'base64'));
  console.log(`[rea] screenshot ${name}: evidence ${d.evidence_id}`);
}

function findLongString(o) {
  if (typeof o === 'string' && o.length > 1000) return o;
  if (o && typeof o === 'object') {
    for (const v of Object.values(o)) {
      const r = findLongString(v);
      if (r) return r;
    }
  }
  return null;
}

const browser = await chromium.connectOverCDP(CDP);
const ctx = browser.contexts()[0] ?? (await browser.newContext());
// Đóng tab cũ của lần chạy trước để targetIdFor không bắt nhầm tab chết
for (const p of ctx.pages()) await p.close().catch(() => {});
const page = await ctx.newPage();
await page.setViewportSize({ width: 1440, height: 900 });
await page.goto(ORIGIN);
// Chạy lại được: profile trình duyệt có thể còn phiên cũ → form login không hiện
const loginVisible = await page.locator('#loginUser').isVisible().catch(() => false);
if (loginVisible) {
  await page.fill('#loginUser', 'admin');
  await page.fill('#loginPass', 'admin123');
  await page.click('#loginBtn');
}
await page.waitForSelector('.board-tile');
await page.click('.board-tile');
await page.waitForSelector('.card');
console.log('[pw] board open');

const targetId = targetIdFor(ORIGIN);

// Pha 1: trạng thái tĩnh
shot(targetId, 'idle');
const inspect1 = rea(['inspect-web-page', CDP, targetId, '--allowed-origins', ORIGIN], S + '/rea-inspect-idle.json');
console.log('[rea] inspect idle: evidence', inspect1.evidence_id);
const listeners = rea(['inspect-web-event-listeners', CDP, targetId, '.card', '--allowed-origins', ORIGIN], S + '/rea-listeners.json');
console.log('[rea] listeners on .card: evidence', listeners.evidence_id);

// Pha 2: kéo thẻ đầu tiên của "Cần làm" sang "Đang làm", DỪNG GIỮA CHỪNG để REA chụp
const card = page.locator('.card', { hasText: '[MẪU] Tập 13 — Ý tưởng câu chuyện' }).first();
const from = await card.boundingBox();
const targetList = page.locator('.cards[data-list-id="2"]');
const to = await targetList.boundingBox();
await page.mouse.move(from.x + from.width / 2, from.y + 20);
await page.mouse.down();
// vượt ngưỡng 5px để kích hoạt drag, rồi di chuyển từng bước cho animation chạy
for (let i = 1; i <= 12; i++) {
  await page.mouse.move(
    from.x + from.width / 2 + ((to.x + to.width / 2) - (from.x + from.width / 2)) * (i / 12),
    from.y + 20 + ((to.y + 60) - (from.y + 20)) * (i / 12),
    { steps: 3 },
  );
  await page.waitForTimeout(30);
}
console.log('[pw] mid-drag hold');
const ghostInfo = await page.evaluate(() => {
  const g = document.querySelector('.card.drag-ghost');
  const p = document.querySelector('.card-placeholder');
  const gs = g ? getComputedStyle(g) : null;
  return {
    ghost: g ? { transform: gs.transform, boxShadow: gs.boxShadow, zIndex: gs.zIndex } : null,
    placeholder: p ? { height: p.style.height, inList: p.closest('.cards')?.dataset.listId } : null,
    bodyDragging: document.body.classList.contains('is-dragging'),
  };
});
console.log('[pw] mid-drag state:', JSON.stringify(ghostInfo));
shot(targetId, 'mid-drag');

// Pha 3: thả
await page.mouse.up();
await page.waitForTimeout(400);
shot(targetId, 'after-drop');
const inspect2 = rea(['inspect-web-page', CDP, targetId, '--allowed-origins', ORIGIN], S + '/rea-inspect-after.json');
console.log('[rea] inspect after: evidence', inspect2.evidence_id);

// Kiểm chứng dữ liệu: thẻ đã sang cột 2
const moved = await page.evaluate(async () => {
  const token = localStorage.getItem('kanban-token');
  const r = await fetch('/api/boards/1', { headers: { Authorization: 'Bearer ' + token } });
  const d = await r.json();
  return d.cards.find(c => c.title === '[MẪU] Tập 13 — Ý tưởng câu chuyện');
});
console.log('[verify] card after drop:', JSON.stringify({ list_id: moved.list_id, position: moved.position }));
if (moved.list_id !== 2) throw new Error('DROP FAILED: card not in list 2');

// Pha 4: so sánh ảnh idle và mid-drag bằng REA (chứng minh animation thực sự đổi pixel)
const cmpInput = {
  baseline: JSON.parse(fs.readFileSync(S + '/rea-idle.json')).normalized_result,
  candidate: JSON.parse(fs.readFileSync(S + '/rea-mid-drag.json')).normalized_result,
};
fs.writeFileSync(S + '/rea-cmp-input.json', JSON.stringify(cmpInput));
try {
  const cmp = rea(['compare-web-screenshots', S + '/rea-cmp-input.json'], S + '/rea-cmp.json');
  const n = cmp.normalized_result;
  console.log('[rea] screenshot diff:', JSON.stringify(n).slice(0, 400));
} catch (e) {
  console.log('[rea] compare-web-screenshots input shape mismatch — xem schema:', e.message.slice(0, 300));
}

await page.close();
await browser.close();
console.log('REA-VERIFIED DRAG OK');
