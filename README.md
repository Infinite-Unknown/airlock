# Airlock

**Redact on your device. Let the cloud write. Put the real details back locally.**

Front-desk staff, support agents and HR teams paste messages full of personal data into cloud AI every day: names, IC numbers, phone numbers, home addresses, card numbers. Airlock lets them keep using a strong cloud model without sending any of that.

Airlock is a web app built on **Firebase AI Logic hybrid inference**:

1. **Redact, on this device.** Gemini Nano runs in Chrome (through Firebase AI Logic, `InferenceMode.ONLY_ON_DEVICE`) together with local pattern rules, and marks every personal detail. Each one is replaced with a placeholder such as `[PERSON_1]` or `[ID_NUMBER_1]`.
2. **Review what leaves.** The middle panel shows exactly the text the cloud will see. You can un-hide a detail or hide anything that was missed.
3. **Write, in the cloud.** Only the redacted text goes to Gemini in the cloud (Firebase AI Logic, `InferenceMode.PREFER_IN_CLOUD`) for the real task: draft a reply, summarise, or extract action items. The writer model is set to prefer the cloud and fall back to Gemini Nano on network errors, and the result shows which one answered (`inferenceSource`).
4. **Restore, on this device.** The answer comes back with placeholders. Airlock puts the real values back locally and highlights them.

An **egress log** records every request that left the device, with its full payload.

## Why hybrid, and why the on-device check matters

Hybrid inference here is a privacy boundary, not only a cost or latency trick. The small model on the device decides what is private, and the large model in the cloud only ever sees the redacted text.

That boundary has to be enforced on purpose. In the Firebase JS SDK (`firebase` 13.4.0), when the browser has **no** `LanguageModel` API at all, a model created with `ONLY_ON_DEVICE` gets no on-device adapter and the request goes to the cloud. For a redaction step that would send the raw text out. So Airlock checks `LanguageModel.availability()` itself (`checkOnDevice()` in `src/airlock.ts`) and only calls the on-device model when the answer is `available`. It also rejects any redaction result whose `inferenceSource` is not `on_device`.

When Gemini Nano is not available, Airlock does **not** fall back to the cloud for redaction. It runs the local pattern rules only (emails, phone numbers, Malaysian IC / NRIC, SSN, passport-style IDs, Luhn-valid card numbers, IBANs, IPv4), shows a warning, lets you hide names and addresses by hand, and asks you to confirm before anything is sent. A final check refuses to send if any hidden value is still in the payload.

## Run it

Requirements: Node.js 20+.

```bash
npm install
cp .env.example .env      # then fill in your Firebase web config (below)
npm run dev               # http://localhost:5173
```

Without a `.env` the app still runs: redaction and review work, and the cloud step is turned off with a clear message.

### Firebase setup (free tier)

1. Create a Firebase project in the [Firebase console](https://console.firebase.google.com/) and add a **Web app**.
2. Open **AI Logic** in the console and enable the **Gemini Developer API**.
3. Copy the web app config values into `.env` (`VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_PROJECT_ID`, `VITE_FIREBASE_APP_ID`, and the rest).
4. Optional, recommended: **App Check** with reCAPTCHA Enterprise. Put the site key in `VITE_RECAPTCHA_ENTERPRISE_SITE_KEY`. For local testing with enforcement on, set `VITE_APPCHECK_DEBUG_TOKEN=true`, open the app, copy the debug token from the browser console, and register it under App Check > Manage debug tokens.
5. `VITE_CLOUD_MODEL` picks the cloud model (default `gemini-3.5-flash-lite`).

### Gemini Nano in Chrome

The on-device step needs Google Chrome with the built-in Prompt API and the Gemini Nano model. See the Firebase guide for [hybrid on-device inference on the web](https://firebase.google.com/docs/ai-logic/hybrid-on-device-inference) and Chrome's [built-in AI](https://developer.chrome.com/docs/ai/get-started) hardware requirements. If Chrome reports the model as downloadable, the first press of **Redact on this device** asks Chrome to download it and shows progress; if no progress arrives for 30 seconds, that redaction uses the pattern rules only.

### Other commands

```bash
npm test          # unit tests (vitest)
npm run build     # type-check and production build into dist/
npm run demo      # with `npm run dev` running: records assets/demo.mp4 (needs ffmpeg and a Playwright Chromium)
```

## Project layout

| File | What it does |
|---|---|
| `src/firebase.ts` | Firebase app, optional App Check, `getAI()` with the Gemini Developer API backend, the two hybrid models |
| `src/airlock.ts` | On-device availability gate, detector prompt and JSON parsing, cloud task prompt, send-and-restore |
| `src/rules.ts` | Local pattern rules for structured identifiers |
| `src/redact.ts` | Placeholder assignment, restore, leak check |
| `src/main.ts`, `index.html`, `src/style.css` | The three-panel UI and egress log |
| `src/samples.ts` | Fictional sample messages |
| `tests/airlock.test.ts` | Unit tests for rules, redaction, the on-device gate and the send step |

## Tech

TypeScript, Vite, Firebase JS SDK (`firebase/ai`, `firebase/app-check`), Gemini Nano via Chrome's Prompt API, Gemini Developer API, Vitest. Demo recording uses Playwright and ffmpeg.

## Status

Tested so far (Chrome-based browsers without Gemini Nano, no Firebase project yet):

- Pattern-rule redaction, manual hiding and un-hiding, the consent step, the leak check, and the egress log, in the browser and in unit tests.
- The cloud call is a real Firebase AI Logic `generateContent` request: with a placeholder config it reaches `firebasevertexai.googleapis.com` and is rejected for the invalid key, and the captured request body contains only placeholders.

Still to be run: the Gemini Nano redaction step in Chrome with the model installed, and a successful cloud answer with a real Firebase project.

## Known limits

- English prompts only for now (the on-device session is created for English input and output).
- Redaction quality depends on Gemini Nano; the review step is there because no detector is perfect.
- Placeholders are restored by token name; if the cloud model rewrites a placeholder beyond recognition, that spot stays as written.
- Text only. No files or images.

## Licence

Apache License 2.0. See `LICENSE`.
