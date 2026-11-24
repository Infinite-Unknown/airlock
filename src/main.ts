import './style.css';
import { checkOnDevice, detect, TASKS, write, writerPrompt, type OnDeviceStatus, type TaskId } from './airlock';
import { cloudConfigured, CLOUD_MODEL, getModels } from './firebase';
import { findLeaks, mergeEntities, redact, type Placeholder, type Redaction } from './redact';
import type { Entity } from './rules';
import { SAMPLES } from './samples';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

const els = {
  chipDevice: $('chip-device'),
  chipCloud: $('chip-cloud'),
  samples: $('samples'),
  input: $<HTMLTextAreaElement>('input'),
  task: $<HTMLSelectElement>('task'),
  customTask: $<HTMLInputElement>('custom-task'),
  btnRedact: $<HTMLButtonElement>('btn-redact'),
  redactHint: $('redact-hint'),
  lockEmpty: $('lock-empty'),
  lockBody: $('lock-body'),
  redacted: $('redacted'),
  warn: $('warn'),
  warnText: $('warn-text'),
  count: $('count'),
  entities: $('entities'),
  addForm: $<HTMLFormElement>('add-form'),
  addText: $<HTMLInputElement>('add-text'),
  addType: $<HTMLSelectElement>('add-type'),
  consentRow: $('consent-row'),
  consent: $<HTMLInputElement>('consent'),
  btnSend: $<HTMLButtonElement>('btn-send'),
  sendHint: $('send-hint'),
  outEmpty: $('out-empty'),
  outEmptyText: $('out-empty-text'),
  outBody: $('out-body'),
  outError: $('out-error'),
  errorTitle: $('error-title'),
  errorDetail: $('error-detail'),
  sourceBadge: $('source-badge'),
  showRaw: $<HTMLInputElement>('show-raw'),
  result: $('result'),
  btnCopy: $<HTMLButtonElement>('btn-copy'),
  log: $('log'),
  logEmpty: $('log-empty'),
  logEmptyWhy: $('log-empty-why'),
  tallyReq: $('tally-req'),
  tallyLeak: $('tally-leak'),
};

interface State {
  onDevice: OnDeviceStatus;
  source: string; // the text the redaction was made from
  entities: Entity[];
  removed: Set<string>; // values the user chose to keep visible
  redaction: Redaction | null;
  usedOnDevice: boolean;
  cloudText: string;
  restored: string;
  logCount: number;
  sentCount: number;
  leakTotal: number;
  /** Values already shown as placeholders, so only newly hidden ones play the redaction sweep. */
  shownHidden: Set<string>;
}

const state: State = {
  onDevice: 'no-api',
  source: '',
  entities: [],
  removed: new Set(),
  redaction: null,
  usedOnDevice: false,
  cloudText: '',
  restored: '',
  logCount: 0,
  sentCount: 0,
  leakTotal: 0,
  shownHidden: new Set(),
};

const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

const SOURCE_LABEL: Record<Entity['source'], string> = {
  rule: 'pattern rule',
  'on-device': 'Gemini Nano',
  manual: 'you',
};

const TOKEN_RE = /\[([A-Z_]+)_(\d+)\]/g;
const tokHtml = (token: string, type: string) => `<span class="tok t-${type.toLowerCase()}">${token}</span>`;
const typeOf = (token: string) => token.slice(1, -1).replace(/_\d+$/, '');

// ---------- motion helpers ----------

const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');
const EASE = 'cubic-bezier(0.23, 1, 0.32, 1)';
const STAGGER = 140;
const SWEEP = 240;
const LEAD = 260; // detected values are highlighted for this long before the first strike

/** A cancellable timeline: a new sequence on the same surface finishes the old one at once. */
class Timeline {
  private timers: ReturnType<typeof setTimeout>[] = [];
  private pending: (() => void)[] = [];
  at(ms: number, fn: () => void) {
    this.pending.push(fn);
    this.timers.push(
      setTimeout(() => {
        const i = this.pending.indexOf(fn);
        if (i >= 0) this.pending.splice(i, 1);
        fn();
      }, ms),
    );
  }
  /** Stop scheduling; run what is left immediately (no animation). */
  finish() {
    this.timers.forEach(clearTimeout);
    this.timers = [];
    const left = this.pending;
    this.pending = [];
    left.forEach((fn) => fn());
  }
}

