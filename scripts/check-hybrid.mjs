// End-to-end check of the hybrid modes in Google Chrome with Gemini Nano (.chrome-profile/):
// redaction on device, quick triage (PREFER_ON_DEVICE), a reply in Bahasa Melayu (PREFER_IN_CLOUD),
// then the same writer with the cloud blocked (simulated outage) falling back to Gemini Nano.
// Prints what each step reported and every request that reached a Gemini endpoint.
// Usage: npm run dev -- --port 5397, then: node scripts/check-hybrid.mjs [url] [screenshot-dir]
import { launchChrome } from './chrome.mjs';

const url = process.argv[2] || 'http://localhost:5397/';
const shots = process.argv[3];
const ctx = await launchChrome({ viewport: { width: 1440, height: 900 } });
const page = ctx.pages()[0] ?? (await ctx.newPage());
const sent = [];
page.on('request', (r) => {
  if (/generateContent/.test(r.url())) sent.push({ url: r.url().replace(/\?.*/, ''), body: r.postData() ?? '' });
});
const text = async (sel) => ((await page.textContent(sel)) ?? '').replace(/\s+/g, ' ').trim();
const shot = async (name) => shots && page.screenshot({ path: `${shots}/${name}.png` });
await page.goto(url);
await page.waitForFunction(() => !/checking/i.test(document.querySelector('#chip-device')?.textContent ?? ''));
await page.waitForTimeout(3500); // Remote Config fetch
console.log('device chip:', await text('#chip-device'));
console.log('cloud chip :', await text('#chip-cloud'), '|', await page.getAttribute('#chip-cloud', 'title'));

await page.click('button[data-sample="clinic"]');
await page.click('#btn-redact');
await page.waitForFunction(() => !document.querySelector('#lock-body')?.classList.contains('hidden') && !document.querySelector('#btn-redact')?.disabled, null, { timeout: 120000 });
await page.waitForTimeout(3000);
const hidden = await page.$$eval('#entities li', (els) => els.map((e) => `${e.querySelector('.tok')?.textContent} ${e.querySelector('.val')?.textContent} [${e.querySelector('.src')?.textContent}]`));
console.log('hidden:', hidden);
const values = await page.$$eval('#entities li .val', (els) => els.map((e) => e.textContent));
await shot('1-redacted');

async function run(task) {
  await page.selectOption('#task', task);
  const before = sent.length;
  const mode = await text('#mode-hint');
  const button = await text('#btn-send .lbl');
  const t0 = Date.now();
  await page.click('#btn-send');
  await page.waitForFunction(() => !document.querySelector('#btn-send')?.classList.contains('busy') && (!document.querySelector('#out-body')?.classList.contains('hidden') || !document.querySelector('#out-error')?.classList.contains('hidden')), null, { timeout: 120000 });
  await page.waitForTimeout(800);
  const err = (await page.isVisible('#out-error')) ? await text('#out-error') : null;
  const req = sent.slice(before).map((r) => ({ url: r.url, leaked: values.filter((v) => r.body.toLowerCase().includes(v.toLowerCase())) }));
  console.log(`\n[${task}] mode: ${mode}\n  button: ${button}; took ${((Date.now() - t0) / 1000).toFixed(1)} s\n  badge: ${await text('#source-badge')}\n  result: ${err ?? (await text('#result')).slice(0, 400)}\n  requests to generateContent: ${JSON.stringify(req)}`);
  console.log('  log:', await page.$$eval('#log > li summary', (els) => els.map((e) => e.textContent.replace(/\s+/g, ' ').trim())));
  console.log('  tally: sent', await text('#tally-req'), '/ hidden details sent', await text('#tally-leak'));
}
await run('triage');
await shot('2-triage');
await run('reply_ms');
await shot('3-reply-ms');
await page.check('#outage');
console.log('\noutage on; cloud chip:', await text('#chip-cloud'));
await run('reply');
await shot('4-fallback');
await ctx.close();
