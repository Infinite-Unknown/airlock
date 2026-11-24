// Records the raw footage for the launch video: the real app in Google Chrome with Gemini Nano,
// captured with the CDP screencast at 2x device scale (1600x900 viewport -> 3200x1800 frames).
// Nothing is drawn into the page. The run log (frame times, marks, mouse moves, clicks and element
// rectangles) goes to assets/raw-launch/run.json; scripts/demo/edit.mjs turns it into the video.
// Usage: npm run dev -- --port 5397, then: node scripts/demo/record.mjs [http://127.0.0.1:5397/]
// Needs Gemini Nano already downloaded in the .chrome-profile/ automation profile (see scripts/chrome.mjs).
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { launchChrome } from '../chrome.mjs';

const url = process.argv[2] || 'http://127.0.0.1:5397/';
const root = resolve(import.meta.dirname, '..', '..');
const rawDir = join(root, 'assets', 'raw-launch');
const framesDir = join(rawDir, 'frames');
const W = 1600;
const H = 900;
rmSync(framesDir, { recursive: true, force: true });
mkdirSync(framesDir, { recursive: true });

const context = await launchChrome({ viewport: { width: W, height: H }, deviceScaleFactor: 2 });
const page = context.pages()[0] ?? (await context.newPage());
const wait = (ms) => page.waitForTimeout(ms);
const now = () => Date.now() / 1000;

const RECTS = {
  header: 'header.top',
  status: '.status',
  chipDevice: '#chip-device',
  chipCloud: '#chip-cloud',
  flow: 'main.flow',
  panelIn: '.flow > .panel:nth-child(1)',
  panelLock: '.panel.lock',
  panelOut: '.flow > .panel:nth-child(3)',
  samples: '#samples',
  clinic: 'button[data-sample="clinic"]',
  input: '#input',
  redact: '#btn-redact',
  redacted: '#redacted',
  subHead: '.panel.lock .sub-head',
  entities: '#entities',
  send: '#btn-send',
  outBody: '#out-body',
  result: '#result',
  badge: '#source-badge',
  rawToggle: 'label.toggle',
  log: 'section.log',
  logHead: '.log-head',
  tally: '.tally',
  logList: '#log',
  logRow: '#log > li:first-child',
  logSummary: '#log > li:first-child summary',
  logPayload: '#log > li:first-child pre',
  logProof: '#log > li:first-child .log-proof',
  tallyReq: '#tally-req',
  tallyLeak: '#tally-leak',
  tallyReqBox: '.tally > div:first-child',
  tallyLeakBox: '.tally > div:last-child',
  addForm: '#add-form',
  rawToggleBox: '.toggle',
  lockBody: '#lock-body',
};
// groups of small elements, clipped to the visible part of their scroll container
const GROUPS = {
  srcNano: ['#entities li .src', '#entities', /nano/i],
  srcRule: ['#entities li .src', '#entities', /rule/i],
  links: ['#entities li .link', '#entities', null],
  restoredMarks: ['#result mark.restored', '#result', null],
  resultToks: ['#result .tok', '#result', null],
  redactedToks: ['#redacted .tok', '#redacted', null],
};
async function rects() {
  return page.evaluate(([sel, groups]) => {
    const box = (r) => ({ x: r.left, y: r.top, w: r.width, h: r.height });
    const out = {};
    for (const [k, s] of Object.entries(sel)) {
      const el = document.querySelector(s);
      if (!el) continue;
      const r = el.getBoundingClientRect();
      if (r.width && r.height) out[k] = box(r);
    }
    for (const [k, [s, clip, re]] of Object.entries(groups)) {
      const c = document.querySelector(clip)?.getBoundingClientRect();
      if (!c) continue;
      const list = [];
      for (const el of document.querySelectorAll(s)) {
        if (re && !new RegExp(re.source, re.flags).test(el.textContent ?? '')) continue;
        // one rect per line box, so wrapped values get one ring per line
        for (const r of el.getClientRects()) {
          if (r.width && r.height && r.top >= c.top - 1 && r.bottom <= c.bottom + 1) list.push(box(r));
        }
      }
      if (list.length) out[k] = list;
    }
    return out;
  }, [RECTS, Object.fromEntries(Object.entries(GROUPS).map(([k, [a, b, re]]) => [k, [a, b, re && { source: re.source, flags: re.flags }]]))]);
}

