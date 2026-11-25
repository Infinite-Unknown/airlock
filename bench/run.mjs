// Redaction benchmark: runs the app's on-device step over the labelled synthetic dataset and scores it.
//   (a) pattern rules only      - runs in Node, no browser needed
//   (b) rules + Gemini Nano     - the app's real detect() in Google Chrome through Firebase AI Logic
//                                 (ONLY_ON_DEVICE), in the .chrome-profile/ automation profile
// Usage: node bench/run.mjs [--set dataset|heldout] [--rules-only] [--nano-only] [--tag v2] [--limit N]
// Writes bench/results/<set>.<rules|nano>.<tag>.json; bench/report.mjs turns those into bench/RESULTS.md.
import { createServer } from 'vite';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { aggregate, percentiles, scoreMessage, CATEGORIES } from './score.mjs';

const root = resolve(import.meta.dirname, '..');
const args = process.argv.slice(2);
const opt = (k, d) => (args.includes(k) ? args[args.indexOf(k) + 1] : d);
const set = opt('--set', 'dataset');
const tag = opt('--tag', 'latest');
const limit = Number(opt('--limit', Infinity));
const data = JSON.parse(readFileSync(join(import.meta.dirname, `${set}.json`), 'utf8'));
const messages = data.messages.slice(0, limit);
const resultsDir = join(import.meta.dirname, 'results');
mkdirSync(resultsDir, { recursive: true });

const server = await createServer({ root, logLevel: 'error', server: { port: 0, host: '127.0.0.1' } });
await server.listen();
const { detectWithRules } = await server.ssrLoadModule('/src/rules.ts');
const { mergeEntities, occurrences, redact, findLeaks } = await server.ssrLoadModule('/src/redact.ts');

function summarise(kind, perMessage, extra = {}) {
  const rows = perMessage.map((p) => ({ msg: messages.find((m) => m.id === p.id), score: p.score }));
  const agg = aggregate(rows);
  const out = { set, kind, tag, date: new Date().toISOString(), messages: messages.length, labels: agg.overall.n, ...extra, summary: agg, perMessage };
  const file = join(resultsDir, `${set}.${kind}.${tag}.json`);
  writeFileSync(file, JSON.stringify(out, null, 1));
  const o = agg.overall;
  console.log(`\n${kind} (${set}, ${tag}): ${o.hidden}/${o.n} values hidden (recall ${o.recall.toFixed(1)}%), precision ${o.precision.toFixed(1)}%, ${o.reachedCloud} values with some part in the cloud payload, ${agg.cleanMessages}/${messages.length} messages fully clean`);
  for (const c of CATEGORIES) {
    const b = agg.byCategory[c];
    console.log(`  ${c.padEnd(15)} ${String(b.hidden).padStart(4)}/${String(b.n).padEnd(4)} recall ${b.recall.toFixed(1).padStart(5)}%  precision ${Number.isNaN(b.precision) ? '  n/a' : b.precision.toFixed(1).padStart(5) + '%'}`);
  }
  console.log(`  wrote ${file}`);
  return out;
}

/** Cross-check: a value scored as hidden must not appear in the text the app would actually send. */
function crossCheck(msg, entities, score) {
  const r = redact(msg.text, entities);
  let bad = 0;
  for (const l of score.labels) if (l.state === 'hidden' && findLeaks(r.redacted, [{ value: l.value }]).length) bad++;
  return { redacted: r.redacted, mismatches: bad };
}

// ---------- (a) pattern rules only
if (!args.includes('--nano-only')) {
  const per = messages.map((msg) => {
    const entities = mergeEntities(msg.text, detectWithRules(msg.text));
    const score = scoreMessage(msg, entities, occurrences);
    const cc = crossCheck(msg, entities, score);
    return { id: msg.id, entities, score, redacted: cc.redacted, mismatches: cc.mismatches };
  });
  summarise('rules', per, { mismatches: per.reduce((n, p) => n + p.mismatches, 0) });
}

// ---------- (b) rules + Gemini Nano in Chrome
if (!args.includes('--rules-only')) {
  const { launchChrome } = await import('../scripts/chrome.mjs');
  const port = server.config.server.port === 0 ? server.httpServer.address().port : server.config.server.port;
  const context = await launchChrome({ viewport: { width: 900, height: 600 } });
  const page = context.pages()[0] ?? (await context.newPage());
  const external = [];
  page.on('request', (r) => {
    const u = new URL(r.url());
    if (!['127.0.0.1', 'localhost'].includes(u.hostname)) external.push({ host: u.hostname, path: u.pathname });
  });
  await page.goto(`http://127.0.0.1:${port}/bench/page.html`);
  await page.waitForFunction(() => window.benchStatus !== undefined, null, { timeout: 30000 });
  const status = await page.evaluate(() => window.benchStatus);
  const chrome = await page.evaluate(() => navigator.userAgentData?.brands?.map((b) => `${b.brand} ${b.version}`).join(', ') ?? navigator.userAgent);
  console.log(`\nChrome: ${chrome}\nGemini Nano: ${status}`);
  if (status !== 'available') {
    console.log('Gemini Nano is not available in this Chrome profile; skipping the rules + Gemini Nano run.');
  } else {
    const per = [];
    let i = 0;
    for (const msg of messages) {
      const r = await page.evaluate((t) => window.benchDetect(t), msg.text);
      i++;
      // A failed on-device call sends nothing in the app; here it is scored as rules only (the worse case for recall).
      const entities = r.error ? mergeEntities(msg.text, detectWithRules(msg.text)) : r.entities;
      const score = scoreMessage(msg, entities, occurrences);
      const cc = crossCheck(msg, entities, score);
      per.push({ id: msg.id, ms: r.ms, error: r.error, source: r.source, raw: r.raw, entities, score, redacted: cc.redacted, mismatches: cc.mismatches });
      if (i % 10 === 0 || i === messages.length) process.stdout.write(`  ${i}/${messages.length} (${(r.ms / 1000).toFixed(1)} s)\n`);
    }
    const times = per.filter((p) => !p.error).map((p) => p.ms);
    const latency = { cold: times[0], warm: percentiles(times.slice(1)) };
    const cloudCalls = external.filter((e) => /generateContent|streamGenerateContent/.test(e.path)).length;
    const sources = per.reduce((m, p) => ((m[p.source ?? (p.error ? 'error' : 'none')] = (m[p.source ?? (p.error ? 'error' : 'none')] ?? 0) + 1), m), {});
    summarise('nano', per, {
      chrome,
      latency,
      errors: per.filter((p) => p.error).length,
      inferenceSources: sources,
      network: { external: external.length, hosts: [...new Set(external.map((e) => e.host))], generateContentCalls: cloudCalls },
      mismatches: per.reduce((n, p) => n + p.mismatches, 0),
    });
    console.log(`  latency: first call ${(latency.cold / 1000).toFixed(2)} s; then median ${(latency.warm.median / 1000).toFixed(2)} s, p95 ${(latency.warm.p95 / 1000).toFixed(2)} s (n=${latency.warm.n})`);
    console.log(`  inferenceSource: ${JSON.stringify(sources)}; requests to generateContent during the run: ${cloudCalls}; other external hosts: ${[...new Set(external.map((e) => e.host))].join(', ') || 'none'}`);
  }
  await context.close();
}
await server.close();
