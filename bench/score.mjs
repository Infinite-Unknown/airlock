// Scores redaction output against the labelled dataset.
//
// A labelled value counts as hidden only when every letter and digit of it (all of its spans) is
// covered by something that was redacted. Anything less (a street left after the house number was
// hidden, the last four digits of a split number) means part of it reached the cloud payload.
// Precision counts each distinct redacted value once: it is correct when it overlaps a labelled
// value, ignored when it only overlaps an optional one (organisation names), wrong otherwise.

export const CATEGORIES = ['PERSON', 'ID_NUMBER', 'PHONE', 'EMAIL', 'ADDRESS', 'ACCOUNT_NUMBER', 'DATE_OF_BIRTH'];
export const CATEGORY_LABEL = {
  PERSON: 'Names',
  ID_NUMBER: 'MyKad / ID numbers',
  PHONE: 'Phone numbers',
  EMAIL: 'Emails',
  ADDRESS: 'Addresses',
  ACCOUNT_NUMBER: 'Bank / card numbers',
  DATE_OF_BIRTH: 'Dates of birth',
};

const overlaps = (a, b) => a[0] < b[1] && b[0] < a[1];

/**
 * @param {{text: string, labels: {category: string, value: string, spans: number[][]}[], optional: {spans: number[][]}[]}} msg
 * @param {{text: string, type: string}[]} entities  what the redactor hid (after merging)
 * @param {(source: string, value: string) => number[][]} occurrences  same matcher redact() uses
 */
export function scoreMessage(msg, entities, occurrences) {
  const covered = new Uint8Array(msg.text.length);
  const entSpans = entities.map((e) => {
    const spans = occurrences(msg.text, e.text);
    for (const [s, t] of spans) covered.fill(1, s, t);
    return { ...e, spans };
  });
  const labels = msg.labels.map((l) => {
    let need = 0;
    let got = 0;
    for (const [s, t] of l.spans)
      for (let i = s; i < t; i++)
        if (/[\p{L}\p{N}]/u.test(msg.text[i])) {
          need++;
          got += covered[i];
        }
    const state = got === need ? 'hidden' : got === 0 ? 'exposed' : 'partial';
    return { category: l.category, value: l.value, state };
  });
  const preds = entSpans.map((e) => {
    const hitsLabel = msg.labels.find((l) => l.spans.some((ls) => e.spans.some((es) => overlaps(ls, es))));
    const hitsOptional = msg.optional.some((o) => o.spans.some((os) => e.spans.some((es) => overlaps(os, es))));
    const verdict = hitsLabel ? 'correct' : hitsOptional ? 'ignored' : 'wrong';
    return { text: e.text, type: e.type, source: e.source, verdict, category: hitsLabel?.category ?? typeToCategory(e.type) };
  });
  return { labels, preds };
}

function typeToCategory(t) {
  return CATEGORIES.includes(t) ? t : t === 'ORGANIZATION' ? 'ORGANIZATION' : 'OTHER';
}

const pct = (a, b) => (b ? (100 * a) / b : NaN);

/** Aggregate per-message scores. `rows` are {msg, score} pairs. */
export function aggregate(rows) {
  const by = Object.fromEntries(CATEGORIES.map((c) => [c, { n: 0, hidden: 0, partial: 0, exposed: 0, tp: 0, fp: 0 }]));
  const all = { n: 0, hidden: 0, partial: 0, exposed: 0, tp: 0, fp: 0, ignored: 0 };
  const groups = {};
  let cleanMessages = 0;
  const misses = [];
  const wrong = [];
  for (const { msg, score } of rows) {
    let leaks = 0;
    for (const l of score.labels) {
      const c = by[l.category];
      c.n++;
      c[l.state]++;
      all.n++;
      all[l.state]++;
      if (l.state !== 'hidden') {
        leaks++;
        misses.push({ id: msg.id, category: l.category, value: l.value, state: l.state });
      }
      for (const key of [`lang:${msg.lang}`, `domain:${msg.domain}`, `adversarial:${msg.adversarial ?? 'none'}`]) {
        const g = (groups[key] ??= { n: 0, hidden: 0 });
        g.n++;
        if (l.state === 'hidden') g.hidden++;
      }
    }
    if (!leaks) cleanMessages++;
    for (const p of score.preds) {
      if (p.verdict === 'ignored') {
        all.ignored++;
        continue;
      }
      const ok = p.verdict === 'correct';
      all[ok ? 'tp' : 'fp']++;
      if (by[p.category]) by[p.category][ok ? 'tp' : 'fp']++;
      if (!ok) wrong.push({ id: msg.id, text: p.text, type: p.type, source: p.source });
    }
  }
  const fmt = (c) => ({
    ...c,
    recall: pct(c.hidden, c.n),
    precision: pct(c.tp, c.tp + c.fp),
    reachedCloud: c.n - c.hidden,
  });
  return {
    messages: rows.length,
    cleanMessages,
    overall: fmt(all),
    byCategory: Object.fromEntries(Object.entries(by).map(([k, v]) => [k, fmt(v)])),
    groups: Object.fromEntries(Object.entries(groups).map(([k, g]) => [k, { ...g, recall: pct(g.hidden, g.n) }])),
    misses,
    wrong,
  };
}

/** Median and 95th percentile (nearest rank) of a list of numbers. */
export function percentiles(xs) {
  const s = [...xs].sort((a, b) => a - b);
  if (!s.length) return { n: 0, median: NaN, p95: NaN };
  const at = (q) => s[Math.min(s.length - 1, Math.ceil(q * s.length) - 1)];
  const median = s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
  return { n: s.length, median, p95: at(0.95), min: s[0], max: s.at(-1) };
}
