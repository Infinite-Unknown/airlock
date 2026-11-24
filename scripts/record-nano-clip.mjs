// Records the on-device redaction step in Google Chrome with Gemini Nano to assets/nano-clip.mp4.
// Usage: npm run dev, then: node scripts/record-nano-clip.mjs [http://localhost:5173/]
// Needs Google Chrome with Gemini Nano already downloaded in the .chrome-profile/ automation profile.
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { launchChrome } from './chrome.mjs';

const url = process.argv[2] || 'http://localhost:5173/';
const root = resolve(import.meta.dirname, '..');
const rawDir = join(root, 'assets', 'raw-nano');
const framesDir = join(rawDir, 'frames');
const W = 1440;
const H = 900;
const FPS = 30;
rmSync(rawDir, { recursive: true, force: true });
mkdirSync(framesDir, { recursive: true });

const context = await launchChrome({ viewport: { width: W, height: H } });
const page = context.pages()[0] ?? (await context.newPage());
const wait = (ms) => page.waitForTimeout(ms);

const frames = [];
const cdp = await context.newCDPSession(page);
cdp.on('Page.screencastFrame', async (f) => {
  const file = join(framesDir, `${String(frames.length).padStart(6, '0')}.jpg`);
  writeFileSync(file, Buffer.from(f.data, 'base64'));
  frames.push({ file, t: f.metadata.timestamp });
  try {
    await cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId });
  } catch {}
});

const CSS = `
  body{padding-bottom:150px !important}
  #__cap{position:fixed;left:50%;bottom:28px;z-index:99998;max-width:1080px;width:max-content;
    transform:translateX(-50%);display:flex;gap:14px;align-items:flex-start;
    background:#1d1f1c;color:#fffdf8;font:500 21px/1.45 'IBM Plex Sans',system-ui,sans-serif;
    padding:14px 24px 15px 20px;border-radius:14px;box-shadow:0 2px 4px rgba(0,0,0,.12),0 18px 40px -12px rgba(0,0,0,.35);
    transition:opacity 260ms cubic-bezier(.23,1,.32,1),transform 260ms cubic-bezier(.23,1,.32,1)}
  #__cap.out{opacity:0;transform:translateX(-50%) translateY(8px)}
  #__cap i{flex:none;width:10px;height:10px;border-radius:50%;margin-top:10px;background:#7fc59a}
  #__spot{position:fixed;z-index:99997;pointer-events:none;border-radius:12px;
    box-shadow:0 0 0 2px #0f5132,0 0 0 8px rgba(15,81,50,.14);transition:opacity 220ms ease}
  #__spot.out{opacity:0}`;

async function caption(text, ms) {
  await page.evaluate(async (t) => {
    let el = document.getElementById('__cap');
    if (el) {
      el.classList.add('out');
      await new Promise((r) => setTimeout(r, 200));
    } else {
      el = document.createElement('div');
      el.id = '__cap';
      el.className = 'out';
      el.innerHTML = '<i></i><span></span>';
      document.body.appendChild(el);
      void el.offsetWidth;
    }
    el.querySelector('span').textContent = t;
    el.classList.remove('out');
  }, text);
  await wait(ms);
}
async function spotlight(sel, pad = 6) {
  await page.evaluate(([s, p]) => {
    const r = document.querySelector(s)?.getBoundingClientRect();
    if (!r) return;
    let el = document.getElementById('__spot');
    if (!el) {
      el = document.createElement('div');
      el.id = '__spot';
      document.body.appendChild(el);
    }
    Object.assign(el.style, { left: `${r.left - p}px`, top: `${r.top - p}px`, width: `${r.width + 2 * p}px`, height: `${r.height + 2 * p}px` });
    el.className = '';
  }, [sel, pad]);
}
const clearSpot = () => page.evaluate(() => document.getElementById('__spot')?.classList.add('out'));

