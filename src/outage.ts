// "Simulate a cloud outage": while switched on, requests from this tab to the Gemini endpoints fail
// the way a dropped connection does (a TypeError from fetch), before anything leaves the browser.
// The Firebase AI Logic SDK sees a real network error, so its own hybrid fallback runs.

const AI_ENDPOINTS = /^https:\/\/(firebasevertexai|generativelanguage|aiplatform)\.googleapis\.com\//;

type Fetch = typeof fetch;
let blocked = false;
let blockedCount = 0;

/** How many requests the switch has stopped so far. */
export const blockedRequests = () => blockedCount;

export const isOutage = () => blocked;
export function setOutage(on: boolean) {
  blocked = on;
}

function urlOf(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

/** Wrap the global fetch once. Other requests (App Check, Remote Config, the page itself) are untouched. */
export function installOutageSwitch(g: { fetch: Fetch } = globalThis) {
  const real = g.fetch.bind(g);
  g.fetch = ((input: RequestInfo | URL, init?: RequestInit) =>
    blocked && AI_ENDPOINTS.test(urlOf(input))
      ? (blockedCount++, Promise.reject(new TypeError('Failed to fetch (simulated cloud outage)')))
      : real(input, init)) as Fetch;
}
