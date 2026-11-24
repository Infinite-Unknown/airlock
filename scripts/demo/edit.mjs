// Cuts the raw recording (assets/raw-launch/, from scripts/demo/record.mjs) and the voice-over
// (scripts/demo/voiceover.mjs) into assets/demo.mp4: eased zoom-to-focus camera over the 2x capture,
// drawn cursor with click ripples, fading captions, title and end cards, loudness-normalised audio.
// Every camera target comes from element rectangles logged during the recording.
// Usage: node scripts/demo/edit.mjs [--preview 12.5,40] [--jobs 4]
//   --preview renders only the listed output times to assets/raw-launch/preview/*.jpg
import { chromium } from 'playwright-core';
import { execFileSync } from 'node:child_process';
import { createReadStream, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..', '..');
const rawDir = join(root, 'assets', 'raw-launch');
const run = JSON.parse(readFileSync(join(rawDir, 'run.json'), 'utf8'));
const durations = JSON.parse(readFileSync(join(rawDir, 'vo', 'durations.json'), 'utf8'));
const lines = Object.fromEntries(JSON.parse(readFileSync(join(root, 'scripts', 'demo', 'voiceover.json'), 'utf8')).map((l) => [l.id, l.text]));
const args = process.argv.slice(2);
const opt = (k) => (args.includes(k) ? args[args.indexOf(k) + 1] : undefined);
const FPS = 60;
const VW = run.viewport.width; // 1600 CSS px
const VH = run.viewport.height; // 900
const SCALE = run.scale; // 2
const ZMAX = 2.2;

// ---------- source clock: seconds from the first captured frame
const t0 = run.frames[0].t;
const frames = run.frames.map((f) => ({ file: f.file, t: f.t - t0 }));
const M = Object.fromEntries(Object.entries(run.marks).map(([k, v]) => [k, v.t - t0]));
const R = (name, at) => {
  const r = run.marks[at].rects[name];
  if (!r) throw new Error(`no rect ${name} at ${at}`);
  return r;
};
const mv = run.moves.map((m) => ({ ...m, t0: m.t0 - t0, t1: m.t1 - t0 }));
const clicks = run.clicks.map((c) => ({ ...c, t: c.t - t0 }));
function frameAt(src) {
  let lo = 0;
  let hi = frames.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (frames[mid].t <= src + 1e-4) lo = mid;
    else hi = mid - 1;
  }
  return frames[lo].file;
}

// ---------- easing and camera geometry (CSS px of the recorded viewport)
const inOutCubic = (u) => (u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2);
const outQuint = (u) => 1 - Math.pow(1 - Math.min(1, Math.max(0, u)), 5);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const union = (...rs) => {
  const x = Math.min(...rs.map((r) => r.x));
  const y = Math.min(...rs.map((r) => r.y));
  return { x, y, w: Math.max(...rs.map((r) => r.x + r.w)) - x, h: Math.max(...rs.map((r) => r.y + r.h)) - y };
};
/** View (x, y, w) that frames rect r with padding, zoom capped at ZMAX, kept inside the viewport. */
function fit(r, pad = 32, zmax = ZMAX) {
  const z = clamp(Math.min(VW / (r.w + 2 * pad), VH / (r.h + 2 * pad)), 1, zmax);
  const w = VW / z;
  const h = VH / z;
  return { x: clamp(r.x + r.w / 2 - w / 2, 0, VW - w), y: clamp(r.y + r.h / 2 - h / 2, 0, VH - h), w };
}
const WIDE = { x: 0, y: 0, w: VW };

