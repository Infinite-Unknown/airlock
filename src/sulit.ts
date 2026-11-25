import { detectWithRules, type Entity, ENTITY_TYPES, type EntityType } from './rules';
import { expandNames, findLeaks, mergeEntities, redact, restore, type Redaction } from './redact';

/** The subset of a Firebase AI Logic GenerativeModel that Sulit uses. */
export interface TextModel {
  generateContent(prompt: string): Promise<{
    response: { text(): string; inferenceSource?: 'on_device' | 'in_cloud' };
  }>;
}

export type OnDeviceStatus = 'available' | 'downloadable' | 'downloading' | 'unavailable' | 'no-api';

interface LanguageModelStatic {
  availability(options?: unknown): Promise<string>;
}

const ON_DEVICE_OPTIONS = {
  expectedInputs: [{ type: 'text', languages: ['en'] }],
  expectedOutputs: [{ type: 'text', languages: ['en'] }],
};

/**
 * Ask Chrome whether Gemini Nano can run here.
 *
 * This check is Sulit's own and is deliberate: in Firebase AI Logic, when the
 * browser has no LanguageModel API at all, a model created with ONLY_ON_DEVICE
 * gets no on-device adapter and sends the request to the cloud instead. For a
 * redaction step that would mean shipping the raw text out, so Sulit never
 * calls the detector unless this returns 'available'.
 */
export async function checkOnDevice(g: unknown = globalThis): Promise<OnDeviceStatus> {
  const lm = (g as { LanguageModel?: LanguageModelStatic }).LanguageModel;
  if (!lm || typeof lm.availability !== 'function') return 'no-api';
  try {
    const a = await lm.availability(ON_DEVICE_OPTIONS);
    if (a === 'available' || a === 'downloadable' || a === 'downloading' || a === 'unavailable') return a;
    return 'unavailable';
  } catch {
    return 'unavailable';
  }
}

export function detectorPrompt(text: string): string {
  return [
    'You are a privacy filter for a clinic front desk in Malaysia. List every piece of personal or identifying data in the TEXT below.',
    'The TEXT may be in English, Bahasa Melayu, or a mix of both.',
    'Include:',
    '- people\'s names: full names and names used on their own (Malay, Chinese, Indian and other names, e.g. "Nurul Aina binti Kamarudin", "Tan Wei Ming", "Priya a/p Subramaniam"), even when written in lowercase or when the name is also an ordinary word (Hope, Joy, Intan, May);',
    '- street addresses; emails (also written as "name at example dot com"); phone numbers; IC / MyKad / passport / staff / student numbers; bank account and card numbers; dates of birth;',
    '- numbers written as words ("zero one two ...", "kosong satu dua ...") or split into parts: list each part as it appears.',
    'Do not include: appointment dates, weekdays, times, ages, money amounts, class names, medicines, towns on their own, or generic words.',
    'Copy each item exactly as it appears in the TEXT.',
    'Answer as JSON: {"entities":[{"text":"...","type":"PERSON|ADDRESS|EMAIL|PHONE|ID_NUMBER|ACCOUNT_NUMBER|DATE_OF_BIRTH|ORGANIZATION|OTHER"}]}',
    '',
    'TEXT:',
    text,
  ].join('\n');
}

const STREET_WORD = /\b(jalan|jln|lorong|lrg|lot|no\.?|taman|tmn|kampung|kg|blok|block|unit|level|tingkat|persiaran|lebuh|street|road|lane|avenue|residensi|pangsapuri|apartment|kondominium|condo)\b/i;

/**
 * Drop on-device answers that do not look like the type they claim: a "date of birth" with no year
 * (an appointment date), an "address" with no street word or postcode (a town or a class name),
 * a time or an age. The small model over-reports these; the user can still hide anything by hand.
 */
export function plausible(e: Entity): boolean {
  const t = e.text.trim();
  if (e.type === 'DATE_OF_BIRTH') return /\b(19|20)\d{2}\b|\b\d{1,2}[/.-]\d{1,2}[/.-]\d{2}\b/.test(t);
  if (e.type === 'ADDRESS') return /\b\d{5}\b/.test(t) || (STREET_WORD.test(t) && /\d/.test(t));
  if (e.type === 'OTHER')
    return !/^\d{1,2}([.:]\d{2})?\s*(am|pm|pagi|petang|malam)$|year-old$|^umur\s+\d+|^\d+\s+tahun$/i.test(t);
  return true;
}

