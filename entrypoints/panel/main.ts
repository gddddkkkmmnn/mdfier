import { exportIdentity } from '../../lib/export-identity';
import { browser } from 'wxt/browser';
import { convertCapture, renderExport, sanitizeFilename } from '../../lib/conversion';
import { createImportedDraft } from '../../lib/import-capture';
import { renderPreview } from '../../lib/preview';
import { strings, type TextKey } from '../../lib/i18n';
import type { CapturePayload, Draft, Settings } from '../../lib/types';
import './style.css';

type PendingCapture = { id: string; tabId: number; payload: CapturePayload };
let draft: Draft | undefined;
let tabId: number | undefined;
let settings: Settings = { language: navigator.language.startsWith('uk') ? 'uk' : 'en' };
let original: CapturePayload | undefined;
let currentView: 'markdown' | 'preview' = 'markdown';
let persistence: Promise<unknown> = Promise.resolve();
let importQueue: Promise<unknown> = Promise.resolve();
let busy = false;
let pickerActive = false;
let clearing = false;
let pasteAsNew = false;
let initialized = false;
let conflict = false;
let persistenceFailed = false;
let storedIdentity: { id: string | null; revision: number | null } = { id: null, revision: null };
let statusTimer: ReturnType<typeof setTimeout> | undefined;
let documentEpoch = 0;
const deferredPending: PendingCapture[] = [];
const pendingIds = new Set<string>();
const app = document.querySelector<HTMLDivElement>('#app')!;
const t = (key: TextKey) => strings[settings.language][key];
const rpc = (message: object): Promise<any> => browser.runtime.sendMessage(message);
const icon = (name: 'page' | 'pick' | 'paste') => ({
  page: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="5" y="3" width="14" height="18" rx="2"/><path d="M8 8h8M8 12h8M8 16h5"/></svg>',
  pick: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5M9 9l3 9 2-4 4-2z"/></svg>',
  paste: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="5" y="5" width="14" height="16" rx="2"/><rect x="9" y="3" width="6" height="4" rx="1"/><path d="M8 12h8m-8 4h5"/></svg>',
})[name];

function status(key: TextKey, error = false) {
  const el = document.querySelector<HTMLElement>('#status');
  if (!el) return;
  if (statusTimer) clearTimeout(statusTimer);
  el.textContent = t(key);
  el.classList.toggle('error', error);
  const target = el;
  statusTimer = setTimeout(() => { target.textContent = ''; target.classList.remove('error'); }, error ? 7000 : 2600);
}

function persist() {
  if (!draft || tabId === undefined || conflict) return;
  const ownerTabId = tabId;
  const snapshot = structuredClone(draft);
  persistence = persistence.then(async () => {
    if (conflict) return;
    const result = await rpc({ type: 'save-draft', tabId: ownerTabId, draft: snapshot, expectedId: storedIdentity.id, expectedRevision: storedIdentity.revision });
    if (ownerTabId !== tabId) return;
    if (result?.conflict) {
      conflict = true;
      status('conflict', true);
      document.querySelector<HTMLButtonElement>('#reload')?.removeAttribute('hidden');
      return;
    }
    if (result?.closed) return;
    storedIdentity = { id: snapshot.id, revision: snapshot.revision };
    persistenceFailed = false;
  }).catch(() => {
    if (ownerTabId === tabId) { persistenceFailed = true; status('storageFailed', true); }
  });
}

function markChanged() {
  if (!draft) return;
  draft.revision++;
  original = undefined;
  document.querySelector('#plain')?.setAttribute('hidden', '');
  persist();
}