// ---------- timeline
const segs = []; // {a, b, t0, t1, hook}
const vos = []; // {id, t, d}
const camKeys = []; // {t, dur, to}
const labels = []; // {t0, t1, text, zone}
const cards = {}; // title / end: {t0, t1}
const zoneOf = {};
let T = 0;
const seg = (a, b, dur, extra = {}) => {
  segs.push({ a, b, t0: T, t1: T + dur, ...extra });
  T += dur;
};
const play = (a, b) => seg(a, b, b - a);
const holdUntil = (a, b, until) => seg(a, b, Math.max(0.05, until - T));
function out(src) {
  for (const s of segs) {
    if (s.hook) continue;
    if (src >= s.a && src <= s.b && s.b > s.a) return s.t0 + ((src - s.a) / (s.b - s.a)) * (s.t1 - s.t0);
  }
  throw new Error(`source time ${src} not in the cut`);
}
const vo = (id, t, zone = 'device') => {
  vos.push({ id, t, d: durations[id] });
  zoneOf[id] = zone;
  return t + durations[id];
};
const voEnd = (id) => {
  const v = vos.find((x) => x.id === id);
  return v.t + v.d;
};
const cam = (t, dur, to) => camKeys.push({ t, dur, to });

// S0 hook: the redaction sweep, zoomed in, real time
const hookA = M.lockShown - 0.35;
seg(hookA, hookA + 4.3, 4.3, { hook: true });
cam(0, 0, fit(R('redacted', 'sweepEnd'), 18));
cam(1.6, 2.6, fit(union(R('redacted', 'sweepEnd'), R('subHead', 'sweepEnd')), 34));
vo('hook', 0.3, 'out');

// title card over the opening frame of the app
cards.title = { t0: 3.8 };
const startFrame = M.start + 0.9;
cam(4.3, 0, WIDE);
vo('title', voEnd('hook') + 0.45);
cards.title.t1 = voEnd('title') + 1.0;
holdUntil(startFrame, startFrame + 0.001, cards.title.t1 + 0.1);

// S2 the problem: load the clinic sample
const pStart = T;
vo('problem1', pStart + 0.25);
play(startFrame + 0.001, mv[0].t0);
play(mv[0].t0, M.sample + 0.8);
cam(out(M.sampleClick) + 0.25, 1.2, fit(union(R('samples', 'sample'), R('input', 'sample')), 30));
vo('problem2', voEnd('problem1') + 0.35);
holdUntil(M.sample + 0.8, mv[1].t0, voEnd('problem2') + 0.3);

// S3 status chips
const sStart = T;
play(mv[1].t0, mv[1].t1 + 0.3);
cam(sStart - 0.05, 1.2, fit(R('status', 'chips'), 44, 1.8));
vo('status', sStart + 0.2);
holdUntil(mv[1].t1 + 0.3, mv[2].t0, voEnd('status') + 0.35);

// S4 step 1, redaction on the device (real time, no cuts)
const rStart = T;
cam(rStart, 1.2, fit(union(R('input', 'redactClick'), R('redact', 'redactClick'), R('redacted', 'sweepEnd')), 24));
play(mv[2].t0, M.redactClick);
vo('redact1', out(M.redactClick) - 0.55);
play(M.redactClick, M.lockShown);
labels.push({ t0: out(M.redactClick) + 0.25, t1: out(M.lockShown) + 0.1, text: 'Gemini Nano is reading the message on this device · real time', zone: 'device' });
cam(out(M.redactClick) + 0.5, 1.2, fit(R('redacted', 'sweepEnd'), 22));
play(M.lockShown, M.sweepEnd);
vo('redact2', Math.max(voEnd('redact1') + 0.3, out(M.lockShown) + 0.3));
holdUntil(M.sweepEnd, mv[3].t0, voEnd('redact2') + 0.3);

// S5 review: what the cloud will see
const vStart = T;
cam(vStart - 0.1, 1.1, fit(union(R('redacted', 'entities'), R('entities', 'entities')), 28));
vo('review1', vStart + 0.1, 'out');
play(mv[3].t0, mv[3].t1 + 0.2);
vo('review2', voEnd('review1') + 0.35, 'out');
cam(voEnd('review1') + 0.1, 1.1, fit(R('entities', 'entities'), 20));
holdUntil(mv[3].t1 + 0.2, mv[4].t0, voEnd('review2') + 0.35);

