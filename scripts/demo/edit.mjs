// Cuts the raw recording (assets/raw-launch/, from scripts/demo/record.mjs) and the voice-over
// (scripts/demo/voiceover.mjs) into assets/demo.mp4: eased zoom-to-focus camera over the 2x capture,
// callouts synced to the voice (spotlight, ring drawn on, label with arrow, pulse on numbers),
// drawn cursor with click ripples, fading captions, title and end cards, loudness-normalised audio.
// Every camera target and callout comes from element rectangles logged during the recording.
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
function frameIndex(src) {
  let lo = 0;
  let hi = frames.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (frames[mid].t <= src + 1e-4) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}
const syAt = (src) => run.frames[frameIndex(src)].sy ?? 0;
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
const labels = []; // {t0, t1, text, zone}: the status chip, top right
const cards = {}; // title / end: {t0, t1}
const callouts = []; // {t0, t1, zone, spot, rings: [{t, rects}], label, pulse}
const zoneOf = {};
let T = 0;
const seg = (a, b, dur, extra = {}) => {
  segs.push({ a, b, t0: T, t1: T + dur, ...extra });
  T += dur;
};
const play = (a, b) => seg(a, b, b - a);
const slow = (a, b, factor) => seg(a, b, (b - a) * factor);
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
  return t;
};
const voStart = (id) => vos.find((x) => x.id === id).t;
const voEnd = (id) => {
  const v = vos.find((x) => x.id === id);
  return v.t + v.d;
};
/** Seconds into a line at which a word is spoken (character share of the spoken part). */
function cueIn(id, word) {
  const text = lines[id];
  const i = text.indexOf(word);
  if (i < 0) throw new Error(`"${word}" not in ${id}`);
  return 0.04 + (i / text.length) * (durations[id] - 0.19);
}
const cam = (t, dur, to) => camKeys.push({ t, dur, to });
/** One focus: spotlight + ring (+ label with arrow for small things). Ends where the next one starts. */
const focus = (t0, o) => callouts.push({ t0, zone: 'device', rings: [{ t: t0, rects: [o.spot] }], label: null, ...o });
const glyph = (r) => ({ x: r.x - 2, y: r.y, w: r.h * 0.62 + 4, h: r.h });

// anchors from the in-page landing log: placeholders in the redacted text, real values in the answer
const tokL = run.landed.filter((l) => l.kind === 'placeholder').map((l) => ({ ...l, t: l.t - t0 }));
const resL = run.landed.filter((l) => l.kind === 'restored' && l.t - t0 < M.rawClick).map((l) => ({ ...l, t: l.t - t0 }));
const tokRender = tokL[0].t - 0.5; // first strike lands LEAD + SWEEP after the text is shown
const resRender = resL[0].t - 0.22;

// S0 hook: the redaction sweep, zoomed in, real time
const hookA = tokRender - 0.05;
seg(hookA, hookA + 4.3, 4.3, { hook: true });
cam(0, 0, fit(R('redacted', 'sweepEnd'), 18));
cam(1.6, 2.6, fit(union(R('redacted', 'sweepEnd'), R('subHead', 'sweepEnd')), 34));
vo('hook', 0.3, 'out');
focus(0.2, { zone: 'out', spot: R('redacted', 'sweepEnd'), t1: 4.1 });

// title card over the opening frame of the app
cards.title = { t0: 3.8 };
const startFrame = mv[0].t0 - 0.8;
cam(4.3, 0, WIDE);
vo('title', voEnd('hook') + 0.45);
cards.title.t1 = voEnd('title') + 1.0;
holdUntil(startFrame, startFrame + 0.001, cards.title.t1 + 0.1);

// S2 the problem: load the clinic sample
const pStart = T;
play(startFrame + 0.001, M.sample + 0.8);
vo('problem1', Math.max(pStart + 0.25, out(M.sample) + 0.25 - cueIn('problem1', 'messages')));
cam(out(M.sampleClick) + 0.25, 1.2, fit(union(R('samples', 'sample'), R('input', 'sample')), 30));
focus(voStart('problem1') - 0.05, { spot: R('clinic', 'sample'), label: 'Sample message, all details fictional' });
focus(voStart('problem1') + cueIn('problem1', 'messages') - 0.1, { spot: R('input', 'sample') });
vo('problem2', voEnd('problem1') + 0.3);
holdUntil(M.sample + 0.8, mv[1].t0, voEnd('problem2') + 0.3);

