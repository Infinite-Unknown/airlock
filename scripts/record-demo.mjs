// Records a captioned screen capture of the running app to assets/demo.mp4.
// Usage: npm run dev (in another terminal), then: npm run demo [-- http://localhost:5173]
// Needs ffmpeg and a Playwright Chromium.
import { chromium } from 'playwright-core';
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const url = process.argv[2] || 'http://localhost:5173/';
const root = resolve(import.meta.dirname, '..');
const rawDir = join(root, 'assets', 'raw');
const framesDir = join(rawDir, 'frames');
const W = 1440;
const H = 900;
const FPS = 30;
rmSync(rawDir, { recursive: true, force: true });
mkdirSync(framesDir, { recursive: true });

// The recording browser (Playwright's Chromium) cannot run Gemini Nano. Its Prompt API is turned
// off so that pressing Redact does not start a multi-GB model download; the app then shows its
// "not available in this browser" path. Record the on-device step in Chrome with Gemini Nano.
// The keychain flags stop Chromium from asking the macOS keychain for a password.
const browser = await chromium.launch({
  headless: true,
  args: [
    '--disable-features=AIPromptAPI,OptimizationGuideOnDeviceModel',
    '--use-mock-keychain',
    '--password-store=basic',
  ],
});
const context = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
await context.addInitScript(() => {
  try {
    delete globalThis.LanguageModel;
  } catch {}
});
const page = await context.newPage();
const wait = (ms) => page.waitForTimeout(ms);

// ---- capture: CDP screencast frames (sharper than the built-in recorder), timed by their timestamps
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

// ---- overlays drawn with the app's own fonts and colours
const OVERLAY_CSS = `
  body{padding-bottom:150px !important}
  #__cap{position:fixed;left:50%;bottom:28px;z-index:99998;max-width:1080px;width:max-content;
    transform:translateX(-50%);display:flex;gap:14px;align-items:flex-start;
    background:#1d1f1c;color:#fffdf8;font:500 21px/1.45 'IBM Plex Sans',system-ui,sans-serif;
    padding:14px 24px 15px 20px;border-radius:14px;
    box-shadow:0 2px 4px rgba(0,0,0,.12),0 18px 40px -12px rgba(0,0,0,.35);
    transition:opacity 260ms cubic-bezier(.23,1,.32,1),transform 260ms cubic-bezier(.23,1,.32,1),filter 260ms ease}
  #__cap.out{opacity:0;transform:translateX(-50%) translateY(8px);filter:blur(3px)}
  #__cap i{flex:none;width:10px;height:10px;border-radius:50%;margin-top:10px;background:#7fc59a}
  #__cap[data-zone=out] i{background:#e9a54a}
  #__spot{position:fixed;z-index:99997;pointer-events:none;border-radius:12px;
    box-shadow:0 0 0 2px #8a4b08,0 0 0 8px rgba(138,75,8,.16);
    transition:opacity 220ms ease,transform 300ms cubic-bezier(.23,1,.32,1)}
  #__spot[data-zone=device]{box-shadow:0 0 0 2px #0f5132,0 0 0 8px rgba(15,81,50,.14)}
  #__spot.out{opacity:0;transform:scale(1.03)}
  #__card{position:fixed;inset:0;z-index:99999;background:#f4f2ec;display:grid;place-items:center;
    font-family:'IBM Plex Sans',system-ui,sans-serif;color:#1d1f1c;transition:opacity 500ms ease}
  #__card.out{opacity:0}
  #__card .in{width:1000px}
  #__card .brand{display:flex;align-items:center;gap:22px}
  #__card svg{width:84px;height:84px;color:#0f5132}
  #__card h1{font-size:96px;line-height:1;letter-spacing:-.03em;font-weight:600;margin:0}
  #__card h2{font-size:56px;line-height:1.1;letter-spacing:-.02em;font-weight:600;margin:0;display:block}
  #__card .demo{margin-top:48px;font:400 30px/1.7 'IBM Plex Sans',sans-serif;background:#fff;border:1px solid #dcd8cc;
    border-radius:14px;padding:22px 28px;box-shadow:0 1px 2px rgba(29,31,28,.04),0 8px 24px -12px rgba(29,31,28,.12)}
  #__card .demo .tok{font-size:24px;padding:3px 8px;border-radius:7px;vertical-align:2px}
  #__card p{font-size:28px;line-height:1.45;color:#5f625a;margin:28px 0 0}
  #__card p b{color:#1d1f1c;font-weight:600}
  #__card .meta{font-size:20px;color:#5f625a;margin-top:44px;display:flex;gap:12px;flex-wrap:wrap}
  #__card .meta span{border:1px solid #dcd8cc;background:#fffdf8;border-radius:999px;padding:6px 16px}
  #__card .fade{opacity:0;transform:translateY(8px);transition:opacity 500ms cubic-bezier(.23,1,.32,1),transform 500ms cubic-bezier(.23,1,.32,1)}
  #__card .fade.on{opacity:1;transform:none}
`;
const LOGO = `<svg viewBox="0 0 32 32" aria-hidden="true"><rect x="3" y="6" width="26" height="20" rx="5" fill="none" stroke="currentColor" stroke-width="2.2"/><path d="M16 6v20" stroke="currentColor" stroke-width="2.2" stroke-dasharray="3 3"/><circle cx="10" cy="16" r="2.6" fill="currentColor"/></svg>`;