const run = { viewport: { width: W, height: H }, scale: 2, frames: [], marks: {}, moves: [], clicks: [], scrolls: [] };
async function mark(name) {
  run.marks[name] = { t: now(), rects: await rects() };
}

// ---- mouse: eased glides, logged so the editor can draw the same path
let mouse = { x: 1180, y: 760 };
const ease = (u) => (u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2);
async function glide(x, y, ms = 900) {
  const from = { ...mouse };
  const t0 = now();
  const steps = Math.max(2, Math.round(ms / 16));
  for (let i = 1; i <= steps; i++) {
    const u = ease(i / steps);
    await page.mouse.move(from.x + (x - from.x) * u, from.y + (y - from.y) * u);
    await wait(ms / steps);
  }
  mouse = { x, y };
  run.moves.push({ t0, t1: now(), from, to: { x, y } });
}
async function centerOf(sel, dx = 0, dy = 0) {
  const r = await page.locator(sel).first().boundingBox();
  if (!r) throw new Error(`no box for ${sel}`);
  return { x: r.x + r.width / 2 + dx, y: r.y + r.height / 2 + dy };
}
async function glideTo(sel, ms = 900, dx = 0, dy = 0) {
  const p = await centerOf(sel, dx, dy);
  await glide(p.x, p.y, ms);
}
async function click() {
  run.clicks.push({ t: now(), x: mouse.x, y: mouse.y });
  await page.mouse.down();
  await wait(90);
  await page.mouse.up();
}

// ---- warm-up off camera: the first Gemini Nano prompt of a session is much slower
await page.goto(url);
await page.evaluate(() => document.fonts.ready);
const ready = () =>
  page.waitForFunction(() => /ready/i.test(document.querySelector('#chip-device')?.textContent ?? ''), null, { timeout: 20000 });
await ready().catch(() => {});
const chip = ((await page.textContent('#chip-device')) ?? '').replace(/\s+/g, ' ').trim();
if (!/ready/i.test(chip)) throw new Error(`Gemini Nano is not ready in this Chrome profile: "${chip}"`);
await page.click('button[data-sample="support"]');
await page.click('#btn-redact');
await page.waitForFunction(() => !document.querySelector('#lock-body')?.classList.contains('hidden') && !document.querySelector('#btn-redact')?.disabled, null, { timeout: 120000 });
await page.reload();
await page.evaluate(() => document.fonts.ready);
await ready();
await page.waitForFunction(() => !/checking/i.test(document.querySelector('#chip-cloud')?.textContent ?? ''), null, { timeout: 20000 });
// Recording-only styles: hide the page scrollbar and leave room below the egress log so it can be
// scrolled to the top of the viewport with its payload open.
await page.addStyleTag({ content: 'html{scrollbar-width:none}body{padding-bottom:300px !important}' });
// Log each placeholder as it lands in the redacted text, and each real value as it is restored in
// the answer, with its position, so the editor can put a callout on it at that moment.
await page.evaluate(() => {
  window.__landed = [];
  const watch = (root, match, kind) =>
    new MutationObserver((muts) => {
      for (const m of muts)
        for (const n of m.addedNodes) {
          if (!(n instanceof HTMLElement) || !n.matches(match)) continue;
          const t = Date.now() / 1000;
          requestAnimationFrame(() => {
            // measure without the land-in scale so the ring fits the settled element
            const anim = n.getAnimations();
            anim.forEach((a) => a.pause());
            const prev = n.style.transform;
            n.style.transform = 'none';
            const rs = [...n.getClientRects()].map((r) => ({ x: r.left, y: r.top, w: r.width, h: r.height }));
            n.style.transform = prev;
            anim.forEach((a) => a.play());
            window.__landed.push({ kind, t, text: n.textContent, rects: rs });
          });
        }
    }).observe(document.querySelector(root), { childList: true, subtree: true });
  watch('#redacted', '.tok', 'placeholder');
  watch('#result', 'mark.restored', 'restored');
});
await page.mouse.move(mouse.x, mouse.y);
await wait(1200);