function render() {
  document.documentElement.lang = settings.language;
  const hasDraft = Boolean(draft);
  const showCapture = !hasDraft || pasteAsNew;
  app.innerHTML = `
    <main>
      ${conflict ? `<button id="reload" class="secondary conflict-action">${t('reload')}</button>` : '<button id="reload" class="secondary conflict-action" hidden></button>'}
      <div class="capture-row">
        <nav class="capture-modes" aria-label="${t('captureModes')}">
          <button id="mode-page" class="mode-button" title="${t('pageAction')}" aria-label="${t('pageAction')}">${icon('page')}<span>${t('modePage')}</span></button>
          <button id="mode-pick" class="mode-button" title="${t('pickAction')}" aria-label="${t('pickAction')}">${icon('pick')}<span>${t('modeBlock')}</span></button>
          <button id="mode-paste" class="mode-button" title="${t('pasteAction')}" aria-label="${t('pasteAction')}" aria-pressed="${pasteAsNew && hasDraft}">${icon('paste')}<span>${t('modePaste')}</span></button>
        </nav>
      </div>
      <section id="start" class="${hasDraft ? 'replacement-paste' : ''}" ${!showCapture ? 'hidden' : ''}>
        <label class="pastebox" for="paste"><textarea id="paste" aria-label="${t('paste')}" placeholder="${t('pasteHint')}" spellcheck="false"></textarea><span class="keycap" aria-hidden="true">${navigator.platform.includes('Mac') ? '⌘V' : 'Ctrl+V'}</span></label>
        <button id="create-paste" class="primary create-paste" hidden>${t('create')}</button>
        <p class="selection-tip" ${hasDraft ? 'hidden' : ''}>${t('selectionHint')}</p>
      </section>
      <section id="document" ${!hasDraft ? 'hidden' : ''}>
        <label class="field-label" for="filename">${t('filename')}</label><div class="filename"><input id="filename" maxlength="80" spellcheck="false"><span>.md</span></div>
        <div class="document-source" ${!draft?.sourceUrl && (!draft?.extraction || draft.extraction.mode === 'paste') ? 'hidden' : ''}>
          <div class="source" ${!draft?.sourceUrl ? 'hidden' : ''}><span>${t('originalPage')}</span><a id="source-link" target="_blank" rel="noopener noreferrer"></a></div>
          <p id="capture-label" class="capture-label"></p>
        </div>
        <div class="editor-toolbar"><div class="view-switch" role="group" aria-label="Markdown"><button id="tab-markdown" class="view-button" aria-controls="editor" aria-pressed="${currentView === 'markdown'}">${t('markdown')}</button><button id="tab-preview" class="view-button" aria-controls="preview" aria-pressed="${currentView === 'preview'}">${t('preview')}</button><button id="clear" class="clear-button" type="button">${t('clear')}</button></div><button id="plain" class="text-button" ${!original?.html || !original.text?.trim() ? 'hidden' : ''}>${t('plain')}</button></div>
        <textarea id="editor" aria-label="${t('markdown')}" spellcheck="false" ${currentView !== 'markdown' ? 'hidden' : ''}></textarea><article id="preview" tabindex="0" aria-label="${t('preview')}" ${currentView !== 'preview' ? 'hidden' : ''}></article>
        <div id="warnings" class="warnings"></div>
      </section>
      <p id="status" role="status" aria-live="polite"></p>
    </main>
    <footer>
      <div class="export-actions" ${!hasDraft ? 'hidden' : ''}><button id="download" class="primary">↓ ${t('download')}</button><button id="copy" class="secondary">${t('copy')}</button></div>
      <div class="footer-options">
        <div class="language-picker" role="radiogroup" aria-label="${t('language')}">
          <button type="button" id="language-en" class="language-option" role="radio" aria-checked="${settings.language === 'en'}" title="English"><span>EN</span></button>
          <button type="button" id="language-uk" class="language-option" role="radio" aria-checked="${settings.language === 'uk'}" title="Українська"><span>UK</span></button>
        </div>
      </div>
    </footer>`;
  const q = <T extends HTMLElement>(selector: string) => app.querySelector<T>(selector)!;
  const setLanguage = (language: Settings['language']) => {
    settings.language = language;
    void rpc({ type: 'settings', settings }).catch(() => status('storageFailed', true));
    render();
  };
  q<HTMLButtonElement>('#language-en').onclick = () => setLanguage('en');
  q<HTMLButtonElement>('#language-uk').onclick = () => setLanguage('uk');
  q<HTMLButtonElement>('#mode-page')?.addEventListener('click', () => void capture('page'));
  q<HTMLButtonElement>('#mode-pick')?.addEventListener('click', () => void capture('element'));
  q<HTMLButtonElement>('#mode-paste')?.addEventListener('click', () => {
    if (draft) {
      pasteAsNew = !pasteAsNew;
      render();
      if (pasteAsNew) document.querySelector<HTMLTextAreaElement>('#paste')?.focus();
      return;
    }
    document.querySelector<HTMLTextAreaElement>('#paste')?.focus();
  });
  q<HTMLButtonElement>('#reload').onclick = () => { void reloadSaved(); };
  q<HTMLTextAreaElement>('#paste')?.addEventListener('paste', (e) => {
    const data = e.clipboardData;
    if (!data) return;
    e.preventDefault();
    enqueueImport({ kind: 'paste', html: data.getData('text/html') || undefined, text: data.getData('text/plain'), capturedAt: new Date().toISOString(), extraction: { mode: 'paste' } }, tabId);
  });
  q<HTMLTextAreaElement>('#paste')?.addEventListener('input', (e) => {
    const text = (e.target as HTMLTextAreaElement).value;
    const button = document.querySelector<HTMLButtonElement>('#create-paste');
    if (button) button.hidden = !text.trim();
  });
  q<HTMLButtonElement>('#create-paste')?.addEventListener('click', () => {
    const text = document.querySelector<HTMLTextAreaElement>('#paste')?.value ?? '';
    if (text.trim()) enqueueImport({ kind: 'paste', text, capturedAt: new Date().toISOString(), extraction: { mode: 'paste' } }, tabId);
  });

  if (draft) {
    q<HTMLInputElement>('#filename').value = draft.filename;
    q<HTMLTextAreaElement>('#editor').value = draft.markdown;
    const link = q<HTMLAnchorElement>('#source-link');
    if (draft.sourceUrl) {
      try { link.textContent = new URL(draft.sourceUrl).host || draft.sourceUrl; }
      catch { link.textContent = draft.sourceUrl; }
      link.title = draft.sourceUrl;
      if (/^https?:\/\//i.test(draft.sourceUrl)) link.href = draft.sourceUrl;
    }
    const captureLabel = q<HTMLParagraphElement>('#capture-label');
    const extraction = draft.extraction;
    if (!extraction || extraction.mode === 'paste') captureLabel.hidden = true;
    else {
      captureLabel.textContent = extraction.fallback ? t('bestMatch') : extraction.mode === 'semantic-page' ? t('cleanPage') : extraction.mode === 'exact-block' ? t('selectedBlock') : t('selection');
      captureLabel.classList.toggle('fallback', Boolean(extraction.fallback));
    }
    q('#warnings').textContent = draft.warnings.map(warnText).join(' ');
    updatePreview();
  }
  q<HTMLButtonElement>('#clear').disabled = busy || pickerActive || clearing;
  q<HTMLInputElement>('#filename')?.addEventListener('input', (e) => {
    if (!draft) return;
    draft.filename = (e.target as HTMLInputElement).value;
    markChanged();
  });
  q<HTMLInputElement>('#filename')?.addEventListener('blur', (e) => {
    if (!draft) return;
    const clean = sanitizeFilename(draft.filename);
    if (clean !== draft.filename) {
      draft.filename = clean;
      (e.target as HTMLInputElement).value = clean;
      markChanged();
    }
  });
  q<HTMLTextAreaElement>('#editor')?.addEventListener('input', (e) => {
    if (!draft) return;
    draft.markdown = (e.target as HTMLTextAreaElement).value;
    markChanged();
  });
  q<HTMLTextAreaElement>('#editor')?.addEventListener('paste', (e) => {
    const html = e.clipboardData?.getData('text/html');
    if (!html) return;
    const markdown = convertCapture({ kind: 'paste', html, text: e.clipboardData?.getData('text/plain'), capturedAt: new Date().toISOString() }).markdown;
    if (!markdown.trim()) return;
    e.preventDefault();
    const editor = q<HTMLTextAreaElement>('#editor');
    if (!document.execCommand('insertText', false, markdown)) {
      editor.setRangeText(markdown, editor.selectionStart, editor.selectionEnd, 'end');
      editor.dispatchEvent(new Event('input', { bubbles: true }));
    }
  });
  q<HTMLButtonElement>('#tab-markdown')?.addEventListener('click', () => switchView('markdown'));
  q<HTMLButtonElement>('#tab-preview')?.addEventListener('click', () => switchView('preview'));
  q<HTMLButtonElement>('#clear')?.addEventListener('click', () => void clearDocument());
  q<HTMLButtonElement>('#plain')?.addEventListener('click', () => {
    if (!draft || original?.text === undefined) return;
    const converted = convertCapture({ ...original, html: undefined });
    if (!converted.markdown.trim()) { status('empty', true); return; }
    draft.markdown = converted.markdown;
    draft.filename = converted.filename;
    draft.warnings = converted.warnings;
    markChanged();
    render();
  });
  q<HTMLButtonElement>('#copy')?.addEventListener('click', () => void copy());
  q<HTMLButtonElement>('#download')?.addEventListener('click', () => void download());
}

async function clearDocument() {
  if (!draft || tabId === undefined || busy || pickerActive || clearing) return;
  const ownerTabId = tabId;
  clearing = true;
  document.querySelector<HTMLButtonElement>('#clear')?.setAttribute('disabled', '');
  documentEpoch++;
  try {
    await persistence;
    await importQueue;
    if (ownerTabId !== tabId) return;
    const result = await rpc({ type: 'clear-draft', tabId: ownerTabId });
    if (!result?.ok || ownerTabId !== tabId) throw new Error('clear-failed');
    draft = undefined;
    original = undefined;
    pasteAsNew = false;
    currentView = 'markdown';
    conflict = false;
    persistenceFailed = false;
    storedIdentity = { id: null, revision: null };
    render();
    requestAnimationFrame(() => document.querySelector<HTMLTextAreaElement>('#paste')?.focus());
  } catch { if (ownerTabId === tabId) status('storageFailed', true); }
  finally { clearing = false; document.querySelector<HTMLButtonElement>('#clear')?.toggleAttribute('disabled', busy || pickerActive); }
}

function warnText(code: string) {
  return code === 'unsupported-content' ? t('unsupportedContent') : /table/i.test(code) ? t('complexTable') : t('warning');
}

async function reloadSaved() {
  if (tabId === undefined) return;
  try {
    const state = await rpc({ type: 'state', tabId });
    draft = state.draft;
    storedIdentity = { id: draft?.id ?? null, revision: draft?.revision ?? null };
    conflict = false;
    pasteAsNew = false;
    original = undefined;
    render();
  } catch { status('storageFailed', true); }
}

function switchView(view: typeof currentView) {
  currentView = view;
  document.querySelector('#editor')?.toggleAttribute('hidden', view !== 'markdown');
  document.querySelector('#preview')?.toggleAttribute('hidden', view !== 'preview');
  document.querySelector('#tab-markdown')?.setAttribute('aria-pressed', String(view === 'markdown'));
  document.querySelector('#tab-preview')?.setAttribute('aria-pressed', String(view === 'preview'));
  updatePreview();
}

function updatePreview() {
  const preview = document.querySelector('#preview');
  if (draft && preview && currentView === 'preview') preview.innerHTML = renderPreview(renderExport(draft));
}

function enqueueImport(payload: CapturePayload, ownerTabId = tabId) {
  if (ownerTabId === undefined || clearing) return;
  const importEpoch = documentEpoch;
  importQueue = importQueue.then(() => importPayload(payload, ownerTabId, importEpoch)).catch(() => {
    if (ownerTabId === tabId) status('captureFailed', true);
  });
}

async function importPayload(payload: CapturePayload, ownerTabId: number, importEpoch = documentEpoch) {
  if (ownerTabId !== tabId || importEpoch !== documentEpoch) return;
  if (conflict) { status('conflict', true); return; }
  const nextDraft = createImportedDraft(payload, settings);
  if (!nextDraft) { status('empty', true); return; }
  await persistence;
  if (ownerTabId !== tabId || importEpoch !== documentEpoch) return;
  draft = nextDraft;
  original = payload.kind === 'paste' && payload.html && payload.text !== undefined ? payload : undefined;
  currentView = 'markdown';
  pasteAsNew = false;
  conflict = false;
  render();
  persist();
  await persistence;
  document.querySelector<HTMLTextAreaElement>('#editor')?.focus();
}

async function capture(kind: 'page' | 'element') {
  if (busy || tabId === undefined) return;
  busy = true;
  pickerActive = false;
  status(kind === 'page' ? 'capturing' : 'picking');
  document.querySelectorAll<HTMLButtonElement>('#mode-page,#mode-pick').forEach((button) => { button.disabled = true; });
  document.querySelector<HTMLButtonElement>('#clear')?.setAttribute('disabled', '');
  const ownerTabId = tabId;
  try {
    const reply = await rpc({ type: 'capture-active', kind, tabId: ownerTabId });
    if (reply?.tabId !== ownerTabId) return;
    if (reply?.payload) enqueueImport(reply.payload, ownerTabId);
    else if (reply?.picking) { pickerActive = true; status('picking'); }
    else if (reply?.error) {
      if (reply.error === 'capture-too-large') status('captureTooLarge', true);
      else if (reply.error === 'empty' || reply.error.startsWith('empty-')) status('empty', true);
      else if (reply.error === 'access') status('access', true);
      else status('captureFailed', true);
    }
  } catch { if (ownerTabId === tabId) status('access', true); }
  finally {
    busy = false;
    document.querySelectorAll<HTMLButtonElement>('#mode-page,#mode-pick').forEach((button) => { button.disabled = false; });
    document.querySelector<HTMLButtonElement>('#clear')?.toggleAttribute('disabled', pickerActive);
  }
}

async function copy() {
  if (!draft || tabId === undefined) return;
  const ownerTabId = tabId;
  const snapshot = structuredClone(draft);
  try {
    await navigator.clipboard.writeText(renderExport(snapshot));
    await persistence;
    await rpc({ type: 'mark-exported', tabId: ownerTabId, id: snapshot.id, revision: snapshot.revision, identity: exportIdentity(snapshot) });
    if (ownerTabId === tabId && !conflict && !persistenceFailed && draft?.id === snapshot.id && draft.revision === snapshot.revision) draft.exportedRevision = snapshot.revision;
    if (ownerTabId === tabId) status('copied');
  } catch { if (ownerTabId === tabId) status('copyFailed', true); }
}

async function download() {
  if (!draft || tabId === undefined) return;
  const ownerTabId = tabId;
  const snapshot = structuredClone(draft);
  await persistence;
  if (ownerTabId !== tabId) return;
  status('downloadStarted');
  try {
    const result = await rpc({ type: 'download', tabId: ownerTabId, text: renderExport(snapshot), filename: sanitizeFilename(snapshot.filename), id: snapshot.id, revision: snapshot.revision, identity: exportIdentity(snapshot) });
    if (result?.error && ownerTabId === tabId) status('downloadFailed', true);
  } catch { if (ownerTabId === tabId) status('downloadFailed', true); }
}

function consumePending(pending: PendingCapture) {
  if (pending.tabId !== tabId || pendingIds.has(pending.id) || clearing) return;
  if (!initialized) { deferredPending.push(pending); return; }
  pendingIds.add(pending.id);
  const importEpoch = documentEpoch;
  importQueue = importQueue.then(async () => {
    await importPayload(pending.payload, pending.tabId, importEpoch);
    await rpc({ type: 'consume-capture', id: pending.id, tabId: pending.tabId });
  }).catch(() => {
    if (pending.tabId === tabId) status('captureFailed', true);
  });
}

async function loadTab(nextTabId: number) {
  if (tabId === nextTabId || !Number.isInteger(nextTabId)) return;
  await persistence;
  await importQueue;
  tabId = nextTabId;
  documentEpoch++;
  draft = undefined;
  original = undefined;
  pasteAsNew = false;
  currentView = 'markdown';
  conflict = false;
  persistenceFailed = false;
  busy = false;
  pickerActive = false;
  clearing = false;
  storedIdentity = { id: null, revision: null };
  try {
    const state = await rpc({ type: 'state', tabId: nextTabId });
    // A second switch may have happened while the storage request was pending.
    if (tabId !== nextTabId) return;
    draft = state.draft;
    settings = state.settings;
    storedIdentity = { id: draft?.id ?? null, revision: draft?.revision ?? null };
    initialized = true;
    render();
    for (const pending of deferredPending.splice(0)) consumePending(pending);
    for (const pending of state.pendingCaptures as PendingCapture[]) consumePending(pending);
  } catch { render(); status('storageFailed', true); }
}

browser.tabs.onActivated.addListener(({ tabId: activatedTabId }) => {
  void (async () => {
    try {
      const [active] = await browser.tabs.query({ active: true, currentWindow: true });
      if (active?.id === activatedTabId) await loadTab(activatedTabId);
    } catch { /* A browser window may be closing. */ }
  })();
});

browser.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  const pending = changes.pendingCaptures?.newValue as PendingCapture[] | undefined;
  if (pending) {
    if (pending.some((item) => item.tabId === tabId)) {
      pickerActive = false;
      document.querySelector<HTMLButtonElement>('#clear')?.toggleAttribute('disabled', busy || clearing);
    }
    for (const item of pending) consumePending(item);
  }
  const captureError = changes.captureError?.newValue as { tabId: number } | undefined;
  if (captureError?.tabId === tabId) status('captureFailed', true);
  const cancelled = changes.pickerCancelled?.newValue as { tabId: number } | undefined;
  if (cancelled?.tabId === tabId) {
    pickerActive = false;
    document.querySelector<HTMLButtonElement>('#clear')?.toggleAttribute('disabled', busy || clearing);
    status('cancelled');
  }
  const event = changes.exportEvent?.newValue as { tabId: number; state: string } | undefined;
  if (event && event.tabId === tabId) status(event.state === 'complete' ? 'downloaded' : 'downloadFailed', event.state !== 'complete');
  const remoteMap = changes.draftsByTab?.newValue as Record<string, Draft> | undefined;
  const remote = tabId === undefined ? undefined : remoteMap?.[String(tabId)];
  if (draft && remote?.id === draft.id && remote.revision === draft.revision && exportIdentity(remote) === exportIdentity(draft)) draft.exportedRevision = remote.exportedRevision;
});

void (async () => {
  try {
    const [active] = await browser.tabs.query({ active: true, currentWindow: true });
    if (!active?.id) throw new Error('No active tab');
    await loadTab(active.id);
  } catch { render(); status('storageFailed', true); }
})();