// S3 status chips
const sStart = T;
play(mv[1].t0, mv[1].t1 + 0.3);
cam(sStart - 0.05, 1.2, fit(R('status', 'chips'), 44, 2.1));
vo('status1', sStart + 0.2);
focus(sStart + 0.15, { spot: R('status', 'chips'), label: 'Hybrid: on this device + in the cloud' });
vo('status2', voEnd('status1') + 0.3);
focus(voStart('status2') - 0.05, { spot: R('chipDevice', 'chips'), label: 'Runs on this device' });
vo('status3', voEnd('status2') + 0.3, 'out');
focus(voStart('status3') + cueIn('status3', 'Gemini') - 0.1, { zone: 'out', spot: R('chipCloud', 'chips'), label: 'Runs in the cloud' });
holdUntil(mv[1].t1 + 0.3, mv[2].t0, voEnd('status3') + 0.3);

// S4 step 1, redaction on the device
const rStart = T;
cam(rStart, 1.1, fit(union(R('input', 'redactClick'), R('redact', 'redactClick'), R('redacted', 'sweepEnd')), 24));
play(mv[2].t0, M.redactClick);
vo('redact1', out(M.redactClick) - 0.45);
focus(voStart('redact1') - 0.1, { spot: R('redact', 'redactClick') });
play(M.redactClick, tokRender);
labels.push({ t0: out(M.redactClick) + 0.25, t1: out(tokRender), text: 'Gemini Nano working on this device · real time', zone: 'device' });
vo('redact2', voEnd('redact1') + 0.3);
focus(voStart('redact2') - 0.05, { spot: R('redact', 'redactClick'), label: 'Gemini Nano + pattern rules, on this device' });
cam(out(tokRender) - 1.3, 1.1, fit(R('redacted', 'sweepEnd'), 22));
// the sweep at half speed, one ring per placeholder as it lands
const sweepEndSrc = tokL.at(-1).t + 0.45;
slow(tokRender, sweepEndSrc, 2);
labels.push({ t0: out(tokRender), t1: out(sweepEndSrc), text: 'Slowed down 2×', zone: 'device' });
vo('redact3', Math.max(voEnd('redact2') + 0.25, out(tokRender) + 0.05), 'out');
focus(out(tokRender), {
  zone: 'out',
  spot: R('redacted', 'sweepEnd'),
  rings: tokL.map((l) => ({ t: out(l.t), rects: l.rects })),
});
play(sweepEndSrc, M.sweepEnd);
holdUntil(M.sweepEnd, mv[3].t0, voEnd('redact3') + 0.35);

// S5 review: what the cloud will see, who found each detail
const vStart = T;
cam(vStart - 0.1, 1.1, fit(R('panelLock', 'entities'), 10));
vo('review1', vStart + 0.15, 'out');
focus(vStart + 0.1, { zone: 'out', spot: R('panelLock', 'entities') });
play(mv[3].t0, mv[3].t1 + 0.2);
vo('review2', voEnd('review1') + 0.3);
const srcAll = [...R('srcNano', 'entities'), ...R('srcRule', 'entities')];
cam(voStart('review2') - 0.3, 1.0, fit(union(R('entities', 'entities'), R('addForm', 'entities')), 24, 1.8));
focus(voStart('review2') - 0.05, { spot: union(...srcAll), rings: [{ t: voStart('review2') - 0.05, rects: srcAll }], label: 'Who found it' });
vo('review3', voEnd('review2') + 0.25);
focus(voStart('review3') - 0.05, {
  spot: union(...srcAll),
  rings: [
    { t: voStart('review3') - 0.05, rects: R('srcNano', 'entities') },
    { t: voStart('review3') + cueIn('review3', 'pattern') - 0.1, rects: R('srcRule', 'entities') },
  ],
});
vo('review4', voEnd('review3') + 0.3);
focus(voStart('review4') + cueIn('review4', 'hide') - 0.1, { spot: R('addForm', 'entities'), label: 'Hide anything that was missed' });
holdUntil(mv[3].t1 + 0.2, mv[4].t0, voEnd('review4') + 0.3);

