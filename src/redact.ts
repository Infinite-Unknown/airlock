import { ENTITY_TYPES, type Entity, type EntityType } from './rules';

export interface Placeholder {
  token: string; // e.g. [PERSON_1]
  value: string; // the real value, never sent anywhere
  type: EntityType;
  source: Entity['source'];
}

export interface Redaction {
  redacted: string;
  placeholders: Placeholder[];
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Matches a value as a whole word (when it starts/ends with a word character), any case. */
function valueRe(value: string, flags: string): RegExp {
  const pre = /^\w/.test(value) ? '\\b' : '';
  const post = /\w$/.test(value) ? '\\b' : '';
  return new RegExp(pre + escapeRe(value) + post, flags);
}

/**
 * Merge entity lists. The first list wins on duplicates (rules come first, so a
 * phone number keeps its PHONE type even if the model calls it OTHER).
 * Entities that do not literally occur in the source text are dropped: a model
 * can only ever point at text, never invent it.
 */
export function mergeEntities(source: string, ...lists: Entity[][]): Entity[] {
  const out: Entity[] = [];
  const seen = new Set<string>();
  for (const list of lists) {
    for (const e of list) {
      const text = e.text?.trim();
      if (!text || text.length < 2) continue;
      if (!ENTITY_TYPES.includes(e.type)) continue;
      if (!source.includes(text)) continue;
      const key = text.toLowerCase();
      if (seen.has(key)) continue;
      // A pattern-rule match already covers this value (e.g. the model returns "IC 900101-14-5678"
      // where a rule found "900101-14-5678"): keep the rule's, drop the overlapping one.
      if (
        e.source !== 'rule' &&
        out.some((o) => o.source === 'rule' && (key.includes(o.text.toLowerCase()) || o.text.toLowerCase().includes(key)))
      )
        continue;
      seen.add(key);
      out.push({ ...e, text });
    }
  }
  return out;
}

// Words inside a name that are not names on their own (Malay patronymics, Indian a/l a/p, titles).
const NAME_STOP = new Set(
  'bin binti bte bt a/l a/p s/o d/o anak de da dos van von al el dr encik puan cik mr mrs ms madam haji hajah datuk dato datin tan sri mohd muhammad md nur nurul siti abdul syed sharifah wan tengku nik che raja'.split(' '),
);

/**
 * When a full name is hidden ("Hope Tingang"), also hide its parts where they are used on their own
 * elsewhere in the message ("I hope the doctor can see Hope today"). Only capitalised parts that
 * really occur on their own are added. Pattern-rule matches are never expanded.
 */
export function expandNames(source: string, entities: Entity[]): Entity[] {
  const extra: Entity[] = [];
  const countOf = (needle: string) =>
    [...source.matchAll(new RegExp(`(?<![\\p{L}\\p{N}])${escapeRe(needle)}(?![\\p{L}\\p{N}])`, 'gu'))].length;
  for (const e of entities) {
    if (e.type !== 'PERSON' || e.source === 'rule') continue;
    const parts = e.text.split(/\s+/);
    if (parts.length < 2) continue;
    const whole = countOf(e.text);
    for (const p of parts) {
      if (p.length < 3 || NAME_STOP.has(p.toLowerCase()) || !/^\p{Lu}/u.test(p)) continue;
      if (countOf(p) > whole) extra.push({ text: p, type: 'PERSON', source: e.source });
    }
  }
  return extra.length ? mergeEntities(source, entities, extra) : entities;
}

/**
 * Replace every occurrence of every entity with a stable placeholder.
 * Longer values are replaced first so "Aisyah binti Rahman" is not split by "Aisyah".
 */
export function redact(source: string, entities: Entity[]): Redaction {
  const counters = new Map<EntityType, number>();
  // Number placeholders in reading order (longer value first when two start at the same place).
  const lowerSource = source.toLowerCase();
  const ordered = [...entities].sort(
    (a, b) =>
      lowerSource.indexOf(a.text.toLowerCase()) - lowerSource.indexOf(b.text.toLowerCase()) ||
      b.text.length - a.text.length,
  );
  const placeholders: Placeholder[] = ordered.map((e) => {
    const n = (counters.get(e.type) ?? 0) + 1;
    counters.set(e.type, n);
    return { token: `[${e.type}_${n}]`, value: e.text, type: e.type, source: e.source };
  });

  const byLength = [...placeholders].sort((a, b) => b.value.length - a.value.length);
  let redacted = source;
  for (const p of byLength) {
    redacted = redacted.replace(valueRe(p.value, 'gi'), p.token);
  }
  return { redacted, placeholders };
}

/** Put the real values back into text the cloud model wrote. Runs locally. */
export function restore(text: string, placeholders: Placeholder[]): string {
  let out = text;
  for (const p of placeholders) {
    // Tolerate the model dropping the brackets or changing case: [PERSON_1], PERSON_1, [person_1]
    const inner = escapeRe(p.token.slice(1, -1));
    out = out.replace(new RegExp(`\\[?\\b${inner}\\b\\]?`, 'gi'), p.value);
  }
  return out;
}

/** Where `value` occurs in `source`, matched the same way redact() replaces it. Returns [start, end) pairs. */
export function occurrences(source: string, value: string): [number, number][] {
  return [...source.matchAll(valueRe(value, 'gi'))].map((m) => [m.index ?? 0, (m.index ?? 0) + m[0].length]);
}

/** Values that would still leave the device in `payload`. Must be empty before any cloud call. */
export function findLeaks(payload: string, placeholders: Placeholder[]): string[] {
  return placeholders
    .filter((p) => valueRe(p.value, 'i').test(payload))
    .map((p) => p.value);
}
