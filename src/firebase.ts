import { initializeApp, type FirebaseApp, type FirebaseOptions } from 'firebase/app';
import { CustomProvider, initializeAppCheck, ReCaptchaEnterpriseProvider } from 'firebase/app-check';
import {
  getAI,
  getGenerativeModel,
  GoogleAIBackend,
  InferenceMode,
  type GenerativeModel,
} from 'firebase/ai';
import { fetchAndActivate, getAll, getRemoteConfig } from 'firebase/remote-config';
import { parseSettings, REMOTE_DEFAULTS, type Mode, type RemoteKey, type Settings } from './settings';

// Each value is read as import.meta.env.VITE_… on purpose: Vite then inlines only that value. Aliasing
// import.meta.env to a variable would inline every VITE_ variable, the dev-only debug token included.

export const firebaseConfig: FirebaseOptions = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

/** True when the Firebase web config has been pasted into .env. */
export const cloudConfigured = Boolean(
  firebaseConfig.apiKey && firebaseConfig.projectId && firebaseConfig.appId,
);

/** In-app defaults for the Remote Config parameters (VITE_CLOUD_MODEL can override the model locally). */
export const DEFAULTS: Record<RemoteKey, string> = {
  ...REMOTE_DEFAULTS,
  cloud_model: import.meta.env.VITE_CLOUD_MODEL || REMOTE_DEFAULTS.cloud_model,
};

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
   * Gemini Nano in Chrome, through Firebase AI Logic. Pinned to ONLY_ON_DEVICE here, never read from
   * Remote Config, and only called after checkOnDevice() returns 'available' (see sulit.ts for why).
   */
  detector: GenerativeModel;
  /** Writing on redacted text. Default PREFER_IN_CLOUD: cloud Gemini, Gemini Nano if the cloud is unreachable. */
  writer: GenerativeModel;
  /** Short tasks on redacted text. Default PREFER_ON_DEVICE: Gemini Nano, cloud only if Nano is missing. */
  quick: GenerativeModel;
  settings: Settings;
}

const MODE: Record<Mode, InferenceMode> = {
  prefer_on_device: InferenceMode.PREFER_ON_DEVICE,
  only_on_device: InferenceMode.ONLY_ON_DEVICE,
  only_in_cloud: InferenceMode.ONLY_IN_CLOUD,
  prefer_in_cloud: InferenceMode.PREFER_IN_CLOUD,
};

const ON_DEVICE_CREATE = {
  expectedInputs: [{ type: 'text' as const, languages: ['en'] }],
  expectedOutputs: [{ type: 'text' as const, languages: ['en'] }],
};

let app: FirebaseApp | null = null;
let models: Models | null = null;
let settings: Settings = parseSettings(DEFAULTS, 'defaults', DEFAULTS);

function getApp(): FirebaseApp {
  if (app) return app;
  // Placeholder values let the on-device model run before a Firebase project exists;
  // the cloud path needs the real config from .env.
  app = initializeApp(
    cloudConfigured
      ? firebaseConfig
      : { apiKey: 'not-configured', projectId: 'not-configured', appId: '1:0:web:0' },
  );

  const siteKey = import.meta.env.VITE_RECAPTCHA_ENTERPRISE_SITE_KEY;
  // The debug token is for local development only and is never read in a production build, so a
  // hosted copy cannot ship it by accident.
  const debugToken = import.meta.env.DEV ? import.meta.env.VITE_APPCHECK_DEBUG_TOKEN : undefined;
  if (cloudConfigured && (siteKey || debugToken)) {
    if (debugToken) {
      // Firebase App Check debug provider: https://firebase.google.com/docs/app-check/web/debug-provider
      // The token must be registered in Firebase console > App Check > Apps > Manage debug tokens.
      (self as unknown as { FIREBASE_APPCHECK_DEBUG_TOKEN: string | boolean }).FIREBASE_APPCHECK_DEBUG_TOKEN =
        debugToken === 'true' ? true : debugToken;
    }
    initializeAppCheck(app, {
      // With only a debug token (local development), the provider is never asked for a token.
      provider: siteKey
        ? new ReCaptchaEnterpriseProvider(siteKey)
        : new CustomProvider({
            getToken: () =>
              Promise.reject(new Error('No App Check provider: set VITE_RECAPTCHA_ENTERPRISE_SITE_KEY.')),
          }),
      isTokenAutoRefreshEnabled: true,
    });
  }
  return app;
}

/**
 * Fetch model names and modes from Firebase Remote Config. Falls back to the in-app defaults when
 * the cloud is not configured, the fetch fails or is slow, or a value is malformed.
 */
export async function loadSettings(timeoutMs = 2500): Promise<Settings> {
  if (!cloudConfigured) return settings;
  try {
    const rc = getRemoteConfig(getApp());
    rc.defaultConfig = { ...DEFAULTS };
    rc.settings.fetchTimeoutMillis = timeoutMs;
    rc.settings.minimumFetchIntervalMillis = 60 * 60 * 1000;
    await Promise.race([
      fetchAndActivate(rc),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Remote Config timed out')), timeoutMs + 500)),
    ]);
    const all = getAll(rc);
    const values = Object.fromEntries(Object.entries(all).map(([k, v]) => [k, v.asString()])) as Record<RemoteKey, string>;
    const fromRemote = (Object.keys(DEFAULTS) as RemoteKey[]).some((k) => all[k]?.getSource() === 'remote');
    settings = parseSettings(values, fromRemote ? 'remote' : 'defaults', DEFAULTS);
  } catch {
    // keep the defaults
  }
  models = null;
  return settings;
}

export const currentSettings = () => settings;

export function getModels(): Models {
  if (models) return models;
  const ai = getAI(getApp(), { backend: new GoogleAIBackend() });

  const detector = getGenerativeModel(ai, {
    mode: InferenceMode.ONLY_ON_DEVICE,
    onDeviceParams: {
      createOptions: ON_DEVICE_CREATE,
      promptOptions: { responseConstraint: entitySchema },
    },
  });

  const writer = getGenerativeModel(ai, {
    mode: MODE[settings.writerMode],
    inCloudParams: { model: settings.cloudModel, generationConfig: { temperature: 0.4 } },
    onDeviceParams: { createOptions: ON_DEVICE_CREATE },
  });

  const quick = getGenerativeModel(ai, {
    mode: MODE[settings.quickMode],
    inCloudParams: { model: settings.cloudModel, generationConfig: { temperature: 0.2 } },
    onDeviceParams: { createOptions: ON_DEVICE_CREATE },
  });

  models = { detector, writer, quick, settings };
  return models;
}