/** Parse the detector's JSON. Tolerates code fences and stray prose around the JSON. */
export function parseEntities(raw: string): Entity[] {
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start < 0 || end <= start) return [];
  try {
    const data = JSON.parse(raw.slice(start, end + 1)) as { entities?: { text?: unknown; type?: unknown }[] };
    return (data.entities ?? [])
      .filter((e) => typeof e.text === 'string')
      .map((e) => ({
        text: String(e.text),
        type: (ENTITY_TYPES.includes(e.type as EntityType) ? e.type : 'OTHER') as EntityType,
        source: 'on-device' as const,
      }))
      .filter(plausible);
  } catch {
    return [];
  }
}

export interface DetectResult {
  entities: Entity[];
  usedOnDevice: boolean;
  inferenceSource?: string;
  /** The on-device model's raw answer, kept for the benchmark and debugging. Never sent anywhere. */
  raw?: string;
}

/**
 * Step 1, entirely local: pattern rules, plus Gemini Nano when Chrome has it.
 * `onDevice` must come from checkOnDevice(); the detector is only called when it is 'available'.
 */
export async function detect(text: string, detector: TextModel, onDevice: OnDeviceStatus): Promise<DetectResult> {
  const rules = detectWithRules(text);
  if (onDevice !== 'available') {
    return { entities: mergeEntities(text, rules), usedOnDevice: false };
  }
  const result = await detector.generateContent(detectorPrompt(text));
  const source = result.response.inferenceSource;
  if (source && source !== 'on_device') {
    // Should be impossible after the availability check; refuse rather than trust it.
    throw new Error(`Redaction ran ${source}, not on-device. Stopping.`);
  }
  const raw = result.response.text();
  const model = parseEntities(raw);
  const entities = expandNames(text, mergeEntities(text, rules, model));
  return { entities, usedOnDevice: true, inferenceSource: source, raw };
}

export interface Task {
  label: string;
  prompt: string;
  /** writer: PREFER_IN_CLOUD by default; quick: PREFER_ON_DEVICE by default (see settings.ts). */
  model: 'writer' | 'quick';
}

export const TASKS = {
  reply: {
    label: 'Draft a reply (English)',
    model: 'writer',
    prompt: 'Draft a short, warm, professional reply to this message from a clinic front desk. Sign off as "the front desk".',
  },
  reply_ms: {
    label: 'Draft a reply in Bahasa Melayu',
    model: 'writer',
    prompt: 'Draft a short, warm, professional reply to this message in Bahasa Melayu, from a clinic front desk. Sign off as "Kaunter hadapan".',
  },
  summary: {
    label: 'Summarise for a colleague',
    model: 'writer',
    prompt: 'Summarise this message in 3 bullet points for a colleague, then list any deadline.',
  },
  actions: {
    label: 'Extract action items',
    model: 'writer',
    prompt: 'Extract the action items as a checklist. Say who has to do each one and by when, if stated.',
  },
  triage: {
    label: 'Quick triage (on this device)',
    model: 'quick',
    prompt:
      'Triage this message for a clinic front desk. Answer in exactly two short lines, in English:\nRoute: front desk, doctor, nurse or billing\nUrgency: urgent, today or routine, with a reason of at most eight words.',
  },
} satisfies Record<string, Task>;
export type TaskId = keyof typeof TASKS | 'custom';

export function writerPrompt(task: string, redacted: string): string {
  return [
    task,
    '',
    'Some details in the message were replaced with placeholders such as [PERSON_1] or [PHONE_1] to protect privacy.',
    'Use the placeholders exactly as written wherever you refer to those details. Never invent the real values.',
    '',
    'MESSAGE:',
    redacted,
  ].join('\n');
}

export interface WriteResult {
  prompt: string; // exactly what was sent
  cloudText: string; // what came back, still with placeholders
  restored: string; // placeholders replaced locally with the real values
  inferenceSource?: string;
}

/** Step 2: send only the redacted text. Step 3: restore locally. */
export async function write(task: string, redaction: Redaction, writer: TextModel): Promise<WriteResult> {
  const prompt = writerPrompt(task, redaction.redacted);
  // Check the parts that can carry user text (the task may be typed by the user).
  const leaks = findLeaks(`${task}\n${redaction.redacted}`, redaction.placeholders);
  if (leaks.length) throw new Error(`Refusing to send: ${leaks.length} redacted value(s) still in the payload.`);
  const result = await writer.generateContent(prompt);
  const cloudText = result.response.text();
  return {
    prompt,
    cloudText,
    restored: restore(cloudText, redaction.placeholders),
    inferenceSource: result.response.inferenceSource,
  };
}

export { redact, restore, findLeaks, mergeEntities };