// ---- capture
const cdp = await context.newCDPSession(page);
cdp.on('Page.screencastFrame', async (f) => {
  const file = `${String(run.frames.length).padStart(6, '0')}.jpg`;
  writeFileSync(join(framesDir, file), Buffer.from(f.data, 'base64'));
  run.frames.push({ file, t: f.metadata.timestamp, sy: f.metadata.scrollOffsetY });
  try {
    await cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId });
  } catch {}
});
await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 92, maxWidth: W * 2, maxHeight: H * 2, everyNthFrame: 1 });
// replay the entrance so the first frames are not a blank page
await page.evaluate(() =>
  document.querySelectorAll('.enter').forEach((e) => {
    e.classList.remove('enter');
    void e.offsetWidth;
    e.classList.add('enter');
  }),
);
await mark('start');
await wait(3000);

// problem: load the clinic sample
await glideTo('button[data-sample="clinic"]', 1000);
await wait(250);
await mark('sampleClick');
await click();
await wait(600);
await mark('sample');
await wait(5000);

// status chips
await glideTo('#chip-device', 1100, -10, 0);
await mark('chips');
await wait(5500);

// step 1: redaction on the device
await glideTo('#btn-redact', 1100);
await wait(300);
await mark('redactClick');
await click();
await page.waitForSelector('#lock-body:not(.hidden)', { timeout: 120000 });
await mark('lockShown');
await wait(3500);
await mark('sweepEnd');
await wait(1500);

// review: what the cloud will see
await glideTo('#entities > li:nth-child(1) .src', 1100);
await mark('entities');
await wait(6000);
const entities = await page.$$eval('#entities li', (els) =>
  els.map((e) => ({ tok: e.querySelector('.tok')?.textContent?.trim(), val: e.querySelector('.val')?.textContent?.trim(), src: e.querySelector('.src')?.textContent?.trim() })),
);

// step 2: send, step 3: restore
await glideTo('#btn-send', 1000);
await wait(300);
await mark('sendClick');
await click();
await page.waitForSelector('#out-body:not(.hidden), #out-error:not(.hidden)', { timeout: 90000 });
await mark('answer');
if (!(await page.isVisible('#out-body'))) throw new Error(`cloud step failed: ${await page.textContent('#out-error')}`);
await wait(2500);
await mark('restored');
await wait(4500);

// what the cloud really wrote
await glideTo('#show-raw', 900);
await wait(250);
await mark('rawClick');
await click();
await wait(400);
await mark('rawOn');
await wait(4500);
await mark('rawOffClick');
await click();
await wait(1500);

// egress log
await mark('scroll');
await page.evaluate(() => document.querySelector('section.log')?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
await wait(1400);
run.scrolls.push({ t: now(), y: await page.evaluate(() => scrollY) });
await mark('logShown');
await glideTo('#log > li:first-child summary', 1000);
await wait(250);
await mark('logClick');
await click();
await wait(700);
await mark('logOpen');
await wait(6500);
await mark('end');

await cdp.send('Page.stopScreencast');
await wait(300);
run.landed = await page.evaluate(() => window.__landed);
run.summary = {
  chip,
  cloudChip: ((await page.textContent('#chip-cloud')) ?? '').replace(/\s+/g, ' ').trim(),
  entities,
  badge: (await page.textContent('#source-badge'))?.trim(),
  tallyReq: (await page.textContent('#tally-req'))?.trim(),
  tallyLeak: (await page.textContent('#tally-leak'))?.trim(),
  redact_s: +(run.marks.lockShown.t - run.marks.redactClick.t).toFixed(2),
  cloud_s: +(run.marks.answer.t - run.marks.sendClick.t).toFixed(2),
};
await context.close();
writeFileSync(join(rawDir, 'run.json'), JSON.stringify(run));
console.log(JSON.stringify(run.summary, null, 2));
console.log(`${run.frames.length} frames, ${(run.frames.at(-1).t - run.frames[0].t).toFixed(1)} s`);