async function installOverlays() {
  await page.addStyleTag({ content: OVERLAY_CSS });
}

async function caption(text, ms = 4000, zone = 'device') {
  await page.evaluate(
    async ([t, z]) => {
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
      el.dataset.zone = z;
      el.querySelector('span').textContent = t;
      el.classList.remove('out');
    },
    [text, zone],
  );
  await wait(ms);
}

async function hideCaption() {
  await page.evaluate(() => document.getElementById('__cap')?.classList.add('out'));
  await wait(250);
}

async function spotlight(selector, zone = 'out', pad = 8) {
  await page.evaluate(
    ([sel, z, p]) => {
      const t = document.querySelector(sel);
      if (!t) return;
      const r = t.getBoundingClientRect();
      let el = document.getElementById('__spot');
      if (!el) {
        el = document.createElement('div');
        el.id = '__spot';
        document.body.appendChild(el);
      }
      el.className = 'out';
      el.dataset.zone = z;
      Object.assign(el.style, { left: `${r.left - p}px`, top: `${r.top - p}px`, width: `${r.width + 2 * p}px`, height: `${r.height + 2 * p}px` });
      void el.offsetWidth;
      el.className = '';
    },
    [selector, zone, pad],
  );
}
async function clearSpotlight() {
  await page.evaluate(() => document.getElementById('__spot')?.classList.add('out'));
}

async function scrollTo(selector, block = 'center') {
  await page.evaluate(
    ([sel, b]) => document.querySelector(sel)?.scrollIntoView({ behavior: 'smooth', block: b }),
    [selector, block],
  );
  await wait(700);
}

async function card(html, ms) {
  await page.evaluate(
    ([h]) => {
      document.getElementById('__card')?.remove();
      const el = document.createElement('div');
      el.id = '__card';
      el.innerHTML = `<div class="in">${h}</div>`;
      document.body.appendChild(el);
      const fades = [...el.querySelectorAll('.fade')];
      fades.forEach((f, i) => setTimeout(() => f.classList.add('on'), 150 + i * 260));
    },
    [html],
  );
  await wait(ms);
}
async function closeCard() {
  await page.evaluate(() => document.getElementById('__card')?.classList.add('out'));
  await wait(520);
  await page.evaluate(() => document.getElementById('__card')?.remove());
}

