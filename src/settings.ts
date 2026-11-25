// Model names and inference modes, set from Firebase Remote Config with local defaults.
//
// Only the models that see redacted text are configurable. The redaction model is pinned to
// ONLY_ON_DEVICE in code and is deliberately not a Remote Config parameter: a remote switch
// that could send raw text to the cloud would undo the whole point.

export type Mode = 'prefer_on_device' | 'only_on_device' | 'only_in_cloud' | 'prefer_in_cloud';
export const MODES: Mode[] = ['prefer_on_device', 'only_on_device', 'only_in_cloud', 'prefer_in_cloud'];

export interface Settings {
  /** Cloud Gemini model for the writer and the quick task. */
  cloudModel: string;
  /** Writer (draft reply, summary, action items): cloud first, Gemini Nano if the cloud is unreachable. */
  writerMode: Mode;
  /** Quick task (triage): Gemini Nano first, cloud only if Nano is missing. */
  quickMode: Mode;
  /** Where the values came from. */
  source: 'remote' | 'defaults';
}

/** Remote Config parameter keys and their in-app defaults (also the values to create in the console). */
export const REMOTE_DEFAULTS = {
  cloud_model: 'gemini-3.5-flash-lite',
  writer_mode: 'prefer_in_cloud',
  quick_mode: 'prefer_on_device',
} as const;
export type RemoteKey = keyof typeof REMOTE_DEFAULTS;

const MODEL_RE = /^gemini-[a-z0-9.-]{1,60}$/;

/** Turn raw Remote Config strings into settings. Anything missing or malformed falls back to the default. */
export function parseSettings(
  values: Partial<Record<RemoteKey, string>>,
  source: Settings['source'],
  defaults: Record<RemoteKey, string> = REMOTE_DEFAULTS,
): Settings {
  const mode = (v: string | undefined, d: string) => (MODES.includes(v as Mode) ? (v as Mode) : (d as Mode));
  const model = values.cloud_model?.trim();
  return {
    cloudModel: model && MODEL_RE.test(model) ? model : defaults.cloud_model,
    writerMode: mode(values.writer_mode?.trim(), defaults.writer_mode),
    quickMode: mode(values.quick_mode?.trim(), defaults.quick_mode),
    source,
  };
}

/** Short human wording for a mode, shown next to the task picker. */
export function describeMode(m: Mode): string {
  return {
    prefer_in_cloud: 'Cloud first; Gemini Nano on this device if the cloud is unreachable',
    only_in_cloud: 'Cloud only',
    prefer_on_device: 'Gemini Nano on this device first; cloud only if Nano is missing',
    only_on_device: 'Gemini Nano on this device only',
  }[m];
}