// S6 send to the cloud, answer restored on the device
cam(T - 0.1, 1.1, fit(union(R('redacted', 'entities'), R('send', 'entities')), 30));
play(mv[4].t0, mv[4].t1 + 0.25);
vo('send1', T + 0.05, 'out');
focus(voStart('send1') - 0.05, { zone: 'out', spot: R('send', 'entities') });
holdUntil(mv[4].t1 + 0.25, M.sendClick - 0.03, voStart('send1') + 0.4);
play(M.sendClick - 0.03, resRender + 0.2);
labels.push({ t0: out(M.sendClick) + 0.2, t1: out(resRender), text: 'Waiting for Gemini in the cloud · real time', zone: 'out' });
vo('send2', voEnd('send1') + 0.3, 'out');
focus(voStart('send2') + cueIn('send2', 'redacted') - 0.1, { zone: 'out', spot: R('redacted', 'entities'), label: 'Only this text leaves the device' });
cam(out(resRender) - 1.0, 1.0, fit(union(R('badge', 'restored'), R('result', 'restored')), 22));
// the answer arrives with placeholders; hold that frame, then show the restore at half speed
const send3 = Math.max(voEnd('send2') + 0.3, out(resRender) + 0.1);
vo('send3', send3);
focus(send3 - 0.05, { spot: R('result', 'restored'), rings: [{ t: send3 - 0.05, rects: [R('result', 'restored')] }] });
holdUntil(resRender + 0.2, resRender + 0.201, send3 + cueIn('send3', 'puts') - 0.1);
const restoreEnd = resL.at(-1).t + 0.45;
const slowFrom = T;
slow(resRender + 0.201, restoreEnd, 2);
labels.push({ t0: out(resRender) + 0.2, t1: out(restoreEnd), text: 'Slowed down to show the restore', zone: 'device' });
callouts.at(-1).rings.push(...resL.map((l) => ({ t: out(l.t), rects: l.rects })));
void slowFrom;
play(restoreEnd, M.restored);
vo('send4', voEnd('send3') + 0.3);
focus(voStart('send4') - 0.05, { spot: R('result', 'restored'), rings: [{ t: voStart('send4') - 0.05, rects: R('restoredMarks', 'restored') }], label: 'Restored on this device' });
holdUntil(M.restored, mv[5].t0, voEnd('send4') + 0.3);

// S7 what the cloud really wrote
play(mv[5].t0, M.rawClick - 0.05);
vo('raw1', Math.max(voEnd('send4') + 0.3, T - 0.3), 'out');
focus(voStart('raw1') - 0.05, { zone: 'out', spot: R('rawToggleBox', 'rawOn'), label: 'What the cloud model wrote' });
play(M.rawClick - 0.05, M.rawOn);
vo('raw2', voEnd('raw1') + 0.3, 'out');
focus(voStart('raw2') - 0.05, { zone: 'out', spot: R('result', 'rawOn'), rings: [{ t: voStart('raw2') - 0.05, rects: R('resultToks', 'rawOn') }], label: 'Placeholders only' });
holdUntil(M.rawOn, M.rawOffClick - 0.02, voEnd('raw2') + 0.3);
play(M.rawOffClick - 0.02, M.scroll);

// S8 egress log
const lStart = T;
cam(lStart - 0.1, 1.1, WIDE);
vo('log1', lStart + 0.3);
play(M.scroll, M.logOpen);
const logA = union(R('logHead', 'logShown'), R('logRow', 'logShown'));
const logB = union(R('logHead', 'logOpen'), R('logRow', 'logOpen'));
focus(voStart('log1') - 0.05, { spot: logA, scrollRef: M.logShown });
focus(out(M.logOpen) - 0.25, { spot: logB });
cam(out(M.logShown) - 0.2, 1.1, fit({ x: 40, y: logB.y, w: 1060, h: logB.h }, 12));
holdUntil(M.logOpen, M.logOpen + 0.5, voEnd('log1') + 0.3);
{
  const tally = R('tally', 'logOpen');
  const sum = R('logSummary', 'logOpen');
  cam(T - 0.35, 1.0, fit({ x: 1000, y: tally.y - 8, w: sum.x + sum.w - 1000, h: sum.y + sum.h - tally.y + 16 }, 26, 2.0));
}
vo('log2', T + 0.1, 'out');
focus(voStart('log2') - 0.05, { zone: 'out', spot: R('tallyReqBox', 'logOpen'), rings: [{ t: voStart('log2') - 0.05, rects: [glyph(R('tallyReq', 'logOpen'))] }], label: '1 request left the device', pulse: true });
vo('log3', voEnd('log2') + 0.35);
focus(voStart('log3') - 0.05, { spot: R('tallyLeakBox', 'logOpen'), rings: [{ t: voStart('log3') - 0.05, rects: [glyph(R('tallyLeak', 'logOpen'))] }], label: '0 personal details in it', pulse: true, t1: voEnd('log3') + 0.9 });
holdUntil(M.logOpen + 0.5, M.end, voEnd('log3') + 1.0);

