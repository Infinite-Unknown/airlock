// Documents the Firebase JS SDK behaviour the app guards against (see repro/only-on-device.mjs).
// If a future SDK version stops sending ONLY_ON_DEVICE requests to the cloud, this test fails and
// the README note can be updated.
import { describe, expect, it } from 'vitest';
import { result } from '../repro/only-on-device.mjs';

describe('firebase/ai ONLY_ON_DEVICE (browser build)', () => {
  it('sends the prompt to the cloud when there is no LanguageModel API', () => {
    expect(result.noApi.source).toBe('in_cloud');
    expect(result.noApi.requests).toHaveLength(1);
    expect(result.noApi.requests[0].url).toMatch(/:generateContent$/);
    expect(result.noApi.requests[0].body).toContain('900101-14-5678');
  });

  it('throws, and sends nothing, when the API exists but the model is unavailable', () => {
    expect(result.apiUnavailable.error).toBeDefined();
    expect(result.apiUnavailable.requests).toHaveLength(0);
  });
});
