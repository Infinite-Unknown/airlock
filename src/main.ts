import './style.css';
import { checkOnDevice, detect, TASKS, write, writerPrompt, type OnDeviceStatus, type TaskId } from './airlock';
import { cloudConfigured, CLOUD_MODEL, getModels } from './firebase';
import { mergeEntities, redact, type Redaction } from './redact';
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
  outBody: $('out-body'),
  outError: $('out-error'),
  sourceBadge: $('source-badge'),
  showRaw: $<HTMLInputElement>('show-raw'),
  result: $('result'),
  btnCopy: $<HTMLButtonElement>('btn-copy'),
  log: $('log'),
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
};

const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

const SOURCE_LABEL: Record<Entity['source'], string> = {
  rule: 'pattern rule',
  'on-device': 'Gemini Nano',
  manual: 'you',
};

// ---------- status ----------

function renderStatus() {
  const d = state.onDevice;
  const deviceText: Record<OnDeviceStatus, string> = {
    available: 'Gemini Nano: ready on this device',
    downloadable: 'Gemini Nano: downloads on first use',
    downloading: 'Gemini Nano: downloading…',
    unavailable: 'Gemini Nano: not supported on this device',
    'no-api': 'Gemini Nano: not available in this browser',
  };
  els.chipDevice.textContent = deviceText[d];
  els.chipDevice.className = `chip ${d === 'available' ? 'ok' : 'warn'}`;
  els.chipCloud.textContent = cloudConfigured ? `Cloud: ${CLOUD_MODEL} via Firebase AI Logic` : 'Cloud: not configured';
  els.chipCloud.className = `chip ${cloudConfigured ? 'ok' : 'warn'}`;
  els.chipCloud.title = cloudConfigured ? '' : 'Add your Firebase web config to .env (see README) to enable the cloud step.';

  els.redactHint.textContent =
    d === 'available'
      ? 'Names, addresses and other details are found by Gemini Nano running in Chrome, plus local pattern rules. Nothing leaves the device in this step.'
      : d === 'downloadable' || d === 'downloading'
        ? 'Chrome will download Gemini Nano the first time you redact. Nothing leaves the device in this step.'
        : 'Gemini Nano is not available here, so only local pattern rules run (emails, phones, IC and card numbers). Names and addresses will need your help.';
}

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
    els.btnRedact.textContent = state.onDevice === 'available' ? 'Redacting with Gemini Nano…' : 'Redacting…';
    const { detector } = getModels();
    const r = await detect(text, detector, state.onDevice);
    state.source = text;
    state.entities = r.entities;
    state.usedOnDevice = r.usedOnDevice;
    state.removed.clear();
    els.consent.checked = false;
    recompute();
    resetResult();
  } catch (e) {
    showError(`On-device redaction failed: ${(e as Error).message}`);
  } finally {
    els.btnRedact.disabled = false;
    els.btnRedact.textContent = 'Redact on this device';
  }
}

/** Let Chrome fetch Gemini Nano (needs a user click), showing progress, then re-check. */
async function downloadNano() {
  const lm = (globalThis as { LanguageModel?: { create(o: unknown): Promise<{ destroy?(): void }> } }).LanguageModel;
  if (!lm) return;
  els.btnRedact.textContent = 'Downloading Gemini Nano…';
  try {
    const session = await lm.create({
      expectedInputs: [{ type: 'text', languages: ['en'] }],
      expectedOutputs: [{ type: 'text', languages: ['en'] }],
      monitor(m: EventTarget) {
        m.addEventListener('downloadprogress', (e) => {
          const pct = Math.round(((e as ProgressEvent).loaded ?? 0) * 100);
          els.btnRedact.textContent = `Downloading Gemini Nano… ${pct}%`;
        });
      },
    });
    session.destroy?.();
  } catch {
    // fall through: status is re-checked below and rules-only mode is used if needed
  }
  state.onDevice = await checkOnDevice();
  renderStatus();
}

function recompute() {
  const active = state.entities.filter((e) => !state.removed.has(e.text));
  state.redaction = redact(state.source, active);
  renderLock();
}

