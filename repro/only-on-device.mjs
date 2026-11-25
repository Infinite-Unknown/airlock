// Minimal repro: in the Firebase JS SDK (firebase 13.4.0, firebase/ai), a model created with
// InferenceMode.ONLY_ON_DEVICE sends the prompt to the cloud when the environment has no
// LanguageModel (Chrome Prompt API) at all. With the API present but the model unavailable,
// the same call throws, as documented. Uses the SDK's browser build; fetch is stubbed so the
// request is recorded instead of sent.
//
// Run: node repro/only-on-device.mjs
import { initializeApp } from 'firebase/app';

// The browser build of firebase/ai (the code a web page runs). Node's package resolution would pick
// the Node build, which has no on-device support at all, so it is loaded by path.
const { getAI, getGenerativeModel, GoogleAIBackend, InferenceMode } = await import(
  new URL('../node_modules/@firebase/ai/dist/esm/index.esm.js', import.meta.url).href
);

const sent = [];
globalThis.fetch = async (url, init) => {
  sent.push({ url: String(url), body: String(init?.body ?? '') });
  const answer = { candidates: [{ content: { role: 'model', parts: [{ text: 'answer from the cloud' }] } }] };
  return new Response(JSON.stringify(answer), { status: 200, headers: { 'content-type': 'application/json' } });
};

const app = initializeApp({ apiKey: 'repro-key', projectId: 'repro-project', appId: '1:0:web:0' });
const ai = getAI(app, { backend: new GoogleAIBackend() });
const prompt = 'Find the personal details in: "Aisyah binti Rahman, IC 900101-14-5678"';

async function attempt(label) {
  const model = getGenerativeModel(ai, { mode: InferenceMode.ONLY_ON_DEVICE });
  const before = sent.length;
  try {
    const r = await model.generateContent(prompt);
    const req = sent.slice(before);
    console.log(`${label}\n  inferenceSource: ${r.response.inferenceSource}\n  requests sent: ${req.length}${req.length ? `\n  to: ${req[0].url}\n  body contains the private text: ${req[0].body.includes('900101-14-5678')}` : ''}`);
    return { source: r.response.inferenceSource, requests: req };
  } catch (e) {
    console.log(`${label}\n  threw: ${e.code ?? ''} ${e.message}\n  requests sent: ${sent.length - before}`);
    return { error: e, requests: sent.slice(before) };
  }
}

// 1. No LanguageModel API (Firefox, Safari, Chromium without the Prompt API, Node)
delete globalThis.LanguageModel;
const a = await attempt('1. ONLY_ON_DEVICE, environment has no LanguageModel API:');

// 2. LanguageModel API present, model unavailable on this device
globalThis.LanguageModel = { availability: async () => 'unavailable', create: async () => { throw new Error('unavailable'); } };
const b = await attempt('2. ONLY_ON_DEVICE, LanguageModel API present but model unavailable:');
delete globalThis.LanguageModel;

export const result = { noApi: a, apiUnavailable: b };