function landIn(el: HTMLElement) {
  if (reduceMotion.matches) {
    el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 150, easing: 'ease' });
  } else {
    el.animate(
      [
        { opacity: 0, filter: 'blur(4px)', transform: 'scale(0.9)' },
        { opacity: 1, filter: 'blur(0px)', transform: 'scale(1)' },
      ],
      { duration: 260, easing: EASE },
    );
  }
}

// ---------- status ----------

function setChip(el: HTMLElement, key: string, value: string, ok: boolean, title = '') {
  el.innerHTML = `<span class="chip-k">${esc(key)}</span> <span class="chip-v">${esc(value)}</span>`;
  el.className = `chip ${ok ? 'is-ok' : 'is-warn'}`;
  el.title = title;
}

function renderStatus() {
  const d = state.onDevice;
  const deviceText: Record<OnDeviceStatus, string> = {
    available: 'Gemini Nano ready',
    downloadable: 'Gemini Nano downloads on first use',
    downloading: 'Gemini Nano downloading…',
    unavailable: 'Gemini Nano not supported on this device',
    'no-api': 'Gemini Nano not available in this browser',
  };
  setChip(els.chipDevice, 'On-device', deviceText[d], d === 'available');
  setChip(
    els.chipCloud,
    'Cloud',
    cloudConfigured ? `${CLOUD_MODEL} via Firebase AI Logic` : 'not configured',
    cloudConfigured,
    cloudConfigured ? '' : 'Add your Firebase web config to .env (see README) to turn on the cloud step.',
  );

  els.redactHint.textContent =
    d === 'available'
      ? 'Names, addresses and other details are found by Gemini Nano running in Chrome, plus local pattern rules. Nothing leaves the device in this step.'
      : d === 'downloadable' || d === 'downloading'
        ? 'Chrome will download Gemini Nano the first time you redact. Nothing leaves the device in this step.'
        : 'Gemini Nano is not available here, so only local pattern rules run (emails, phones, IC and card numbers). Names and addresses will need your help.';

  if (!cloudConfigured) {
    els.outEmptyText.textContent =
      'The cloud step is off in this copy. Add a Firebase web config to .env (see README) and the answer appears here, with the real details filled back in locally.';
    els.logEmptyWhy.textContent = 'The cloud step is off until a Firebase config is added, so nothing can leave.';
  } else {
    els.logEmptyWhy.textContent = 'Each request appears here the moment it is sent, with its full payload.';
  }
}

function setBusy(btn: HTMLButtonElement, label: string | null, idleLabel: string) {
  btn.classList.toggle('busy', label !== null);
  btn.querySelector('.lbl')!.textContent = label ?? idleLabel;
  if (label !== null) btn.setAttribute('aria-busy', 'true');
  else btn.removeAttribute('aria-busy');
}
const REDACT_LABEL = 'Redact on this device';
const SEND_LABEL = 'Send redacted text';

// ---------- step 1: redact ----------

function currentTask(): string {
  const id = els.task.value as TaskId;
  return id === 'custom' ? els.customTask.value.trim() : TASKS[id];
}

async function onRedact() {
  const text = els.input.value.trim();
  if (!text) {
    els.input.focus();
    els.redactHint.textContent = 'Paste a message first, or pick a sample above.';
    return;
  }
  els.btnRedact.disabled = true;
  hideError();
  try {
    if (state.onDevice === 'downloadable' || state.onDevice === 'downloading') await downloadNano();
    setBusy(els.btnRedact, state.onDevice === 'available' ? 'Redacting with Gemini Nano…' : 'Redacting…', REDACT_LABEL);
    const { detector } = getModels();
    const r = await detect(text, detector, state.onDevice);
    state.source = text;
    state.entities = r.entities;
    state.usedOnDevice = r.usedOnDevice;
    state.removed.clear();
    state.shownHidden.clear();
    els.consent.checked = false;
    recompute(true);
    resetResult();
  } catch (e) {
    showError('On-device redaction failed. Nothing was sent.', (e as Error).message);
  } finally {
    els.btnRedact.disabled = false;
    setBusy(els.btnRedact, null, REDACT_LABEL);
  }
}