// S6 send to the cloud, answer restored locally
const cStart = T;
cam(cStart - 0.1, 1.2, fit(union(R('send', 'entities'), R('panelOut', 'entities')), 16));
vo('send1', cStart + 0.15, 'out');
play(mv[4].t0, mv[4].t1 + 0.25);
// rest on the button so the answer lands as the sentence ends
holdUntil(mv[4].t1 + 0.25, M.sendClick - 0.03, Math.max(T + 0.4, voEnd('send1') - (M.answer - M.sendClick) - 0.2));
play(M.sendClick - 0.03, M.answer);
labels.push({ t0: out(M.sendClick) + 0.2, t1: out(M.answer) + 0.1, text: 'Waiting for Gemini in the cloud · real time', zone: 'out' });
cam(out(M.answer) - 0.5, 1.1, fit(union(R('badge', 'restored'), R('result', 'restored')), 22));
vo('send2', Math.max(voEnd('send1') + 0.3, out(M.answer) + 0.15));
play(M.answer, M.restored);
holdUntil(M.restored, mv[5].t0, voEnd('send2') + 0.3);

// S7 what the cloud really wrote
const wStart = T;
vo('raw', wStart + 0.1, 'out');
play(mv[5].t0, M.rawOn);
holdUntil(M.rawOn, M.rawOffClick - 0.02, voEnd('raw') + 0.2);
play(M.rawOffClick - 0.02, M.scroll);

// S8 egress log
const lStart = T;
cam(lStart - 0.1, 1.1, WIDE);
vo('log1', lStart + 0.2);
play(M.scroll, M.logOpen);
cam(out(M.logClick) + 0.15, 1.1, fit(union(R('logHead', 'logOpen'), R('logPayload', 'logOpen')), 16));
holdUntil(M.logOpen, M.logOpen + 0.5, voEnd('log1') + 0.3);
vo('log2', T);
{
  const tally = R('tally', 'logOpen');
  const sum = R('logSummary', 'logOpen');
  cam(T - 0.35, 1.0, fit({ x: 1000, y: tally.y - 8, w: sum.x + sum.w - 1000, h: sum.y + sum.h - tally.y + 16 }, 26));
}
holdUntil(M.logOpen + 0.5, M.end, voEnd('log2') + 0.9);

// S9 end card
cards.end = { t0: T - 0.5 };
vo('close1', T + 0.35);
vo('close2', voEnd('close1') + 0.45);
holdUntil(M.end, M.end + 0.001, voEnd('close2') + 1.6);
cards.end.t1 = T + 10;
const TOTAL = T;

// overlap checks
vos.sort((a, b) => a.t - b.t);
for (let i = 1; i < vos.length; i++) if (vos[i].t < vos[i - 1].t + vos[i - 1].d + 0.15) console.warn('voice-over overlap:', vos[i - 1].id, vos[i].id);
camKeys.sort((a, b) => a.t - b.t);
for (let i = 1; i < camKeys.length; i++) {
  const p = camKeys[i - 1];
  if (camKeys[i].t < p.t + p.dur) {
    console.warn(`camera move at ${camKeys[i].t.toFixed(2)} starts before the previous ends; delayed`);
    camKeys[i].t = p.t + p.dur;
  }
}

// captions: one sentence at a time, timed by character share within its line; none on cards
const NO_CAPTION = new Set(['title', 'close1', 'close2']);
const captions = [];
for (const v of vos) {
  if (NO_CAPTION.has(v.id)) continue;
  const parts = lines[v.id].match(/[^.!?]+[.!?]+/g) ?? [lines[v.id]];
  const total = parts.reduce((n, p) => n + p.trim().length, 0);
  let t = v.t;
  for (const p of parts) {
    const d = (p.trim().length / total) * v.d;
    captions.push({ t0: t - 0.08, t1: t + d + 0.12, text: p.trim(), zone: zoneOf[v.id] });
    t += d;
  }
}
for (let i = 1; i < captions.length; i++) captions[i - 1].t1 = Math.min(captions[i - 1].t1, captions[i].t0 + 0.12);

