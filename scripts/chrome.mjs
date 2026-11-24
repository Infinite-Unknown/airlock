// Launches Google Chrome (stable) with a dedicated automation profile in .chrome-profile/.
// Playwright's default switches turn off Chrome's component updater, background networking and
// optimization hints, which is how Chrome fetches and serves Gemini Nano, so those are dropped.
import { chromium } from 'playwright-core';
import { fileURLToPath } from 'node:url';

export const PROFILE_DIR = fileURLToPath(new URL('../.chrome-profile', import.meta.url));

export function launchChrome({ headless = false, viewport = { width: 1440, height: 900 }, deviceScaleFactor = 1 } = {}) {
  return chromium.launchPersistentContext(PROFILE_DIR, {
    channel: 'chrome',
    headless,
    ignoreDefaultArgs: ['--disable-component-update', '--disable-background-networking', '--disable-field-trial-config'],
    args: ['--use-mock-keychain', '--password-store=basic', '--disable-features=Translate,MediaRouter'],
    viewport,
    deviceScaleFactor,
  });
}