/** Let Chrome fetch Gemini Nano (needs a user click), showing progress, then re-check. */
async function downloadNano() {
  const lm = (globalThis as { LanguageModel?: { create(o: unknown): Promise<{ destroy?(): void }> } }).LanguageModel;
  if (!lm) return;
  setBusy(els.btnRedact, 'Downloading Gemini Nano…', REDACT_LABEL);
  // Give up waiting if Chrome reports no progress for 30 s; the download carries on in the
  // background and the next redaction will use Gemini Nano once it is ready.
  let stall: ReturnType<typeof setTimeout> | undefined;
  let rearm = () => {};
  const stalled = new Promise<'stalled'>((res) => {
    rearm = () => {
      clearTimeout(stall);
      stall = setTimeout(() => res('stalled'), 30_000);
    };
    rearm();
  });
  try {
    const created = lm.create({
      expectedInputs: [{ type: 'text', languages: ['en'] }],
      expectedOutputs: [{ type: 'text', languages: ['en'] }],
      monitor(m: EventTarget) {
        m.addEventListener('downloadprogress', (e) => {
          rearm();
          const pct = Math.round(((e as ProgressEvent).loaded ?? 0) * 100);
          setBusy(els.btnRedact, `Downloading Gemini Nano… ${pct}%`, REDACT_LABEL);
        });
      },
    });
    const first = await Promise.race([created, stalled]);
    if (first === 'stalled') {
      els.redactHint.textContent =
        'Gemini Nano is still downloading in the background. Using local pattern rules for now.';
    } else {
      first.destroy?.();
    }
  } catch {
    // fall through: status is re-checked below and rules-only mode is used if needed
  } finally {
    clearTimeout(stall);
  }
  state.onDevice = await checkOnDevice();
  renderStatus();
}

function recompute(fresh = false) {
  const active = state.entities.filter((e) => !state.removed.has(e.text));
  state.redaction = redact(state.source, active);
  renderLock(fresh);
}

const lockTimeline = { current: new Timeline() };

