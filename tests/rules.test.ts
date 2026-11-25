import { describe, expect, it } from 'vitest';
import { detectWithRules, isMyKad, isMyPhone, spelledDigits } from '../src/rules';
import { expandNames, mergeEntities, redact } from '../src/redact';
import { plausible } from '../src/sulit';
import { describeMode, parseSettings, REMOTE_DEFAULTS } from '../src/settings';
import { installOutageSwitch, setOutage } from '../src/outage';

const found = (text: string) => detectWithRules(text).map((e) => `${e.type}:${e.text}`);

describe('Malaysian pattern rules', () => {
  it('reads MyKad numbers with or without dashes, and checks the date and state code', () => {
    expect(isMyKad('900101145678')).toBe(true);
    expect(isMyKad('901301145678')).toBe(false); // month 13
    expect(isMyKad('900101005678')).toBe(false); // PB code 00
    expect(found('IC 900101145678 and 900101 14 5678.')).toEqual(['ID_NUMBER:900101145678', 'ID_NUMBER:900101 14 5678']);
  });

  it('reads Malaysian phone numbers in every common format', () => {
    for (const p of ['012-345 6789', '0123456789', '+60 12-345 6789', '+60123456789', '011-1234 5678', '03-2345 6789', '(03) 2345 6789', '(082) 13 6497', 'O12-345 6789'])
      expect(isMyPhone(p), p).toBe(true);
    for (const p of ['1234 5678 9012', '20102019', '0123', '5-0272712-00']) expect(isMyPhone(p), p).toBe(false);
    expect(found('Call 0123456789 or O17-882 0911 tonight')).toEqual(['PHONE:0123456789', 'PHONE:O17-882 0911']);
  });

  it('does not take money amounts, years or order numbers for phone numbers', () => {
    expect(found('Paid RM 1,250.00 in 2024 for order 1234 5678 9012 on 12/03/2025.')).toEqual([]);
  });

  it('finds account and ID numbers after a keyword, in English and Bahasa Melayu', () => {
    expect(found('My account is 883817391454, akaun saya 5-0272712-00.')).toEqual(['ACCOUNT_NUMBER:883817391454', 'ACCOUNT_NUMBER:5-0272712-00']);
    expect(found('staff ID S85916, no. pekerja K31970, EPF number 47363242')).toEqual(['ID_NUMBER:S85916', 'ID_NUMBER:K31970', 'ID_NUMBER:47363242']);
  });

  it('finds digits written as words, and types a spelled MyKad as an ID', () => {
    expect(spelledDigits('kosong satu dua')).toBe('012');
    expect(found('my phone is zero one two, three four five, six seven eight nine.')).toEqual(['PHONE:zero one two, three four five, six seven eight nine']);
    expect(found('IC nine zero zero one zero one, one four, five six seven eight ok')).toEqual(['ID_NUMBER:nine zero zero one zero one, one four, five six seven eight']);
  });

  it('finds emails written out with "at" and "dot"', () => {
    expect(found('send to nurul.aina at example dot com please')).toEqual(['EMAIL:nurul.aina at example dot com']);
    expect(found('or g.anand (at) example (dot) com')).toEqual(['EMAIL:g.anand (at) example (dot) com']);
  });

  it('finds a date of birth only after a keyword', () => {
    expect(found('born 12 March 1988, tarikh lahir 9 Ogos 1991; seen on 3 March 2026')).toEqual([
      'DATE_OF_BIRTH:12 March 1988',
      'DATE_OF_BIRTH:9 Ogos 1991',
    ]);
  });

  it('finds a street address that runs to a postcode and town', () => {
    expect(found('Our address is 12, Jalan Mawar 3, Taman Melati, 53100 Kuala Lumpur. Thanks')).toEqual([
      'ADDRESS:12, Jalan Mawar 3, Taman Melati, 53100 Kuala Lumpur',
    ]);
    expect(found('Home: B-12-3A, Residensi Harmoni, Jalan Ipoh, 51200 Kuala Lumpur, Selangor')).toEqual([
      'ADDRESS:B-12-3A, Residensi Harmoni, Jalan Ipoh, 51200 Kuala Lumpur, Selangor',
    ]);
  });
});

