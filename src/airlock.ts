import { detectWithRules, type Entity, ENTITY_TYPES, type EntityType } from './rules';
import { findLeaks, mergeEntities, redact, restore, type Redaction } from './redact';

/** The subset of a Firebase AI Logic GenerativeModel that Airlock uses. */
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
 * This check is Airlock's own and is deliberate: in Firebase AI Logic, when the
 * browser has no LanguageModel API at all, a model created with ONLY_ON_DEVICE
 * gets no on-device adapter and sends the request to the cloud instead. For a
 * redaction step that would mean shipping the raw text out, so Airlock never
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
    'You are a privacy filter. List every piece of personal or identifying data in the TEXT below.',
    'Include: people\'s names (full names and first names), street addresses, emails, phone numbers,',
    'national ID / passport / IC numbers, bank or card numbers, dates of birth, and employer or school names',
    'that identify a person. Copy each item exactly as it appears in the TEXT. Do not include generic words.',
    'Answer as JSON: {"entities":[{"text":"...","type":"PERSON|ADDRESS|EMAIL|PHONE|ID_NUMBER|ACCOUNT_NUMBER|DATE_OF_BIRTH|ORGANIZATION|OTHER"}]}',
    '',
    'TEXT:',
    text,
  ].join('\n');
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
      }));
  } catch {
    return [];
  }
}

export interface DetectResult {
  entities: Entity[];
  usedOnDevice: boolean;
  inferenceSource?: string;
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
  const model = parseEntities(result.response.text());
  return { entities: mergeEntities(text, rules, model), usedOnDevice: true, inferenceSource: source };
}

export const TASKS = {
  reply: 'Draft a short, warm, professional reply to this message. Sign off as "the team".',
  summary: 'Summarise this message in 3 bullet points for a colleague, then list any deadline.',
  actions: 'Extract the action items as a checklist. Say who has to do each one and by when, if stated.',
} as const;
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