// S9 end card
cards.end = { t0: T - 0.5 };
vo('close1', T + 0.35);
vo('close2', voEnd('close1') + 0.45);
holdUntil(M.end, M.end + 0.001, voEnd('close2') + 1.6);
cards.end.t1 = T + 10;
const TOTAL = T;

// checks; each focus ends where the next starts (or 0.3 s after its line if nothing follows)
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
const ON_CARDS = new Set(['title', 'close1', 'close2']);
callouts.sort((a, b) => a.t0 - b.t0);
callouts.forEach((c, i) => {
  c.id = i;
  const next = callouts[i + 1];
  // hold until the next focus, but not past the last line spoken before it
  const spoken = vos.filter((v) => v.t <= (next ? next.t0 : Infinity) && !ON_CARDS.has(v.id)).at(-1);
  const lineEnd = spoken ? spoken.t + spoken.d + 0.35 : c.t0 + 2;
  c.t1 = Math.min(c.t1 ?? Infinity, next ? next.t0 : Infinity, next && next.t0 - lineEnd > 0.6 ? lineEnd : Infinity);
  if (!Number.isFinite(c.t1)) c.t1 = lineEnd;
});
// every spoken line must have a focus on screen, unless a card covers the footage
const onCard = (t) => [cards.title, cards.end].some((c) => c && t >= c.t0 + 0.3 && t < c.t1);
for (const v of vos) {
  if (ON_CARDS.has(v.id)) continue;
  for (let t = v.t + 0.4; t < v.t + v.d - 0.2; t += 0.1) {
    if (onCard(t)) continue;
    if (!callouts.some((c) => t >= c.t0 && t < c.t1)) {
      console.warn(`no callout during "${v.id}" at ${t.toFixed(2)}`);
      break;
    }
  }
}