await page.goto(url);
await page.evaluate(() => document.fonts.ready);
// The chip starts on its no-API text and updates when Chrome answers the availability check.
await page.waitForFunction(() => /ready/i.test(document.querySelector('#chip-device')?.textContent ?? ''), null, { timeout: 20000 }).catch(() => {});
const chip = ((await page.textContent('#chip-device')) ?? '').replace(/\s+/g, ' ').trim();
if (!/ready/i.test(chip)) throw new Error(`Gemini Nano is not ready in this Chrome profile: "${chip}"`);
// Warm-up off camera: the first prompt of a fresh Gemini Nano session is slower (about 15 s here
// against 5 to 7 s once warm). Run one redaction on another sample, then reload.
await page.click('button[data-sample="support"]');
await page.click('#btn-redact');
await page.waitForFunction(() => !document.querySelector('#lock-body')?.classList.contains('hidden') && !document.querySelector('#btn-redact')?.disabled, null, { timeout: 120000 });
await page.reload();
await page.evaluate(() => document.fonts.ready);
await page.waitForFunction(() => /ready/i.test(document.querySelector('#chip-device')?.textContent ?? ''), null, { timeout: 20000 });
await page.addStyleTag({ content: CSS });
await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 92, maxWidth: W, maxHeight: H, everyNthFrame: 1 });

await spotlight('#chip-device');
await caption('In Google Chrome with Gemini Nano downloaded, the on-device model is ready.', 3200);
await clearSpot();
await page.click('button[data-sample="clinic"]');
await caption('Same clinic message. Step 1 now runs Gemini Nano through Firebase AI Logic, on this device.', 2500);
const t0 = Date.now();
await page.click('#btn-redact');
await page.waitForSelector('#lock-body:not(.hidden)', { timeout: 120000 });
const secs = ((Date.now() - t0) / 1000).toFixed(1);
await wait(1800);
await spotlight('#redacted');
const found = await page.$$eval('#entities li', (els) =>
  els.map((e) => ({ src: e.querySelector('.src')?.textContent?.trim() ?? '', tok: e.querySelector('.tok')?.textContent?.trim() ?? '' })),
);
const nano = found.filter((f) => /nano/i.test(f.src));
const nanoCount = nano.length;
const kinds = [...new Set(nano.map((f) => f.tok.replace(/^\[|_\d+\]$/g, '').toLowerCase().replace('_', ' ')))];
await caption(
  nanoCount
    ? `In ${secs} s, with no manual hiding: Gemini Nano marked ${nanoCount} details (${kinds.join(', ')}); pattern rules added ${found.length - nanoCount}.`
    : `Redaction finished in ${secs} s; pattern rules marked ${found.length} details.`,
  5000,
);
await clearSpot();
await spotlight('#entities');
await caption('Each hidden detail says who found it: Gemini Nano or a pattern rule. Nothing has left the device.', 4200);
await clearSpot();
await page.evaluate(() => document.getElementById('__cap')?.classList.add('out'));
await wait(400);

const stopAt = Date.now() / 1000;
await cdp.send('Page.stopScreencast');
await wait(200);
const summary = {
  chip,
  seconds: secs,
  nanoCount,
  redacted: await page.textContent('#redacted'),
  entities: await page.$$eval('#entities li', (els) => els.map((e) => e.textContent.replace(/\s+/g, ' ').trim())),
  requestsSent: ((await page.textContent('#tally-req')) ?? '').trim(),
};
await context.close();

const lines = ['ffconcat version 1.0'];
for (let i = 0; i < frames.length; i++) {
  const next = frames[i + 1]?.t ?? Math.max(stopAt, frames[i].t + 1 / FPS);
  lines.push(`file '${frames[i].file}'`, `duration ${Math.max(next - frames[i].t, 1 / 240).toFixed(4)}`);
}
lines.push(`file '${frames[frames.length - 1].file}'`);
const list = join(rawDir, 'frames.ffconcat');
writeFileSync(list, lines.join('\n'));
const out = join(root, 'assets', 'nano-clip.mp4');
execFileSync('ffmpeg', [
  '-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', list,
  '-vf', `fps=${FPS},scale=${W}:${H}:flags=lanczos,format=yuv420p`,
  '-c:v', 'libx264', '-preset', 'slow', '-crf', '18', '-movflags', '+faststart', out,
]);
console.log(JSON.stringify(summary, null, 2));
console.log('wrote', out, `(${frames.length} frames)`);