// ---------- per-frame state
function srcAt(t) {
  const s = segs.find((x) => t >= x.t0 && t < x.t1) ?? segs[segs.length - 1];
  const u = clamp((t - s.t0) / (s.t1 - s.t0), 0, 1);
  return s.a + u * (s.b - s.a);
}
function viewAt(t) {
  let cur = WIDE;
  for (const k of camKeys) {
    if (t < k.t) break;
    if (k.dur === 0 || t >= k.t + k.dur) {
      cur = k.to;
      continue;
    }
    const u = inOutCubic((t - k.t) / k.dur);
    return { x: cur.x + (k.to.x - cur.x) * u, y: cur.y + (k.to.y - cur.y) * u, w: cur.w + (k.to.w - cur.w) * u };
  }
  return cur;
}
function mouseAt(src) {
  let p = mv.length ? mv[0].from : { x: VW / 2, y: VH / 2 };
  for (const m of mv) {
    if (src < m.t0) break;
    if (src >= m.t1) {
      p = m.to;
      continue;
    }
    const u = inOutCubic((src - m.t0) / (m.t1 - m.t0));
    return { x: m.from.x + (m.to.x - m.from.x) * u, y: m.from.y + (m.to.y - m.from.y) * u };
  }
  return p;
}
const fadeBox = (t, a, b, f = 0.28) => clamp(Math.min((t - a) / f, (b - t) / f), 0, 1);
function stateAt(t) {
  const src = srcAt(t);
  const v = viewAt(t);
  const z = VW / v.w;
  const k = 1920 / v.w; // output px per CSS px
  const toOut = (p) => ({ x: (p.x - v.x) * k, y: (p.y - v.y) * k });
  const inHook = t < segs[0].t1;
  let cursor = null;
  let ripple = null;
  if (!inHook) {
    const m = toOut(mouseAt(src));
    const press = clicks.find((c) => src >= c.t - 0.02 && src < c.t + 0.2);
    cursor = { ...m, scale: 0.78 * Math.pow(z, 0.7) * (press ? 0.86 : 1) };
    const c = clicks.find((c) => src >= c.t && src < c.t + 0.55);
    if (c) {
      const u = (src - c.t) / 0.55;
      ripple = { ...toOut(c), scale: (0.35 + 0.75 * outQuint(u)) * Math.pow(z, 0.5), o: 0.9 * (1 - u) };
    }
  }
  const cap = captions.find((c) => t >= c.t0 && t < c.t1);
  const lab = labels.find((l) => t >= l.t0 && t < l.t1);
  const cardState = (c) => (c && t >= c.t0 && t < c.t1 ? { o: fadeBox(t, c.t0, c.t1, 0.5), p: t - c.t0 } : null);
  return {
    t,
    src,
    frame: `/assets/raw-launch/frames/${frameAt(src)}`,
    view: { x: v.x * SCALE, y: v.y * SCALE, w: v.w * SCALE },
    cursor,
    ripple,
    caption: cap ? { text: cap.text, zone: cap.zone, o: fadeBox(t, cap.t0, cap.t1, 0.25) } : null,
    label: lab ? { text: lab.text, zone: lab.zone, o: fadeBox(t, lab.t0, lab.t1, 0.25) } : null,
    cards: { title: cardState(cards.title), end: cardState(cards.end) },
  };
}

writeFileSync(
  join(rawDir, 'timeline.json'),
  JSON.stringify({ total: TOTAL, segs, vos, camKeys, captions, labels, cards }, null, 1),
);
console.log(`timeline ${TOTAL.toFixed(2)} s, ${vos.length} voice-over lines, ${camKeys.length} camera keys`);
for (const v of vos) console.log(`  ${v.t.toFixed(2).padStart(6)}  ${v.id}`);

