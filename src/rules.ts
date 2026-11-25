// Deterministic, local pattern rules. They run before any model and catch the
// structured identifiers that a small model is most likely to miss or garble.

export type EntityType =
  | 'PERSON'
  | 'ADDRESS'
  | 'EMAIL'
  | 'PHONE'
  | 'ID_NUMBER'
  | 'ACCOUNT_NUMBER'
  | 'DATE_OF_BIRTH'
  | 'ORGANIZATION'
  | 'OTHER';

export const ENTITY_TYPES: EntityType[] = [
  'PERSON',
  'ADDRESS',
  'EMAIL',
  'PHONE',
  'ID_NUMBER',
  'ACCOUNT_NUMBER',
  'DATE_OF_BIRTH',
  'ORGANIZATION',
  'OTHER',
];

export type EntitySource = 'rule' | 'on-device' | 'manual';

export interface Entity {
  text: string;
  type: EntityType;
  source: EntitySource;
}

interface Rule {
  type: EntityType;
  pattern: RegExp;
  validate?: (match: string) => boolean;
}

function luhn(digits: string): boolean {
  const d = digits.replace(/\D/g, '');
  if (d.length < 13 || d.length > 19) return false;
  let sum = 0;
  let double = false;
  for (let i = d.length - 1; i >= 0; i--) {
    let n = d.charCodeAt(i) - 48;
    if (double) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
    double = !double;
  }
  return sum % 10 === 0;
}

/** Valid MyKad: YYMMDD is a real date and PB is an assigned place-of-birth code. */
export function isMyKad(digits: string): boolean {
  if (!/^\d{12}$/.test(digits)) return false;
  const m = +digits.slice(2, 4);
  const d = +digits.slice(4, 6);
  const pb = +digits.slice(6, 8);
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  return (pb >= 1 && pb <= 16) || (pb >= 21 && pb <= 68) || pb === 71 || pb === 72 || (pb >= 74 && pb <= 79) || (pb >= 82 && pb <= 93) || pb === 98 || pb === 99;
}

/** Malaysian phone number in any common format: 012-345 6789, 0123456789, +60 12-345 6789, (03) 2345 6789. */
export function isMyPhone(raw: string): boolean {
  let d = raw.replace(/^O/, '0').replace(/\D/g, '');
  if (raw.trim().startsWith('+')) {
    if (!d.startsWith('60')) return d.length >= 9 && d.length <= 15; // other countries: trust the + sign
    d = d.slice(2);
  } else if (d.startsWith('60') && d.length >= 10 && d.length <= 12) d = d.slice(2);
  else if (d.startsWith('0')) d = d.slice(1);
  else return false;
  return /^1[02-9]\d{7}$|^11\d{8}$|^3\d{8}$|^[4-79]\d{7}$|^8[2-9]\d{6}$/.test(d);
}

const DIGIT_WORDS: Record<string, string> = {
  zero: '0', oh: '0', one: '1', two: '2', three: '3', four: '4', five: '5', six: '6', seven: '7', eight: '8', nine: '9',
  kosong: '0', sifar: '0', satu: '1', dua: '2', tiga: '3', empat: '4', lima: '5', enam: '6', tujuh: '7', lapan: '8', sembilan: '9',
};
const DW = Object.keys(DIGIT_WORDS).join('|');

