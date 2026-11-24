// Records a captioned screen capture of the running app to assets/demo.mp4.
// Usage: npm run dev (in another terminal), then: npm run demo [-- http://localhost:5173]
import { chromium } from 'playwright-core';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readdirSync, renameSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';

const url = process.argv[2] || 'http://localhost:5173/';
const root = resolve(import.meta.dirname, '..');
const rawDir = join(root, 'assets', 'raw');
const W = 1440;
const H = 900;
rmSync(rawDir, { recursive: true, force: true });
mkdirSync(rawDir, { recursive: true });

// The recording browser (Playwright's Chromium) cannot run Gemini Nano. Its Prompt API is turned
// off so that pressing Redact does not start a multi-GB model download; the app then shows its
// "not available in this browser" path. Record the on-device step in Chrome with Gemini Nano.
const browser = await chromium.launch({
  headless: true,
  args: ['--disable-features=AIPromptAPI,OptimizationGuideOnDeviceModel'],
});
const context = await browser.newContext({
  viewport: { width: W, height: H },
  deviceScaleFactor: 1,
  recordVideo: { dir: rawDir, size: { width: W, height: H } },
});
await context.addInitScript(() => {
  try {
    delete globalThis.LanguageModel;
  } catch {}
});
const page = await context.newPage();
const wait = (ms) => page.waitForTimeout(ms);

async function caption(text, ms = 3500) {
  await page.evaluate((t) => {
    let el = document.getElementById('__demo_caption');
    if (!el) {
      el = document.createElement('div');
      el.id = '__demo_caption';
      el.style.cssText =
        'position:fixed;left:50%;bottom:28px;transform:translateX(-50%);max-width:1000px;z-index:99999;' +
        'background:rgba(20,22,20,.88);color:#fff;font:500 20px/1.4 system-ui,sans-serif;padding:12px 20px;' +
        'border-radius:10px;text-align:center;box-shadow:0 6px 24px rgba(0,0,0,.25)';
      document.body.appendChild(el);
    }
    el.textContent = t;
  }, text);
  await wait(ms);
}

async function card(title, lines, ms = 5000) {
  await page.setContent(`<!doctype html><html><body style="margin:0;height:100vh;display:grid;place-items:center;
    background:#f4f2ec;font-family:system-ui,sans-serif;color:#1d1f1c">
    <div style="max-width:980px;padding:40px">
      <div style="font-size:56px;font-weight:700;letter-spacing:-.02em">${title}</div>
      ${lines.map((l) => `<p style="font-size:26px;line-height:1.45;color:#444;margin:18px 0 0">${l}</p>`).join('')}
    </div></body></html>`);
  await wait(ms);
}

async function typeSlow(selector, text) {
  await page.click(selector);
  await page.keyboard.type(text, { delay: 35 });
}

// ---- intro
await card('Airlock', [
  'Support staff, clinic desks and HR teams paste messages full of names, IC numbers and phone numbers into cloud AI every day.',
  'Airlock redacts that personal data on the device first, lets a cloud model do the writing, then puts the real details back locally.',
]);

// ---- app
await page.goto(url);
await wait(1500);
await caption('Firebase AI Logic hybrid inference: Gemini Nano on-device for redaction, Gemini in the cloud for writing.', 4500);
const deviceChip = (await page.textContent('#chip-device')) ?? '';
const cloudChip = (await page.textContent('#chip-cloud')) ?? '';
await caption(`Status, checked live in this browser: "${deviceChip}" and "${cloudChip}".`, 4500);

await page.click('button[data-sample="clinic"]');
await caption('A clinic front-desk message, with a fictional parent\'s name, IC number, phone, email and home address.', 4000);

await page.click('#btn-redact');
await wait(800);
const usedNano = deviceChip.includes('ready');
await caption(
  usedNano
    ? 'Step 1 runs on this device: Gemini Nano plus local pattern rules mark every personal detail.'
    : 'Step 1 runs on this device. Gemini Nano is not available in this recording browser, so only the local pattern rules ran: IC number, email and phone are hidden.',
  5500,
);
if (!usedNano) {
  await caption('Airlock does not quietly fall back to the cloud for redaction. It warns, and asks you to hide the rest yourself.', 5000);
  for (const [text, type] of [
    ['Aisyah binti Rahman', 'PERSON'],
    ['Daniel', 'PERSON'],
    ['Dr. Lim', 'PERSON'],
    ['SK Taman Melati', 'ORGANIZATION'],
    ['12, Jalan Mawar 3, Taman Melati, 53100 Kuala Lumpur', 'ADDRESS'],
  ]) {
    await typeSlow('#add-text', text);
    await page.selectOption('#add-type', type);
    await page.click('#add-form button[type=submit]');
    await wait(500);
  }
  await caption('Every hidden detail becomes a placeholder. The middle panel is exactly what will leave this device.', 4500);
  await page.check('#consent');
}

const canSend = await page.isEnabled('#btn-send');
if (canSend) {
  await caption('Step 2: only the redacted text is sent to Gemini in the cloud through Firebase AI Logic.', 3500);
  await page.click('#btn-send');
  await page.waitForSelector('#out-body:not(.hidden), #out-error:not(.hidden)', { timeout: 60000 });
  await wait(800);
  await caption('Step 3: the answer comes back with placeholders, and the real details are filled in locally.', 5000);
  await page.check('#show-raw');
  await caption('Toggle to see exactly what the cloud model wrote. It never saw the real values.', 4500);
  await page.uncheck('#show-raw');
  await page.click('#log details summary');
  await page.evaluate(() => document.querySelector('.log')?.scrollIntoView({ behavior: 'smooth' }));
  await caption('The egress log records every request that left the device, with its full payload.', 5000);
} else {
  const hint = (await page.textContent('#send-hint')) ?? '';
  await caption(`Step 2 is the cloud call. In this recording it is switched off: "${hint}"`, 6000);
}

// ---- outro
await card('Why hybrid matters here', [
  'The small on-device model is the privacy gate. The big cloud model does the hard writing. Raw personal data never has to leave the device.',
  'Built with Firebase AI Logic (firebase/ai) on the web, Apache-2.0.',
], 6000);

await context.close();
await browser.close();

const webm = readdirSync(rawDir).find((f) => f.endsWith('.webm'));
if (!webm) throw new Error('no video recorded');
const out = join(root, 'assets', 'demo.mp4');
execFileSync('ffmpeg', [
  '-y', '-loglevel', 'error', '-i', join(rawDir, webm),
  '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-preset', 'medium', '-crf', '22', '-movflags', '+faststart', out,
]);
renameSync(join(rawDir, webm), join(rawDir, 'last.webm'));
console.log('wrote', out);
