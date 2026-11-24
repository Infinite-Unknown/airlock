import { describe, expect, it, vi } from 'vitest';
import { detectWithRules } from '../src/rules';
import { findLeaks, mergeEntities, redact, restore } from '../src/redact';
import { checkOnDevice, detect, parseEntities, write, type TextModel } from '../src/airlock';
import { SAMPLES } from '../src/samples';

// Test doubles for the Firebase AI Logic model boundary. They let the tests
// check Airlock's own logic; they are not used by the app.
function stubModel(text: string, inferenceSource: 'on_device' | 'in_cloud'): TextModel & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    generateContent: vi.fn(async (prompt: string) => {
      calls.push(prompt);
      return { response: { text: () => text, inferenceSource } };
    }),
  };
}

describe('local rules', () => {
  it('finds structured identifiers', () => {
    const text =
      'Mail aisyah.r@example.com or call +60 12-345 6789. IC 900101-14-5678. Card 4111 1111 1111 1111. Order 1234 5678 9012.';
    const found = detectWithRules(text).map((e) => `${e.type}:${e.text}`);
    expect(found).toContain('EMAIL:aisyah.r@example.com');
    expect(found).toContain('PHONE:+60 12-345 6789');
    expect(found).toContain('ID_NUMBER:900101-14-5678');
    expect(found).toContain('ACCOUNT_NUMBER:4111 1111 1111 1111');
    // not a valid card number (fails Luhn), so it stays
    expect(found.join()).not.toContain('1234 5678 9012');
  });
});

describe('redact / restore', () => {
  const source = 'Aisyah binti Rahman wrote. Aisyah lives at 12 Jalan Mawar. Call aisyah again.';
  const entities = mergeEntities(source, [
    { text: 'Aisyah', type: 'PERSON', source: 'on-device' },
    { text: 'Aisyah binti Rahman', type: 'PERSON', source: 'on-device' },
    { text: '12 Jalan Mawar', type: 'ADDRESS', source: 'on-device' },
    { text: 'Invented Person', type: 'PERSON', source: 'on-device' }, // not in text: dropped
  ]);

  it('drops entities that are not in the text', () => {
    expect(entities.map((e) => e.text)).not.toContain('Invented Person');
  });

  it('replaces every occurrence, longest first, any case', () => {
    const r = redact(source, entities);
    expect(r.redacted).toBe('[PERSON_1] wrote. [PERSON_2] lives at [ADDRESS_1]. Call [PERSON_2] again.');
    expect(findLeaks(r.redacted, r.placeholders)).toEqual([]);
  });

  it('restores placeholders, tolerating missing brackets', () => {
    const r = redact(source, entities);
    expect(restore('Dear [PERSON_2], we visited ADDRESS_1.', r.placeholders)).toBe(
      'Dear Aisyah, we visited 12 Jalan Mawar.',
    );
  });

  it('does not treat a name inside a longer word as a leak', () => {
    const r = redact('Ali called.', [{ text: 'Ali', type: 'PERSON', source: 'manual' }]);
    expect(findLeaks('Alice and Natalie', r.placeholders)).toEqual([]);
    expect(findLeaks('ali said hi', r.placeholders)).toEqual(['Ali']);
  });
});

describe('on-device gate', () => {
  it('reports no-api when the browser has no LanguageModel', async () => {
    expect(await checkOnDevice({})).toBe('no-api');
  });

  it('passes through Chrome availability', async () => {
    const g = { LanguageModel: { availability: async () => 'downloadable' } };
    expect(await checkOnDevice(g)).toBe('downloadable');
  });

  it('never calls the detector unless Gemini Nano is available', async () => {
    const detector = stubModel('{"entities":[]}', 'on_device');
    const r = await detect('Call 012-345 6789', detector, 'no-api');
    expect(detector.calls).toHaveLength(0);
    expect(r.usedOnDevice).toBe(false);
    expect(r.entities.map((e) => e.type)).toEqual(['PHONE']);
  });

  it('refuses a redaction that did not run on-device', async () => {
    const detector = stubModel('{"entities":[]}', 'in_cloud');
    await expect(detect('hello', detector, 'available')).rejects.toThrow(/not on-device/);
  });

  it('merges model entities with rule entities', async () => {
    const detector = stubModel(
      '```json\n{"entities":[{"text":"Aisyah","type":"PERSON"},{"text":"Nobody","type":"PERSON"}]}\n```',
      'on_device',
    );
    const r = await detect('Aisyah: 012-345 6789', detector, 'available');
    expect(r.entities.map((e) => `${e.source}:${e.type}:${e.text}`)).toEqual([
      'rule:PHONE:012-345 6789',
      'on-device:PERSON:Aisyah',
    ]);
  });

  it('drops a model entity that overlaps a pattern-rule match', async () => {
    const detector = stubModel('{"entities":[{"text":"IC 900101-14-5678","type":"ID_NUMBER"},{"text":"Aisyah","type":"PERSON"}]}', 'on_device');
    const r = await detect('Aisyah, IC 900101-14-5678', detector, 'available');
    expect(r.entities.map((e) => `${e.source}:${e.text}`)).toEqual(['rule:900101-14-5678', 'on-device:Aisyah']);
  });

  it('parses junk as no entities', () => {
    expect(parseEntities('sorry, I cannot')).toEqual([]);
  });
});

describe('cloud step', () => {
  it('sends only redacted text and restores the answer locally', async () => {
    const source = 'Hi, I am Aisyah, my IC is 900101-14-5678.';
    const r = redact(source, [
      { text: 'Aisyah', type: 'PERSON', source: 'on-device' },
      { text: '900101-14-5678', type: 'ID_NUMBER', source: 'rule' },
    ]);
    const writer = stubModel('Dear [PERSON_1], we received ID [ID_NUMBER_1].', 'in_cloud');
    const out = await write('Reply.', r, writer);
    expect(writer.calls[0]).not.toContain('Aisyah');
    expect(writer.calls[0]).not.toContain('900101');
    expect(out.restored).toBe('Dear Aisyah, we received ID 900101-14-5678.');
    expect(out.inferenceSource).toBe('in_cloud');
  });

  it('refuses to send when a custom task contains a redacted value', async () => {
    const r = redact('Aisyah called', [{ text: 'Aisyah', type: 'PERSON', source: 'manual' }]);
    const writer = stubModel('x', 'in_cloud');
    await expect(write('Write to Aisyah', r, writer)).rejects.toThrow(/Refusing to send/);
    expect(writer.calls).toHaveLength(0);
  });
});

describe('samples', () => {
  it('rules catch the structured data in every sample', () => {
    for (const s of SAMPLES) {
      expect(detectWithRules(s.text).length).toBeGreaterThan(0);
    }
  });
});