function renderLock(fresh: boolean) {
  const r = state.redaction;
  if (!r) return;
  lockTimeline.current.finish();
  const tl = (lockTimeline.current = new Timeline());

  if (els.lockBody.classList.contains('hidden')) {
    els.lockEmpty.classList.add('hidden');
    els.lockBody.classList.remove('hidden');
    els.lockBody.classList.remove('reveal');
    void els.lockBody.offsetWidth;
    els.lockBody.classList.add('reveal');
  }

  // Placeholders the user has already seen land are drawn as placeholders; new ones start as
  // the real value and are struck out, then replaced, in reading order.
  const valueOf = new Map(r.placeholders.map((p) => [p.token, p.value]));
  const isNew = (token: string) => !state.shownHidden.has(valueOf.get(token) ?? '');
  els.redacted.innerHTML = esc(r.redacted).replace(TOKEN_RE, (m, type: string) => {
    if (!isNew(m)) return tokHtml(m, type);
    return `<span class="strike" data-tok="${m}" data-type="${type.toLowerCase()}">${esc(valueOf.get(m) ?? m)}</span>`;
  });

  const strikes = [...els.redacted.querySelectorAll<HTMLElement>('.strike')];
  const order: string[] = []; // tokens in the order they land
  for (const s of strikes) if (!order.includes(s.dataset.tok!)) order.push(s.dataset.tok!);
  const landedAt = (token: string) => order.indexOf(token) * STAGGER + SWEEP;

  // count: settled placeholders now, the rest tick up as they land
  const total = r.placeholders.length;
  let shown = total - order.length;
  const setCount = () => (els.count.innerHTML = `<b>${shown}</b> stay on this device`);
  setCount();

  const motion = !reduceMotion.matches;
  if (strikes.length) {
    if (motion) {
      tl.at(16, () => strikes.forEach((s) => s.classList.add('lit')));
    }
    order.forEach((token, i) => {
      const group = strikes.filter((s) => s.dataset.tok === token);
      const start = motion ? LEAD + i * STAGGER : 0;
      if (motion) tl.at(start, () => group.forEach((s) => s.classList.add('struck')));
      tl.at(start + (motion ? SWEEP : 0), () => {
        for (const s of group) {
          const tok = document.createElement('span');
          tok.className = `tok t-${s.dataset.type}`;
          tok.textContent = token;
          s.replaceWith(tok);
          landIn(tok);
        }
        shown++;
        setCount();
      });
    });
  }
  state.shownHidden = new Set(r.placeholders.map((p) => p.value));

  const tokenOf = new Map(r.placeholders.map((p) => [p.value, p.token]));
  els.entities.classList.toggle('rows-in', fresh);
  els.entities.innerHTML = state.entities
    .map((e) => {
      const off = state.removed.has(e.text);
      const token = tokenOf.get(e.text) ?? '';
      const delay = fresh && motion && token ? ` style="animation-delay:${LEAD + landedAt(token)}ms"` : '';
      const isNewRow = !fresh && !off && order.includes(token);
      return `<li class="${off ? 'off' : ''}${isNewRow ? ' reveal' : ''}"${delay}>
        <span class="tok ${off ? 'plain' : `t-${e.type.toLowerCase()}`}">${off ? 'visible' : esc(token)}</span>
        <span class="val" title="${esc(e.text)}">${esc(e.text)}</span>
        <span class="src s-${e.source}">${SOURCE_LABEL[e.source]}</span>
        <button class="link" data-value="${esc(e.text)}" aria-label="${off ? 'Hide' : 'Show'} ${esc(e.text)}">${off ? 'Hide' : 'Show'}</button>
      </li>`;
    })
    .join('');

  if (!state.usedOnDevice) {
    els.warn.classList.remove('hidden');
    els.warnText.textContent =
      'Only pattern rules ran, because Gemini Nano is not available in this browser. Names and addresses may still be visible above. Hide them below, then confirm.';
    els.consentRow.classList.remove('hidden');
  } else {
    els.warn.classList.add('hidden');
    els.consentRow.classList.add('hidden');
  }
  updateSendButton();
}

function updateSendButton() {
  const needsConsent = !state.usedOnDevice && !els.consent.checked;
  const task = currentTask();
  let reason = '';
  if (!cloudConfigured) reason = 'Cloud step is off: add your Firebase config to .env (see README).';
  else if (!task) reason = 'Write a custom instruction first.';
  else if (needsConsent) reason = 'Confirm you checked the text.';
  els.btnSend.disabled = Boolean(reason);
  const n = state.redaction?.placeholders.length ?? 0;
  els.sendHint.textContent =
    reason ||
    `Sends ${state.redaction?.redacted.length ?? 0} characters of redacted text. ${n} ${n === 1 ? 'detail stays' : 'details stay'} on this device.`;
}

// ---------- step 2 + 3: send and restore ----------

async function onSend() {
  if (!state.redaction) return;
  const task = currentTask();
  els.btnSend.disabled = true;
  setBusy(els.btnSend, 'Waiting for the cloud model…', SEND_LABEL);
  hideError();
  try {
    const { writer } = getModels();
    const out = await write(task, state.redaction, writer);
    state.cloudText = out.cloudText;
    state.restored = out.restored;
    addLog(out.prompt, out.inferenceSource);
    renderResult(out.inferenceSource);
  } catch (e) {
    const err = e as Error;
    // A refusal happens before anything is sent; any other error means the request went out.
    if (!/^Refusing to send/.test(err.message)) {
      addLog(writerPrompt(task, state.redaction.redacted), undefined, 'failed');
    }
    const { title, detail } = friendlyError(err);
    showError(title, detail);
  } finally {
    setBusy(els.btnSend, null, SEND_LABEL);
    updateSendButton();
  }
}