/** Title-card version of the redaction sweep, using the app's own .strike / .tok styles. */
async function sweepCard() {
  await page.evaluate(async () => {
    const strikes = [...document.querySelectorAll('#__card .strike')];
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    strikes.forEach((s) => s.classList.add('lit'));
    await sleep(420);
    for (const s of strikes) {
      s.classList.add('struck');
      await sleep(230);
      const tok = document.createElement('span');
      tok.className = `tok t-${s.dataset.type}`;
      tok.textContent = s.dataset.tok;
      s.replaceWith(tok);
      tok.animate(
        [
          { opacity: 0, filter: 'blur(4px)', transform: 'scale(.9)' },
          { opacity: 1, filter: 'blur(0px)', transform: 'scale(1)' },
        ],
        { duration: 280, easing: 'cubic-bezier(.23,1,.32,1)' },
      );
      await sleep(160);
    }
  });
}

async function typeSlow(selector, text) {
  await page.click(selector);
  await page.keyboard.type(text, { delay: 28 });
}

// =====================================================================
await page.goto(url);
await page.evaluate(() => document.fonts.ready);
await installOverlays();
await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 92, maxWidth: W, maxHeight: H, everyNthFrame: 1 });

// ---- title card
await card(
  `<div class="brand fade">${LOGO}<h1>Airlock</h1></div>
   <div class="demo fade">Hello, this is <span class="strike" data-tok="[PERSON_1]" data-type="person">Aisyah binti Rahman</span>
     (IC <span class="strike" data-tok="[ID_NUMBER_1]" data-type="id_number">900101-14-5678</span>). Please WhatsApp me at
     <span class="strike" data-tok="[PHONE_1]" data-type="phone">+60 12-345 6789</span>.</div>
   <p class="fade"><b>Redact on your device. Let the cloud write. Put the real details back locally.</b><br/>
     For front desks, support and HR teams who paste personal data into cloud AI every day.</p>`,
  1500,
);
await sweepCard();
await wait(2600);
await closeCard();

// ---- the app, replaying its entrance
await page.evaluate(() =>
  document.querySelectorAll('.enter').forEach((e) => {
    e.classList.remove('enter');
    void e.offsetWidth;
    e.classList.add('enter');
  }),
);
await wait(900);
await caption('Airlock uses Firebase AI Logic hybrid inference: Gemini Nano on this device redacts, Gemini in the cloud writes.', 5000);

await spotlight('.status', 'out', 6);
const deviceChip = ((await page.textContent('#chip-device')) ?? '').replace(/\s+/g, ' ').trim();
const cloudChip = ((await page.textContent('#chip-cloud')) ?? '').replace(/\s+/g, ' ').trim();
const usedNano = /ready/.test(deviceChip);
const cloudOn = !/not configured/.test(cloudChip);
await caption(
  usedNano && cloudOn
    ? 'Status is checked live in this browser: Gemini Nano is ready, and the cloud model is configured.'
    : `Status is checked live in this browser. This recording: ${usedNano ? 'Gemini Nano ready' : 'no Gemini Nano'}, ${cloudOn ? 'cloud configured' : 'no Firebase project yet'}. Airlock says so up front.`,
  5500,
  'out',
);
await clearSpotlight();

await page.click('button[data-sample="clinic"]');
await spotlight('#input', 'device', 6);
await caption("A clinic front-desk message: a parent's name, IC number, phone, email and home address. All fictional.", 4500);
await clearSpotlight();

// ---- step 1: the redaction sweep
await hideCaption();
await spotlight('.panel.lock .panel-body', 'out', -4);
await wait(900);
await page.click('#btn-redact');
await wait(60);
await spotlight('#redacted', 'out', 6);
await wait(2200);
await caption(
  usedNano
    ? 'Step 1 runs on this device. Gemini Nano and local pattern rules find each detail, strike it out and swap in a placeholder.'
    : 'Step 1 runs on this device. Each detail found is struck out and swapped for a placeholder. Here only the local pattern rules ran: IC number, email, phone.',
  6000,
  'out',
);
await clearSpotlight();

