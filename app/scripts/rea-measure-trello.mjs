// Đo vật lý kéo-thả của TRELLO THẬT (bản mới 2026) bằng REA + Playwright qua CDP.
// KHÔNG đổi dữ liệu Trello: nhấc thẻ lên, giữ giữa chừng để đo, rồi THẢ VỀ ĐÚNG CHỖ CŨ.
//
// Chuẩn bị: Chrome của user mở với --remote-debugging-port=9222, đã đăng nhập Trello,
//           đang mở một board có ít nhất 1 thẻ.
// Chạy:     node scripts/rea-measure-trello.mjs
// Kết quả:  in JSON số liệu + evidence REA trong $REA_OUT_DIR (mặc định ./rea-trello-out)
import { chromium } from 'playwright-core';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';

const S = process.env.REA_OUT_DIR || './rea-trello-out';
fs.mkdirSync(S, { recursive: true });
const CDP = process.env.CDP_ENDPOINT || 'http://127.0.0.1:9222';
const REA_BIN = process.env.REA_BIN || (process.platform === 'win32' ? 'rea.cmd' : 'rea');

function rea(args, outFile) {
  const out = execFileSync(REA_BIN, [...args, '--format', 'json'],
    { maxBuffer: 256 * 1024 * 1024, shell: process.platform === 'win32' }).toString();
  fs.writeFileSync(outFile, out);
  return JSON.parse(out);
}

const browser = await chromium.connectOverCDP(CDP);
const ctx = browser.contexts()[0];
let page = ctx.pages().find(p => /trello\.com\/b\//.test(p.url()));
if (!page) {
  // Chưa mở board: tự điều hướng tab Trello sẵn có (hoặc tab mới) tới board chỉ định
  const target = process.env.TRELLO_BOARD_URL || '';
  if (!target) throw new Error('Không thấy tab board Trello — đặt TRELLO_BOARD_URL hoặc mở board trước.');
  page = ctx.pages().find(p => /trello\.com/.test(p.url())) || await ctx.newPage();
  await page.goto(target, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(4000);
}
console.log('[pw] board:', page.url());

// Tìm target id cho REA
const targets = rea(['list-browser-targets', CDP], S + '/targets.json');
const t = targets.normalized_result.targets.find(x => /trello\.com\/b\//.test(x.url));
if (!t) throw new Error('REA không thấy target board');
const targetId = t.target_id;

// Thẻ trên bản Trello mới: thử nhiều selector
const SELECTORS = ['[data-testid="trello-card"]', '[data-testid="list-card"]', 'a.list-card', '.list-card'];
let card = null, sel = '';
for (const s of SELECTORS) {
  const loc = page.locator(s).first();
  if (await loc.count() && await loc.isVisible().catch(() => false)) { card = loc; sel = s; break; }
}
if (!card) throw new Error('Không tìm thấy thẻ nào — board có thẻ không?');
console.log('[pw] selector thẻ:', sel);

// Evidence trạng thái tĩnh + listener
const shot = name => {
  const d = rea(['capture-web-screenshot', CDP, targetId], `${S}/shot-${name}.json`);
  console.log(`[rea] screenshot ${name}:`, d.evidence_id);
};
shot('idle');
try {
  const ls = rea(['inspect-web-event-listeners', CDP, targetId, sel], S + '/listeners.json');
  console.log('[rea] listeners:', ls.evidence_id);
} catch (e) { console.log('[rea] listeners bỏ qua:', String(e.message).slice(0, 120)); }

// Kéo: nhấc lên, đưa sang phải 180px giữ nguyên, đo, rồi trả về chỗ cũ
const box = await card.boundingBox();
const ox = box.x + box.width / 2, oy = box.y + Math.min(20, box.height / 2);
await page.mouse.move(ox, oy);
await page.mouse.down();
for (let i = 1; i <= 10; i++) { await page.mouse.move(ox + 18 * i, oy + 4 * i, { steps: 2 }); await page.waitForTimeout(25); }
await page.waitForTimeout(250); // cho animation ổn định

const mid = await page.evaluate((sel) => {
  const pick = el => {
    if (!el) return null;
    const s = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    return {
      cls: (el.className || '').toString().slice(0, 200),
      transform: s.transform, rotate: s.rotate, boxShadow: s.boxShadow, opacity: s.opacity,
      zIndex: s.zIndex, transition: s.transition, cursor: s.cursor, borderRadius: s.borderRadius,
      w: Math.round(r.width), h: Math.round(r.height),
    };
  };
  // Ứng viên phần tử ghost/preview đang kéo
  const ghost =
    document.querySelector('[data-testid="card-drag-preview"]') ||
    document.querySelector('[class*="drag-preview"]') ||
    document.querySelector('[class*="DragPreview"]') ||
    [...document.querySelectorAll('body > div')].find(d => {
      const st = getComputedStyle(d);
      return st.position === 'fixed' && st.pointerEvents === 'none' && d.querySelector(sel.replace(/^\[|\]$/g, '[') ? sel : '*');
    }) || null;
  // Placeholder / chỗ trống
  const ph = document.querySelector('[data-testid*="placeholder"], [class*="placeholder"], [class*="Placeholder"]');
  // Thẻ gốc đang kéo (thường bị ẩn/mờ)
  const dragging = document.querySelector('[data-dragging="true"], [aria-grabbed="true"], [class*="is-dragging"], [class*="hide-on-drag"]');
  return {
    ghost: pick(ghost), placeholder: pick(ph), original: pick(dragging),
    bodyClass: document.body.className.slice(0, 200),
    fixedLayers: [...document.querySelectorAll('body > div')].filter(d => getComputedStyle(d).position === 'fixed').length,
  };
}, sel);
console.log('[đo] mid-drag:', JSON.stringify(mid, null, 1));
fs.writeFileSync(S + '/mid-drag-styles.json', JSON.stringify(mid, null, 2));
shot('mid-drag');

// Trả thẻ về đúng chỗ cũ rồi thả — không đổi dữ liệu
for (let i = 10; i >= 0; i--) { await page.mouse.move(ox + 18 * i, oy + 4 * i, { steps: 2 }); await page.waitForTimeout(15); }
await page.mouse.up();
await page.waitForTimeout(500);
shot('after-drop');

// So pixel idle ↔ mid-drag để chứng minh có hiệu ứng thật
try {
  const cmpInput = {
    baseline: JSON.parse(fs.readFileSync(S + '/shot-idle.json')).normalized_result,
    candidate: JSON.parse(fs.readFileSync(S + '/shot-mid-drag.json')).normalized_result,
  };
  fs.writeFileSync(S + '/cmp-input.json', JSON.stringify(cmpInput));
  const cmp = rea(['compare-web-screenshots', S + '/cmp-input.json'], S + '/cmp.json');
  console.log('[rea] pixel diff:', JSON.stringify(cmp.normalized_result).slice(0, 300));
} catch (e) { console.log('[rea] compare bỏ qua (schema):', String(e.message).slice(0, 120)); }

console.log('\nTRELLO-MEASURE DONE — số liệu trong', S);
await browser.close();