// ---------- static server for frames, fonts and the compositor page
const TYPES = { '.html': 'text/html', '.jpg': 'image/jpeg', '.woff2': 'font/woff2', '.js': 'text/javascript' };
const server = createServer((req, res) => {
  const p = join(root, decodeURIComponent(new URL(req.url, 'http://x').pathname));
  if (!p.startsWith(root) || !existsSync(p) || !statSync(p).isFile()) {
    res.writeHead(404).end();
    return;
  }
  res.writeHead(200, { 'content-type': TYPES[extname(p)] ?? 'application/octet-stream' });
  createReadStream(p).pipe(res);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;

// A throwaway headless Chrome (temporary profile) renders the frames.
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-mock-keychain', '--password-store=basic', '--force-color-profile=srgb'] });
async function newRenderer() {
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
  await page.goto(`${base}/scripts/demo/compositor.html`);
  await page.evaluate(() => window.ready);
  const cdp = await page.context().newCDPSession(page);
  return {
    async shot(state, file) {
      await page.evaluate((s) => window.renderFrame(s), state);
      const { data } = await cdp.send('Page.captureScreenshot', { format: 'jpeg', quality: 94, optimizeForSpeed: false });
      writeFileSync(file, Buffer.from(data, 'base64'));
    },
  };
}

if (opt('--preview')) {
  const dir = join(rawDir, 'preview');
  mkdirSync(dir, { recursive: true });
  const r = await newRenderer();
  for (const t of opt('--preview').split(',').map(Number)) {
    await r.shot(stateAt(t), join(dir, `t${t.toFixed(2)}.jpg`));
    console.log('preview', t);
  }
  await browser.close();
  server.close();
  process.exit(0);
}

const outDir = join(rawDir, 'out');
rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });
const N = Math.ceil(TOTAL * FPS);
const JOBS = Number(opt('--jobs') ?? 4);
const started = Date.now();
let done = 0;
await Promise.all(
  Array.from({ length: JOBS }, async (_, j) => {
    const r = await newRenderer();
    for (let i = j; i < N; i += JOBS) {
      await r.shot(stateAt(i / FPS), join(outDir, `${String(i).padStart(6, '0')}.jpg`));
      if (++done % 600 === 0) console.log(`${done}/${N} frames, ${((Date.now() - started) / 1000).toFixed(0)} s`);
    }
  }),
);
await browser.close();
server.close();

// ---------- audio: voice-over lines at their times, normalised to -16 LUFS
const voDir = join(rawDir, 'vo');
const ins = vos.flatMap((v) => ['-i', join(voDir, `${v.id}.wav`)]);
const delays = vos.map((v, i) => `[${i}:a]aresample=48000,adelay=${Math.round(v.t * 1000)}:all=1[a${i}]`).join(';');
const mix = `${delays};${vos.map((_, i) => `[a${i}]`).join('')}amix=inputs=${vos.length}:normalize=0:duration=longest,apad=whole_dur=${TOTAL.toFixed(3)},atrim=0:${TOTAL.toFixed(3)}[mix]`;
const voMix = join(rawDir, 'vo-mix.wav');
execFileSync('ffmpeg', ['-y', '-loglevel', 'error', ...ins, '-filter_complex', mix, '-map', '[mix]', '-ac', '2', voMix]);
const meas = (() => {
  const r = execFileSync('sh', ['-c', `ffmpeg -hide_banner -i "${voMix}" -af loudnorm=I=-16:TP=-1.5:LRA=11:print_format=json -f null - 2>&1`]).toString();
  return JSON.parse(r.slice(r.lastIndexOf('{'), r.lastIndexOf('}') + 1));
})();
const audio = join(rawDir, 'audio.m4a');
execFileSync('ffmpeg', [
  '-y', '-loglevel', 'error', '-i', voMix, '-af',
  `loudnorm=I=-16:TP=-1.5:LRA=11:measured_I=${meas.input_i}:measured_TP=${meas.input_tp}:measured_LRA=${meas.input_lra}:measured_thresh=${meas.input_thresh}:offset=${meas.target_offset}:linear=true,aresample=48000`,
  '-c:a', 'aac', '-b:a', '192k', audio,
]);

// ---------- final encode
const outFile = join(root, 'assets', 'demo.mp4');
execFileSync('ffmpeg', [
  '-y', '-loglevel', 'error', '-framerate', String(FPS), '-i', join(outDir, '%06d.jpg'), '-i', audio,
  '-map', '0:v', '-map', '1:a', '-vf', 'scale=in_range=full:out_range=tv,format=yuv420p', '-color_range', 'tv',
  '-c:v', 'libx264', '-preset', 'slow', '-crf', '17',
  '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709',
  '-c:a', 'copy', '-shortest', '-movflags', '+faststart', outFile,
]);
console.log(`wrote ${outFile}: ${TOTAL.toFixed(1)} s, ${N} frames in ${((Date.now() - started) / 1000).toFixed(0)} s`);
