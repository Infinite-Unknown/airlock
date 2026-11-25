// Renders scripts/demo/thumbnail.html to assets/thumbnail.png (1280x720) in a throwaway headless Chrome.
import { chromium } from 'playwright-core';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const root = resolve(import.meta.dirname, '..', '..');
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-mock-keychain', '--password-store=basic', '--force-color-profile=srgb'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
await page.goto(pathToFileURL(join(root, 'scripts', 'demo', 'thumbnail.html')).href);
await page.evaluate(() => document.fonts.ready.then(() => Promise.all([...document.fonts].map((f) => f.load()))));
await page.screenshot({ path: join(root, 'assets', 'thumbnail.png') });
await browser.close();
console.log('wrote assets/thumbnail.png');
