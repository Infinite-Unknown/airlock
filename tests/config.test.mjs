import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { REMOTE_DEFAULTS } from '../src/settings';

describe('Remote Config template', () => {
  it('publishes the same defaults the app falls back to, and no redaction-mode parameter', () => {
    const t = JSON.parse(readFileSync(new URL('../remoteconfig.template.json', import.meta.url), 'utf8'));
    const values = Object.fromEntries(Object.entries(t.parameters).map(([k, v]) => [k, v.defaultValue.value]));
    expect(values).toEqual(REMOTE_DEFAULTS);
    expect(Object.keys(values).some((k) => /detect|redact/.test(k))).toBe(false);
  });
});