function friendlyError(e: Error): { title: string; detail: string } {
  const full = e.message || String(e);
  const detail = full.length > 240 ? `${full.slice(0, 240)}…` : full;
  if (/^Refusing to send/.test(full))
    return { title: 'Airlock stopped the request: a hidden detail is still in the text. Nothing was sent.', detail };
  if (/api[- ]?key/i.test(full)) return { title: 'The cloud rejected the Firebase API key. Check the config in .env.', detail };
  if (/app.?check/i.test(full)) return { title: 'App Check blocked the request. Register a debug token (see README).', detail };
  if (/failed to fetch|network/i.test(full))
    return { title: 'Could not reach the cloud, and no on-device fallback was available.', detail };
  return { title: 'The cloud request failed.', detail };
}

function renderResult(source?: string) {
  els.outEmpty.classList.add('hidden');
  els.outBody.classList.remove('hidden', 'reveal');
  void els.outBody.offsetWidth;
  els.outBody.classList.add('reveal');
  els.sourceBadge.textContent =
    source === 'on_device' ? 'Written on-device (cloud unreachable)' : `Written in the cloud · ${CLOUD_MODEL}`;
  els.sourceBadge.className = `badge ${source === 'on_device' ? 'b-device' : 'b-cloud'}`;
  renderResultText(true);
}

const resultTimeline = { current: new Timeline() };

function renderResultText(animate = false) {
  const r = state.redaction;
  if (!r) return;
  resultTimeline.current.finish();
  const tl = (resultTimeline.current = new Timeline());
  let html = esc(state.cloudText);
  if (els.showRaw.checked) {
    els.result.innerHTML = html.replace(TOKEN_RE, (m, t: string) => tokHtml(m, t));
    return;
  }
  // One pass over every placeholder, tolerating dropped brackets or changed case.
  const byInner = new Map<string, Placeholder>(r.placeholders.map((p) => [p.token.slice(1, -1).toUpperCase(), p]));
  if (byInner.size) {
    const alt = [...byInner.keys()].map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
    const re = new RegExp(`\\[?\\b(${alt})\\b\\]?`, 'gi');
    html = html.replace(re, (_m, inner: string) => {
      const p = byInner.get(inner.toUpperCase())!;
      const mark = `<mark class="restored" title="Restored locally from ${p.token}">${esc(p.value)}</mark>`;
      if (!animate || reduceMotion.matches) return mark;
      return `<span class="tok t-${typeOf(p.token).toLowerCase()} restoring" data-value="${esc(p.value)}" data-token="${p.token}">${p.token}</span>`;
    });
  }
  els.result.innerHTML = html;

  const pending = [...els.result.querySelectorAll<HTMLElement>('.restoring')];
  pending.forEach((el, i) => {
    tl.at(220 + i * 90, () => {
      const mark = document.createElement('mark');
      mark.className = 'restored';
      mark.title = `Restored locally from ${el.dataset.token}`;
      mark.textContent = el.dataset.value ?? '';
      el.replaceWith(mark);
      mark.animate(
        [
          { opacity: 0, filter: 'blur(4px)' },
          { opacity: 1, filter: 'blur(0px)' },
        ],
        { duration: 280, easing: EASE },
      );
    });
  });
}

function resetResult() {
  resultTimeline.current.finish();
  state.cloudText = '';
  state.restored = '';
  els.outBody.classList.add('hidden');
  els.outEmpty.classList.remove('hidden');
}

function bump(el: HTMLElement, value: number) {
  el.textContent = String(value);
  el.classList.remove('tick');
  void el.offsetWidth;
  el.classList.add('tick');
}

