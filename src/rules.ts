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

const RULES: Rule[] = [
  { type: 'EMAIL', pattern: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g },
  // Malaysian MyKad / NRIC: YYMMDD-PB-###G
  { type: 'ID_NUMBER', pattern: /\b\d{6}-\d{2}-\d{4}\b/g },
  // US SSN
  { type: 'ID_NUMBER', pattern: /\b\d{3}-\d{2}-\d{4}\b/g },
  // Passport-style: one or two letters followed by 7-8 digits
  { type: 'ID_NUMBER', pattern: /\b[A-Z]{1,2}\d{7,8}\b/g },
  // Payment cards (validated with Luhn so order numbers are not caught)
  { type: 'ACCOUNT_NUMBER', pattern: /\b(?:\d[ -]?){12,18}\d\b/g, validate: luhn },
  // IBAN
  { type: 'ACCOUNT_NUMBER', pattern: /\b[A-Z]{2}\d{2}(?:[ ]?[A-Z0-9]{4}){2,7}(?:[ ]?[A-Z0-9]{1,3})?\b/g },
  // Phone numbers: international (+60 12-345 6789) or local (012-345 6789, (555) 123-4567)
  {
    type: 'PHONE',
    pattern: /(?:\+\d{1,3}[ -]?)?(?:\(\d{2,4}\)[ -]?|\b0?\d{1,3}[ -])\d{3,4}[ -]?\d{3,4}\b/g,
    validate: (m) => m.replace(/\D/g, '').length >= 9,
  },
  // IPv4
  { type: 'OTHER', pattern: /\b(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)\b/g },
];

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
      found.push({ index: start, entity: { text: value, type: rule.type, source: 'rule' } });
    }
  }
  found.sort((a, b) => a.index - b.index);
  const seen = new Set<string>();
  return found
    .map((f) => f.entity)
    .filter((e) => (seen.has(e.text) ? false : (seen.add(e.text), true)));
}
