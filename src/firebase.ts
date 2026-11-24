import { initializeApp, type FirebaseOptions } from 'firebase/app';
import { initializeAppCheck, ReCaptchaEnterpriseProvider } from 'firebase/app-check';
import {
  getAI,
  getGenerativeModel,
  GoogleAIBackend,
  InferenceMode,
  type GenerativeModel,
} from 'firebase/ai';

const env = import.meta.env;

export const firebaseConfig: FirebaseOptions = {
  apiKey: env.VITE_FIREBASE_API_KEY,
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: env.VITE_FIREBASE_APP_ID,
};

/** True when the Firebase web config has been pasted into .env. */
export const cloudConfigured = Boolean(
  firebaseConfig.apiKey && firebaseConfig.projectId && firebaseConfig.appId,
);

export const CLOUD_MODEL: string = env.VITE_CLOUD_MODEL || 'gemini-3.5-flash-lite';

/** JSON Schema the on-device model must answer in (enforced by Chrome's Prompt API responseConstraint). */
export const entitySchema = {
  type: 'object',
  properties: {
    entities: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          text: { type: 'string' },
          type: {
            type: 'string',
            enum: ['PERSON', 'ADDRESS', 'EMAIL', 'PHONE', 'ID_NUMBER', 'ACCOUNT_NUMBER', 'DATE_OF_BIRTH', 'ORGANIZATION', 'OTHER'],
          },
        },
        required: ['text', 'type'],
      },
    },
  },
  required: ['entities'],
};

export interface Models {
  /**
   * Gemini Nano in Chrome, through Firebase AI Logic (ONLY_ON_DEVICE).
   * Only called after checkOnDevice() returns 'available' — see airlock.ts for why.
   */
  detector: GenerativeModel;
  /** Cloud Gemini through Firebase AI Logic, falling back to Gemini Nano when the cloud is unreachable. */
  writer: GenerativeModel;
}

let models: Models | null = null;

export function getModels(): Models {
  if (models) return models;

  // Placeholder values let the on-device model run before a Firebase project exists;
  // the cloud path needs the real config from .env.
  const app = initializeApp(
    cloudConfigured
      ? firebaseConfig
      : { apiKey: 'not-configured', projectId: 'not-configured', appId: '1:0:web:0' },
  );

  if (cloudConfigured && env.VITE_RECAPTCHA_ENTERPRISE_SITE_KEY) {
    if (env.VITE_APPCHECK_DEBUG_TOKEN) {
      // Firebase App Check debug provider: https://firebase.google.com/docs/app-check/web/debug-provider
      (self as unknown as { FIREBASE_APPCHECK_DEBUG_TOKEN: string | boolean }).FIREBASE_APPCHECK_DEBUG_TOKEN =
        env.VITE_APPCHECK_DEBUG_TOKEN === 'true' ? true : env.VITE_APPCHECK_DEBUG_TOKEN;
    }
    initializeAppCheck(app, {
      provider: new ReCaptchaEnterpriseProvider(env.VITE_RECAPTCHA_ENTERPRISE_SITE_KEY),
      isTokenAutoRefreshEnabled: true,
    });
  }

  const ai = getAI(app, { backend: new GoogleAIBackend() });

  const detector = getGenerativeModel(ai, {
    mode: InferenceMode.ONLY_ON_DEVICE,
    onDeviceParams: {
      createOptions: {
        expectedInputs: [{ type: 'text', languages: ['en'] }],
        expectedOutputs: [{ type: 'text', languages: ['en'] }],
      },
      promptOptions: { responseConstraint: entitySchema },
    },
  });

  const writer = getGenerativeModel(ai, {
    mode: InferenceMode.PREFER_IN_CLOUD,
    inCloudParams: {
      model: CLOUD_MODEL,
      generationConfig: { temperature: 0.4 },
    },
    onDeviceParams: {
      createOptions: {
        expectedInputs: [{ type: 'text', languages: ['en'] }],
        expectedOutputs: [{ type: 'text', languages: ['en'] }],
      },
    },
  });

  models = { detector, writer };
  return models;
}