describe('on-device answer clean-up', () => {
  it('drops a "date of birth" without a year and an "address" that is only a town', () => {
    const e = (text: string, type: 'DATE_OF_BIRTH' | 'ADDRESS' | 'OTHER') => plausible({ text, type, source: 'on-device' });
    expect(e('28 March', 'DATE_OF_BIRTH')).toBe(false);
    expect(e('Isnin', 'DATE_OF_BIRTH')).toBe(false);
    expect(e('03/07/1985', 'DATE_OF_BIRTH')).toBe(true);
    expect(e('Klang', 'ADDRESS')).toBe(false);
    expect(e('4 Amanah', 'ADDRESS')).toBe(false);
    expect(e('Lot 45, Kampung Baru', 'ADDRESS')).toBe(true);
    expect(e('10 pagi', 'OTHER')).toBe(false);
  });

  it('hides the parts of a found name where they are used on their own', () => {
    const text = 'This is Hope Tingang\'s mum. I hope the doctor can see Hope today. Mr Tan Wei Ming will drive.';
    const ents = expandNames(text, mergeEntities(text, [
      { text: 'Hope Tingang', type: 'PERSON', source: 'on-device' },
      { text: 'Tan Wei Ming', type: 'PERSON', source: 'on-device' },
    ]));
    expect(ents.map((e) => e.text)).toEqual(['Hope Tingang', 'Tan Wei Ming', 'Hope']);
    expect(redact(text, ents).redacted).not.toMatch(/Hope/);
  });

  it('does not expand patronymic words or lowercase parts', () => {
    const text = 'Nurul Aina binti Kamarudin called. Nurul said binti is fine.';
    const ents = expandNames(text, [{ text: 'Nurul Aina binti Kamarudin', type: 'PERSON', source: 'on-device' }]);
    expect(ents.map((e) => e.text)).toEqual(['Nurul Aina binti Kamarudin']); // "Nurul" is a common prefix, "binti" a patronymic
  });
});

describe('Remote Config settings', () => {
  it('uses the defaults when values are missing or malformed', () => {
    const s = parseSettings({ cloud_model: 'not a model; drop table', writer_mode: 'sometimes' }, 'remote');
    expect(s.cloudModel).toBe(REMOTE_DEFAULTS.cloud_model);
    expect(s.writerMode).toBe('prefer_in_cloud');
    expect(s.quickMode).toBe('prefer_on_device');
  });

  it('accepts valid remote values', () => {
    const s = parseSettings({ cloud_model: 'gemini-3.5-flash', writer_mode: 'only_in_cloud', quick_mode: 'only_on_device' }, 'remote');
    expect(s).toEqual({ cloudModel: 'gemini-3.5-flash', writerMode: 'only_in_cloud', quickMode: 'only_on_device', source: 'remote' });
    expect(describeMode('prefer_in_cloud')).toMatch(/Cloud first/);
  });
});

describe('simulated cloud outage', () => {
  it('fails Gemini requests like a dropped connection and leaves other requests alone', async () => {
    const seen: string[] = [];
    const g = { fetch: (async (u: RequestInfo | URL) => (seen.push(String(u)), new Response('ok'))) as typeof fetch };
    installOutageSwitch(g);
    setOutage(true);
    await expect(g.fetch('https://firebasevertexai.googleapis.com/v1beta/x:generateContent')).rejects.toThrow(TypeError);
    await g.fetch('https://content-firebaseappcheck.googleapis.com/v1/token');
    setOutage(false);
    await g.fetch('https://firebasevertexai.googleapis.com/v1beta/x:generateContent');
    expect(seen).toEqual(['https://content-firebaseappcheck.googleapis.com/v1/token', 'https://firebasevertexai.googleapis.com/v1beta/x:generateContent']);
  });
});