const RULES: Rule[] = [
  { type: 'EMAIL', pattern: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g },
  // Emails written out to dodge filters: "nurul.aina at example dot com", "g.anand (at) example (dot) com"
  {
    type: 'EMAIL',
    pattern: /\b[A-Za-z0-9._%+-]+(?:\s+dot\s+[A-Za-z0-9_%+-]+)*\s*(?:\(at\)|\[at\]|\sat\s)\s*[A-Za-z0-9-]+(?:\s*(?:\(dot\)|\[dot\]|\sdot\s)\s*[A-Za-z0-9-]+)+/gi,
  },
  // Malaysian MyKad / NRIC: YYMMDD-PB-###G, also without dashes or with spaces (date and PB code checked)
  { type: 'ID_NUMBER', pattern: /\b\d{6}-\d{2}-\d{4}\b/g },
  { type: 'ID_NUMBER', pattern: /\b\d{6}[ -]?\d{2}[ -]?\d{4}\b/g, validate: (m) => isMyKad(m.replace(/\D/g, '')) },
  // US SSN
  { type: 'ID_NUMBER', pattern: /\b\d{3}-\d{2}-\d{4}\b/g },
  // Passport-style: one or two letters followed by 7-8 digits
  { type: 'ID_NUMBER', pattern: /\b[A-Z]{1,2}\d{7,8}\b/g },
  // Payment cards (validated with Luhn so order numbers are not caught)
  { type: 'ACCOUNT_NUMBER', pattern: /\b(?:\d[ -]?){12,18}\d\b/g, validate: luhn },
  // IBAN
  { type: 'ACCOUNT_NUMBER', pattern: /\b[A-Z]{2}\d{2}(?:[ ]?[A-Z0-9]{4}){2,7}(?:[ ]?[A-Z0-9]{1,3})?\b/g },
  // Phone numbers: Malaysian formats (checked by isMyPhone), with or without separators, "O" typed for zero
  {
    type: 'PHONE',
    pattern: /(?<![\w+])(?:\+\s?)?(?:\d|O(?=\d)|\(\d)[\d() -]{6,17}\d(?![\d])/g,
    validate: isMyPhone,
  },
  // Other phone numbers: international (+44 20 7946 0958) or local ((555) 123-4567)
  {
    type: 'PHONE',
    pattern: /(?:\+\d{1,3}[ -]?)?(?:\(\d{2,4}\)[ -]?|\b0?\d{1,3}[ -])\d{3,4}[ -]?\d{3,4}\b/g,
    validate: (m) => m.replace(/\D/g, '').length >= 9,
  },
  // Account and ID numbers after a keyword: "account 1621 2345 6789", "akaun saya 5-0272712-00", "staff ID S85916"
  {
    type: 'ACCOUNT_NUMBER',
    pattern: /(?<=\b(?:account|acct|acc|a\/c|akaun(?: simpanan)?)(?:\s+(?:no\.?|number|is|saya|baru))*[\s:.]+)\d[\d -]{6,20}\d\b/gi,
    validate: (m) => m.replace(/\D/g, '').length >= 8,
  },
  {
    type: 'ID_NUMBER',
    pattern: /(?<=\b(?:employee|staff|student|pekerja|epf|kwsp|passport|pasport|policy|sijil lahir|kp|mykid|mykad|ic|nric)(?:\s+(?:no\.?|number|id|num|is))*[\s:.]+)[A-Z]{0,3}[ -]?\d{4,12}\b/gi,
  },
  // Digits written as words, as people dictate numbers: "zero one two, three four five ...", "kosong satu dua ..."
  {
    type: 'PHONE',
    pattern: new RegExp(`\\b(?:${DW})(?:[\\s,.-]+(?:${DW})){7,}\\b`, 'gi'),
  },
  // Date of birth after a keyword: "date of birth 03/07/1985", "born 12 March 1988", "tarikh lahir 9 Ogos 1991"
  {
    type: 'DATE_OF_BIRTH',
    pattern: /(?<=\b(?:date of birth|d\.?o\.?b\.?|born(?: on)?|tarikh lahir|lahir(?: pada)?)[\s:,]+)(?:\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}|\d{4}-\d{2}-\d{2}|\d{1,2}\s+[A-Z][a-z]+\s+\d{4})/gi,
  },
  // Malaysian street address: a house / lot / unit number, then up to a 5-digit postcode and town (and state)
  {
    type: 'ADDRESS',
    pattern: new RegExp(
      String.raw`(?<![\w-])(?:(?:Lot|Unit|Blok|Block|Level|Tingkat)\s+)?[A-Z]?-?\d{1,5}[A-Z]?(?:-\d{1,3}[A-Z]?){0,2},\s+[^.\n;:()]{3,110}?\b\d{5}\s+[A-Z][A-Za-z]+(?:\s+[A-Z][A-Za-z]+){0,2}` +
        String.raw`(?:,\s*(?:Selangor|Johor|Kedah|Kelantan|Melaka|Negeri Sembilan|Pahang|Pulau Pinang|Penang|Perak|Perlis|Terengganu|Sabah|Sarawak|Kuala Lumpur|Putrajaya|Labuan))?`,
      'g',
    ),
  },
  // IPv4
  { type: 'OTHER', pattern: /\b(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)\b/g },
];

/** Digits spelled out as words, turned back into digits ("kosong satu dua" -> "012"). */
export function spelledDigits(text: string): string {
  return (text.toLowerCase().match(new RegExp(DW, 'g')) ?? []).map((w) => DIGIT_WORDS[w]).join('');
}

/** Run every local rule over the text. Returns unique entities in order of first appearance. */
export function detectWithRules(text: string): Entity[] {
  const found: { index: number; entity: Entity }[] = [];
  const claimed: [number, number][] = [];
  const overlaps = (s: number, e: number) => claimed.some(([a, b]) => s < b && e > a);

  for (const rule of RULES) {
    rule.pattern.lastIndex = 0;
    for (const m of text.matchAll(rule.pattern)) {
      const value = m[0].trim();
      const start = m.index ?? 0;
      const end = start + m[0].length;
      if (!value || overlaps(start, end)) continue;
      if (rule.validate && !rule.validate(value)) continue;
      claimed.push([start, end]);
      const type = rule.type === 'PHONE' && /[a-z]{3}/i.test(value) && isMyKad(spelledDigits(value)) ? 'ID_NUMBER' : rule.type;
      found.push({ index: start, entity: { text: value, type, source: 'rule' } });
    }
  }
  found.sort((a, b) => a.index - b.index);
  const seen = new Set<string>();
  return found
    .map((f) => f.entity)
    .filter((e) => (seen.has(e.text) ? false : (seen.add(e.text), true)));
}
