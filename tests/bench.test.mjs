import { describe, expect, it } from 'vitest';
import { aggregate, percentiles, scoreMessage } from '../bench/score.mjs';
import { occurrences } from '../src/redact';
import dataset from '../bench/dataset.json';
import heldout from '../bench/heldout.json';

const msg = {
  id: 't',
  lang: 'en',
  domain: 'clinic',
  adversarial: null,
  text: 'I am Aisyah, call 012-345 6789. Address: 12, Jalan Mawar 3, 53100 Kuala Lumpur. School: SK Melati.',
  labels: [
    { category: 'PERSON', value: 'Aisyah', spans: [[5, 11]] },
    { category: 'PHONE', value: '012-345 6789', spans: [[18, 30]] },
    { category: 'ADDRESS', value: '12, Jalan Mawar 3, 53100 Kuala Lumpur', spans: [[41, 79]] },
  ],
  optional: [{ category: 'ORGANIZATION', value: 'SK Melati', spans: [[89, 98]] }],
};

describe('benchmark scoring', () => {
  it('needs every letter and digit of a value hidden, and calls a half-hidden address partial', () => {
    const s = scoreMessage(
      msg,
      [
        { text: 'Aisyah', type: 'PERSON' },
        { text: '012-345 6789', type: 'PHONE' },
        { text: '12, Jalan Mawar 3', type: 'ADDRESS' },
      ],
      occurrences,
    );
    expect(s.labels.map((l) => l.state)).toEqual(['hidden', 'hidden', 'partial']);
  });

  it('counts a redacted organisation as neither right nor wrong, and a redacted date as wrong', () => {
    const s = scoreMessage(
      msg,
      [
        { text: 'SK Melati', type: 'ORGANIZATION' },
        { text: 'Address', type: 'OTHER' },
      ],
      occurrences,
    );
    expect(s.preds.map((p) => p.verdict)).toEqual(['ignored', 'wrong']);
    const a = aggregate([{ msg, score: s }]);
    expect(a.overall.tp).toBe(0);
    expect(a.overall.fp).toBe(1);
    expect(a.overall.reachedCloud).toBe(3);
  });

  it('treats a split number as one value that is hidden only when both parts are', () => {
    const m = { ...msg, text: 'new no 012-345 then 6789', labels: [{ category: 'PHONE', value: '012-345 6789', spans: [[7, 14], [20, 24]] }], optional: [] };
    expect(scoreMessage(m, [{ text: '012-345', type: 'PHONE' }], occurrences).labels[0].state).toBe('partial');
    expect(scoreMessage(m, [{ text: '012-345', type: 'PHONE' }, { text: '6789', type: 'PHONE' }], occurrences).labels[0].state).toBe('hidden');
  });

  it('computes median and nearest-rank p95', () => {
    const p = percentiles([5, 1, 3, 2, 4, 6, 7, 8, 9, 10]);
    expect(p.median).toBe(5.5);
    expect(p.p95).toBe(10);
  });
});

describe('benchmark data', () => {
  for (const [name, d] of [['dataset', dataset], ['heldout', heldout]]) {
    it(`${name}: every labelled span points at its value`, () => {
      for (const m of d.messages)
        for (const l of m.labels) {
          const text = l.spans.map(([s, e]) => m.text.slice(s, e));
          expect(text.every((t) => l.value.includes(t)), `${m.id} ${l.value}`).toBe(true);
        }
    });
  }

  it('the generated set is the size the README says', () => {
    expect(dataset.messages.length).toBeGreaterThanOrEqual(120);
    expect(dataset.messages.reduce((n, m) => n + m.labels.length, 0)).toBeGreaterThanOrEqual(600);
  });
});