// captions: one sentence at a time, timed by character share within its line; none on cards
const captions = [];
for (const v of vos) {
  if (ON_CARDS.has(v.id)) continue;
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
const lerpRect = (a, b, u) => ({ x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u, w: a.w + (b.w - a.w) * u, h: a.h + (b.h - a.h) * u });
const fadeBox = (t, a, b, f = 0.28) => clamp(Math.min((t - a) / f, (b - t) / f), 0, 1);
function calloutAt(t) {
  const i = callouts.findIndex((c) => t >= c.t0 && t < c.t1);
  if (i < 0) return null;
  const c = callouts[i];
  const prev = callouts[i - 1];
  const next = callouts[i + 1];
  const fromPrev = prev && Math.abs(prev.t1 - c.t0) < 0.02;
  const intoNext = next && Math.abs(c.t1 - next.t0) < 0.02;
  const o = Math.min(fromPrev ? 1 : clamp((t - c.t0) / 0.3, 0, 1), intoNext ? 1 : clamp((c.t1 - t) / 0.3, 0, 1));
  // the spotlight glides from the previous focus to this one
  const spot = fromPrev ? lerpRect(prev.spot, c.spot, inOutCubic(clamp((t - c.t0) / 0.4, 0, 1))) : c.spot;
  const h = c.rings.reduce((k, r, j) => (t >= r.t ? j : k), -1);
  let rings = [];
  let draw = 1;
  if (h >= 0) {
    const cur = c.rings[h];
    const before = c.rings[h - 1];
    const since = t - cur.t;
    if (h === 0) {
      draw = clamp((t - Math.max(c.t0, cur.t)) / 0.35, 0, 1);
      rings = cur.rects;
    } else if (before.rects.length === 1 && cur.rects.length === 1) {
      rings = [lerpRect(before.rects[0], cur.rects[0], inOutCubic(clamp(since / 0.2, 0, 1)))];
    } else {
      draw = clamp(since / 0.3, 0, 1);
      rings = cur.rects;
    }
  }
  // numbers read aloud: a short pulse
  const pulse = c.pulse ? 1 + 0.12 * Math.sin(Math.PI * clamp((t - c.t0 - 0.15) / 0.45, 0, 1)) : 1;
  return { id: c.id, zone: c.zone, scrollRef: c.scrollRef, o, spot, rings, draw, pulse, underline: c.pulse ? clamp((t - c.t0 - 0.25) / 0.35, 0, 1) : 0, label: c.label, labelO: clamp((t - c.t0 - 0.2) / 0.3, 0, 1) };
}
/** Callout in output pixels for time t (source time src, camera view v). */
function calloutOut(t, src, v, withSide = true) {
  const co = calloutAt(t);
  if (!co) return null;
  const k = 1920 / v.w;
  const rectOut = (r, pad = 0) => ({ x: (r.x - v.x) * k - pad, y: (r.y - v.y) * k - pad, w: r.w * k + 2 * pad, h: r.h * k + 2 * pad });
  // a focus recorded after a scroll follows the page while it scrolls
  const dy = co.scrollRef !== undefined ? syAt(co.scrollRef) - syAt(src) : 0;
  const sh = (r) => ({ ...r, y: r.y + dy });
  const rings = co.rings.map((r) => rectOut(sh(r), r.h * k < 40 ? 4 : 9));
  const anchor = rings.length ? union(...rings) : rectOut(sh(co.spot), 6);
  const out = { ...co, spot: rectOut(sh(co.spot), 14), rings, anchor };
  if (co.label && withSide) out.side = labelSide(co.id);
  return out;
}
// Which side of its element a label goes: decided once per callout, from the framing 1.2 s in.
const sideMemo = new Map();
function labelSide(id) {
  if (sideMemo.has(id)) return sideMemo.get(id);
  const c = callouts[id];
  const tRef = Math.min(c.t1 - 0.05, c.t0 + 1.2);
  const U = calloutOut(tRef, srcAt(tRef), viewAt(tRef), false).anchor;
  const lw = c.label.length * 13.8 + 72;
  const lh = 56;
  const G = 74;
  const ok = {
    below: U.y + U.h + G + lh <= 850,
    right: U.x + U.w + G + lw <= 1888 && U.y + U.h / 2 + lh / 2 <= 850,
    left: U.x - G - lw >= 32 && U.y + U.h / 2 + lh / 2 <= 850,
    above: U.y - G - lh >= 28,
  };
  const side = ['below', 'right', 'left', 'above'].find((k) => ok[k]) ?? 'below';
  sideMemo.set(id, side);
  return side;
}
// Captions sit at the bottom unless the focus is there; decided once per caption.
const capMemo = new Map();
function captionTop(i) {
  if (capMemo.has(i)) return capMemo.get(i);
  const c = captions[i];
  const tm = (c.t0 + c.t1) / 2;
  const co = calloutOut(tm, srcAt(tm), viewAt(tm), false);
  let top = false;
  if (co) {
    const A = co.anchor;
    const overlap = (y0, y1) => Math.max(0, Math.min(A.y + A.h, y1) - Math.max(A.y, y0));
    top = overlap(880, 1080) > overlap(0, 200) + 4;
  }
  capMemo.set(i, top);
  return top;
}
function stateAt(t) {
  const src = srcAt(t);
  const v = viewAt(t);
  const z = VW / v.w;
  const k = 1920 / v.w; // output px per CSS px
  const toOut = (p) => ({ x: (p.x - v.x) * k, y: (p.y - v.y) * k });
  const rectOut = (r, pad = 0) => ({ x: (r.x - v.x) * k - pad, y: (r.y - v.y) * k - pad, w: r.w * k + 2 * pad, h: r.h * k + 2 * pad });
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
  const callout = calloutOut(t, src, v);
  const ci = captions.findIndex((c) => t >= c.t0 && t < c.t1);
  const cap = captions[ci];
  const lab = labels.find((l) => t >= l.t0 && t < l.t1);
  const cardState = (c) => (c && t >= c.t0 && t < c.t1 ? { o: fadeBox(t, c.t0, c.t1, 0.5), p: t - c.t0 } : null);
  return {
    t,
    src,
    frame: `/assets/raw-launch/frames/${frameAt(src)}`,
    view: { x: v.x * SCALE, y: v.y * SCALE, w: v.w * SCALE },
    cursor,
    ripple,
    callout,
    caption: cap ? { text: cap.text, zone: cap.zone, o: fadeBox(t, cap.t0, cap.t1, 0.25), top: captionTop(ci) } : null,
    label: lab ? { text: lab.text, zone: lab.zone, o: fadeBox(t, lab.t0, lab.t1, 0.25) } : null,
    cards: { title: cardState(cards.title), end: cardState(cards.end) },
  };
}

writeFileSync(
  join(rawDir, 'timeline.json'),
  JSON.stringify({ total: TOTAL, segs, vos, camKeys, callouts, captions, labels, cards }, null, 1),
);
console.log(`timeline ${TOTAL.toFixed(2)} s, ${vos.length} voice-over lines, ${callouts.length} callouts, ${camKeys.length} camera keys`);
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