function renderLock() {
  const r = state.redaction;
  if (!r) return;
  els.lockEmpty.classList.add('hidden');
  els.lockBody.classList.remove('hidden');

  els.redacted.innerHTML = esc(r.redacted).replace(/\[([A-Z_]+)_(\d+)\]/g, (m, type: string) => {
    return `<span class="tok t-${type.toLowerCase()}">${m}</span>`;
  });

  els.count.textContent = `(${r.placeholders.length})`;
  const tokenOf = new Map(r.placeholders.map((p) => [p.value, p.token]));
  els.entities.innerHTML = state.entities
    .map((e) => {
      const off = state.removed.has(e.text);
      return `<li class="${off ? 'off' : ''}">
        <span class="tok t-${e.type.toLowerCase()}">${off ? 'visible' : esc(tokenOf.get(e.text) ?? '')}</span>
        <span class="val">${esc(e.text)}</span>
        <span class="src s-${e.source}">${SOURCE_LABEL[e.source]}</span>
        <button class="link" data-value="${esc(e.text)}">${off ? 'Hide' : 'Show'}</button>
      </li>`;
    })
    .join('');

  if (!state.usedOnDevice) {
    els.warn.classList.remove('hidden');
    els.warn.textContent =
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
  els.sendHint.textContent =
    reason ||
    `Sends ${state.redaction?.redacted.length ?? 0} characters of redacted text. ${state.redaction?.placeholders.length ?? 0} details stay on this device.`;
}

// ---------- step 2 + 3: send and restore ----------

async function onSend() {
  if (!state.redaction) return;
  const task = currentTask();
  els.btnSend.disabled = true;
  els.btnSend.textContent = 'Waiting for the cloud model…';
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
      addLog(writerPrompt(task, state.redaction.redacted), undefined, 'request failed');
    }
    showError(friendlyError(err));
  } finally {
    els.btnSend.textContent = 'Send redacted text';
    updateSendButton();
  }
}

function friendlyError(e: Error): string {
  const m = e.message || String(e);
  if (/api[- ]?key/i.test(m)) return `The cloud rejected the Firebase API key. Check .env. (${m})`;
  if (/app.?check/i.test(m)) return `App Check blocked the request. Register a debug token (see README). (${m})`;
  if (/fetch|network/i.test(m)) return `Could not reach the cloud and no on-device fallback was available. (${m})`;
  return m;
}

function renderResult(source?: string) {
  els.outEmpty.classList.add('hidden');
  els.outBody.classList.remove('hidden');
  els.sourceBadge.textContent =
    source === 'on_device' ? 'Written on-device (cloud unreachable)' : `Written in the cloud · ${CLOUD_MODEL}`;
  els.sourceBadge.className = `badge ${source === 'on_device' ? 'b-device' : 'b-cloud'}`;
  renderResultText();
}

function renderResultText() {
  const r = state.redaction;
  if (!r) return;
  let html = esc(state.cloudText);
  if (els.showRaw.checked) {
    html = html.replace(/\[([A-Z_]+)_(\d+)\]/g, (m, t: string) => `<span class="tok t-${t.toLowerCase()}">${m}</span>`);
  } else {
    for (const p of r.placeholders) {
      const inner = p.token.slice(1, -1).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      html = html.replace(
        new RegExp(`\\[?\\b${inner}\\b\\]?`, 'gi'),
        `<mark class="restored" title="Restored locally from ${p.token}">${esc(p.value)}</mark>`,
      );
    }
  }
  els.result.innerHTML = html;
}

function resetResult() {
  state.cloudText = '';
  state.restored = '';
  els.outBody.classList.add('hidden');
  els.outEmpty.classList.remove('hidden');
}

function addLog(payload: string, source?: string, outcome = 'answered') {
  if (state.logCount === 0) els.log.innerHTML = '';
  state.logCount++;
  const li = document.createElement('li');
  const time = new Date().toLocaleTimeString();
  const where =
    source === 'on_device' ? 'stayed on device (on-device fallback)' : `sent to ${CLOUD_MODEL}, ${outcome}`;
  li.innerHTML = `<details><summary><b>${time}</b> · ${payload.length} characters · ${where} · personal details sent: <b>0</b></summary><pre class="text small">${esc(payload)}</pre></details>`;
  els.log.prepend(li);
}

function showError(msg: string) {
  els.outError.textContent = msg;
  els.outError.classList.remove('hidden');
}
function hideError() {
  els.outError.classList.add('hidden');
}

// ---------- wiring ----------

els.samples.innerHTML =
  '<span class="muted">Try a sample:</span> ' +
  SAMPLES.map((s) => `<button class="pill" data-sample="${s.id}">${esc(s.label)}</button>`).join('');
els.samples.addEventListener('click', (ev) => {
  const id = (ev.target as HTMLElement).dataset.sample;
  const s = SAMPLES.find((x) => x.id === id);
  if (!s) return;
  els.input.value = s.text;
  els.task.value = s.task;
  els.customTask.classList.add('hidden');
});

els.task.addEventListener('change', () => {
  els.customTask.classList.toggle('hidden', els.task.value !== 'custom');
  if (els.task.value === 'custom') els.customTask.focus();
  updateSendButton();
});
els.customTask.addEventListener('input', updateSendButton);
els.btnRedact.addEventListener('click', onRedact);
els.btnSend.addEventListener('click', onSend);
els.consent.addEventListener('change', updateSendButton);
els.showRaw.addEventListener('change', renderResultText);
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
  const v = (ev.target as HTMLElement).dataset.value;
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