function addLog(payload: string, source?: string, outcome: 'answered' | 'failed' = 'answered') {
  state.logCount++;
  const local = source === 'on_device';
  const leaks = findLeaks(payload, state.redaction?.placeholders ?? []).length;
  if (!local) {
    state.sentCount++;
    state.leakTotal += leaks;
    bump(els.tallyReq, state.sentCount);
    bump(els.tallyLeak, state.leakTotal);
  }
  els.logEmpty.classList.add('hidden');

  const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const dest = local ? 'Gemini Nano, on this device' : `${CLOUD_MODEL}`;
  const label = local ? 'stayed on device' : outcome === 'failed' ? 'request failed' : 'answered';
  const cls = local ? 'local' : outcome === 'failed' ? 'failed' : '';
  const body = esc(payload).replace(TOKEN_RE, (m, t: string) => tokHtml(m, t));
  const li = document.createElement('li');
  li.className = 'fresh';
  li.innerHTML = `<details><summary>
      <svg class="chev" aria-hidden="true"><use href="#i-chevron"/></svg>
      <span class="log-time">${time}</span>
      <span class="log-dest"><svg class="ic" aria-hidden="true"><use href="#i-out"/></svg><span>${esc(dest)} <small>· ${payload.length.toLocaleString()} characters</small></span></span>
      <span class="log-outcome ${cls}">${label}</span>
      <span class="log-proof${leaks ? ' bad' : ''}"><svg class="ic" aria-hidden="true"><use href="#${leaks ? 'i-alert' : 'i-check'}"/></svg>${leaks} hidden ${leaks === 1 ? 'detail' : 'details'} in payload</span>
    </summary><pre class="text small">${body}</pre></details>`;
  els.log.prepend(li);
  li.addEventListener('animationend', () => li.classList.remove('fresh'), { once: true });
}

function showError(title: string, detail = '') {
  els.errorTitle.textContent = title;
  els.errorDetail.textContent = detail;
  els.errorDetail.classList.toggle('hidden', !detail);
  els.outError.classList.remove('hidden', 'reveal');
  void els.outError.offsetWidth;
  els.outError.classList.add('reveal');
}
function hideError() {
  els.outError.classList.add('hidden');
}

// ---------- wiring ----------

els.samples.innerHTML = SAMPLES.map(
  (s) => `<button type="button" class="pill" data-sample="${s.id}" aria-pressed="false">${esc(s.label)}</button>`,
).join('');
const markSample = (id: string | null) =>
  els.samples.querySelectorAll<HTMLElement>('.pill').forEach((p) => p.setAttribute('aria-pressed', String(p.dataset.sample === id)));
els.samples.addEventListener('click', (ev) => {
  const id = (ev.target as HTMLElement).closest<HTMLElement>('[data-sample]')?.dataset.sample;
  const s = SAMPLES.find((x) => x.id === id);
  if (!s) return;
  els.input.value = s.text;
  els.task.value = s.task;
  els.customTask.classList.add('hidden');
  markSample(s.id);
});
els.input.addEventListener('input', () => markSample(null));

els.task.addEventListener('change', () => {
  els.customTask.classList.toggle('hidden', els.task.value !== 'custom');
  if (els.task.value === 'custom') els.customTask.focus();
  updateSendButton();
});
els.customTask.addEventListener('input', updateSendButton);
els.btnRedact.addEventListener('click', onRedact);
els.btnSend.addEventListener('click', onSend);
els.consent.addEventListener('change', updateSendButton);
els.showRaw.addEventListener('change', () => renderResultText());
els.btnCopy.addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(state.restored);
    els.btnCopy.textContent = 'Copied';
  } catch {
    els.btnCopy.textContent = 'Copy failed';
  }
  setTimeout(() => (els.btnCopy.textContent = 'Copy result'), 1500);
});

els.entities.addEventListener('click', (ev) => {
  const v = (ev.target as HTMLElement).closest<HTMLElement>('[data-value]')?.dataset.value;
  if (v === undefined) return;
  if (state.removed.has(v)) state.removed.delete(v);
  else state.removed.add(v);
  recompute();
  resetResult();
});

els.addForm.addEventListener('submit', (ev) => {
  ev.preventDefault();
  const v = els.addText.value.trim();
  if (!v) return;
  const type = els.addType.value as Entity['type'];
  const merged = mergeEntities(state.source, state.entities, [{ text: v, type, source: 'manual' }]);
  if (merged.length === state.entities.length) {
    els.addText.setCustomValidity('That exact text is not in the message (or is already hidden).');
    els.addText.reportValidity();
    return;
  }
  state.entities = merged;
  els.addText.value = '';
  recompute();
  resetResult();
});
els.addText.addEventListener('input', () => els.addText.setCustomValidity(''));

(async () => {
  state.onDevice = await checkOnDevice();
  renderStatus();
})();
renderStatus();