if (!usedNano) {
  await scrollTo('#warn', 'start');
  await spotlight('#warn', 'out', 4);
  await caption('Without Gemini Nano, Airlock never falls back to the cloud for redaction. It warns you, and you hide the rest by hand.', 5500, 'out');
  await clearSpotlight();
  await hideCaption();
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'smooth' }));
  await wait(500);
  for (const [text, type] of [
    ['Aisyah binti Rahman', 'PERSON'],
    ['Daniel', 'PERSON'],
    ['Dr. Lim', 'PERSON'],
    ['12, Jalan Mawar 3, Taman Melati, 53100 Kuala Lumpur', 'ADDRESS'],
  ]) {
    await typeSlow('#add-text', text);
    await page.selectOption('#add-type', type);
    await page.click('#add-form button[type=submit]');
    await wait(900);
  }
  await scrollTo('.panel.lock', 'start');
  await spotlight('#redacted', 'out', 6);
  await caption('The middle panel is exactly what would leave this device: placeholders, no personal details.', 5000, 'out');
  await clearSpotlight();
  await page.check('#consent');
}

// ---- step 2 + 3
const canSend = await page.isEnabled('#btn-send');
if (canSend) {
  await caption('Step 2: only the redacted text is sent to Gemini in the cloud through Firebase AI Logic.', 3500, 'out');
  await page.click('#btn-send');
  await page.waitForSelector('#out-body:not(.hidden), #out-error:not(.hidden)', { timeout: 60000 });
  await wait(1200);
  await caption('Step 3: the answer comes back with placeholders, and the real details are filled in locally.', 5000);
  await page.check('#show-raw');
  await caption('Toggle to see exactly what the cloud model wrote. It never saw the real values.', 4500);
  await page.uncheck('#show-raw');
} else {
  await scrollTo('#btn-send', 'center');
  await spotlight('#btn-send', 'out', 6);
  const hint = (await page.textContent('#send-hint')) ?? '';
  await caption(`Step 2 would send only this redacted text to the cloud. In this recording it is switched off: "${hint}"`, 6000, 'out');
  await clearSpotlight();
}

// ---- egress log
await hideCaption();
await page.evaluate(() => window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' }));
await wait(900);
const logOpen = await page.$('#log details summary');
if (logOpen) await logOpen.click();
await spotlight('.log', 'device', 4);
const sent = ((await page.textContent('#tally-req')) ?? '0').trim();
await caption(
  sent === '0'
    ? 'The egress log records every request that leaves the device, with its full payload. In this session: nothing has left.'
    : 'The egress log records every request that left the device, with its full payload, and checks it for hidden details.',
  6000,
);
await clearSpotlight();
await hideCaption();

// ---- outro
await card(
  `<h2 class="fade">Why hybrid matters here</h2>
   <p class="fade"><b>The small on-device model is the privacy gate. The big cloud model does the hard writing.</b>
     Raw personal data never has to leave the device, and every request that does leave is logged.</p>
   <div class="meta fade"><span>Firebase AI Logic (firebase/ai)</span><span>Gemini Nano on-device</span><span>Gemini in the cloud</span><span>Web · Apache-2.0</span></div>`,
  6500,
);

const stopAt = Date.now() / 1000;
await cdp.send('Page.stopScreencast');
await wait(200);
await context.close();
await browser.close();

// ---- frames -> constant-frame-rate mp4
if (frames.length < 2) throw new Error('no frames captured');
const lines = ['ffconcat version 1.0'];
for (let i = 0; i < frames.length; i++) {
  // the last frame is held until the moment recording stopped
  const next = frames[i + 1]?.t ?? Math.max(stopAt, frames[i].t + 1 / FPS);
  const dur = Math.max(next - frames[i].t, 1 / 240);
  lines.push(`file '${frames[i].file}'`, `duration ${dur.toFixed(4)}`);
}
lines.push(`file '${frames[frames.length - 1].file}'`);
const list = join(rawDir, 'frames.ffconcat');
writeFileSync(list, lines.join('\n'));
const out = join(root, 'assets', 'demo.mp4');
execFileSync('ffmpeg', [
  '-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', list,
  '-vf', `fps=${FPS},scale=${W}:${H}:flags=lanczos,format=yuv420p`,
  '-c:v', 'libx264', '-preset', 'slow', '-crf', '18', '-movflags', '+faststart', out,
]);
console.log('wrote', out, `(${frames.length} frames)`);
