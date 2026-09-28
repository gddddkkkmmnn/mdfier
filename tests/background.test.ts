import { CAPTURE_PROTOCOL_VERSION } from '../lib/types';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Draft } from '../lib/types';
import { exportIdentity } from '../lib/export-identity';

const OriginalURL = URL;
const harness = vi.hoisted(() => {
  const state: Record<string, any> = {};
  const listeners: Record<string, (...args: any[]) => any> = {};
  const event = (name: string) => ({ addListener: vi.fn((callback: (...args: any[]) => any) => { listeners[name] = callback; }) });
  const browser = {
    i18n: { getUILanguage: () => 'en-US' },
    windows: { WINDOW_ID_CURRENT: -2 },
    action: { onClicked: event('action') },
    sidePanel: { open: vi.fn(async () => {}) },
    sidebarAction: { open: vi.fn(async () => {}) },
    contextMenus: { removeAll: vi.fn(async () => {}), create: vi.fn(), onClicked: event('context') },
    runtime: {
      onMessage: event('message'), onInstalled: event('installed'), onStartup: event('startup'),
      getURL: (path: string) => `chrome-extension://test/${path.replace(/^\//, '')}`,
    },
    storage: { local: {
      get: vi.fn(async (keys: string | string[]) => Object.fromEntries((Array.isArray(keys) ? keys : [keys]).filter(key => key in state).map(key => [key, structuredClone(state[key])]))),
      set: vi.fn(async (entries: Record<string, any>) => { Object.assign(state, structuredClone(entries)); }),
      remove: vi.fn(async (keys: string | string[]) => { for (const key of Array.isArray(keys) ? keys : [keys]) delete state[key]; }),
    } },
    scripting: { executeScript: vi.fn(async () => []) },
    tabs: { query: vi.fn(async () => [{ id: 1, windowId: 10 }]), sendMessage: vi.fn(async () => ({})), onRemoved: event('tabRemoved'), onActivated: event('tabActivated') },
    downloads: {
      download: vi.fn(async () => 42), search: vi.fn(async () => [{ id: 42, state: 'in_progress' }]), onChanged: event('downloadChanged'),
    },
  };
  return { state, listeners, browser };
});
vi.mock('wxt/browser', () => ({ browser: harness.browser }));

const initialDraft = (overrides: Partial<Draft> = {}): Draft => ({
  id: 'draft-a', markdown: '# Notes', filename: 'notes', capturedAt: '2026-09-24T12:00:00Z',
  revision: 3, exportedRevision: null, warnings: [], ...overrides,
});
const panel = (tabId = 1) => ({ url: 'chrome-extension://test/panel.html', tab: { id: 900, windowId: 10 }, tabId });
const send = (message: Record<string, any>, tabId = 1) => harness.listeners.message!(message, panel(tabId));
const save = (draft: Draft, expectedId: string | null = 'draft-a', expectedRevision: number | null = 3, tabId = 1) =>
  send({ type: 'save-draft', tabId, draft, expectedId, expectedRevision }, tabId);
const stored = (tabId = 1) => harness.state.draftsByTab?.[String(tabId)];
const download = (tabId = 1) => send({ type: 'download', tabId, id: 'draft-a', revision: 3, identity: exportIdentity(initialDraft()), text: '# Notes', filename: 'notes' }, tabId);
async function finish(state: 'complete' | 'interrupted') {
  harness.listeners.downloadChanged!({ id: 42, state: { current: state } });
  await send({ type: 'state', tabId: 1 });
}

beforeEach(async () => {
  vi.resetModules(); vi.clearAllMocks(); vi.unstubAllEnvs();
  vi.stubGlobal('URL', Object.assign(class extends OriginalURL {}, {
    createObjectURL: vi.fn(() => 'blob:moz-extension://test/export-42'), revokeObjectURL: vi.fn(),
  }));
  for (const key of Object.keys(harness.state)) delete harness.state[key];
  for (const key of Object.keys(harness.listeners)) delete harness.listeners[key];
  harness.browser.downloads.download.mockResolvedValue(42);
  harness.browser.downloads.search.mockResolvedValue([{ id: 42, state: 'in_progress' }]);
  harness.browser.tabs.query.mockResolvedValue([{ id: 1, windowId: 10 }]);
  harness.browser.tabs.sendMessage.mockReset().mockResolvedValue({});
  harness.browser.scripting.executeScript.mockReset().mockResolvedValue([]);
  vi.stubGlobal('defineBackground', (main: () => void) => main());
  await import('../entrypoints/background');
  harness.state.draftsByTab = { '1': initialDraft() };
  harness.state.draftModelVersion = 2;
  harness.state.settings = { language: 'uk' };
});

describe('toolbar entry point', () => {
  it.each([false, true])('opens the panel synchronously (Firefox: %s)', async (firefox) => {
    vi.resetModules();
    vi.stubEnv('FIREFOX', firefox ? 'true' : '');
    await import('../entrypoints/background');
    harness.listeners.action!({ id: 1, windowId: 10 });
    if (firefox) {
      expect(harness.browser.sidebarAction.open).toHaveBeenCalledOnce();
      expect(harness.browser.sidePanel.open).not.toHaveBeenCalled();
    } else {
      expect(harness.browser.sidePanel.open).toHaveBeenCalledWith({ windowId: 10 });
      expect(harness.browser.sidebarAction.open).not.toHaveBeenCalled();
    }
  });
});

describe('per-tab drafts', () => {
  it('isolates two tabs and keeps their revisions independent', async () => {
    await save(initialDraft({ markdown: '# Tab A', revision: 4 }));
    expect(await save(initialDraft({ id: 'draft-b', markdown: '# Tab B', revision: 0 }), null, null, 2)).toEqual({ ok: true });
    expect(stored(1).markdown).toBe('# Tab A');
    expect(stored(2).markdown).toBe('# Tab B');
    expect((await send({ type: 'state', tabId: 2 }, 2)).draft.markdown).toBe('# Tab B');
  });

  it('deletes only the closed tab draft and its pending captures', async () => {
    harness.state.draftsByTab['2'] = initialDraft({ id: 'draft-b', markdown: '# B' });
    harness.state.pendingCaptures = [
      { id: 'a-capture', tabId: 1, payload: { kind: 'page', text: 'A' } },
      { id: 'b-capture', tabId: 2, payload: { kind: 'page', text: 'B' } },
    ];
    harness.listeners.tabRemoved!(2);
    await send({ type: 'state', tabId: 1 });
    expect(stored(1)).toBeDefined();
    expect(stored(2)).toBeUndefined();
    expect(harness.state.pendingCaptures.map((item: any) => item.tabId)).toEqual([1]);
  });

  it('clears only the active tab document and preserves settings and neighboring tabs', async () => {
    harness.state.draftsByTab['2'] = initialDraft({ id: 'draft-b', markdown: '# B' });
    harness.state.pendingCaptures = [
      { id: 'a-capture', tabId: 1, payload: { kind: 'page', text: 'A' } },
      { id: 'b-capture', tabId: 2, payload: { kind: 'page', text: 'B' } },
    ];
    expect(await send({ type: 'clear-draft', tabId: 1 })).toEqual({ ok: true });
    expect(stored(1)).toBeUndefined();
    expect(stored(2).markdown).toBe('# B');
    expect(harness.state.pendingCaptures.map((item: any) => item.tabId)).toEqual([2]);
    expect(harness.state.settings).toEqual({ language: 'uk' });
  });

  it('drops a block result that arrives after its document was cleared', async () => {
    harness.browser.tabs.sendMessage
      .mockResolvedValueOnce({ protocol: CAPTURE_PROTOCOL_VERSION })
      .mockResolvedValueOnce({ picking: true });
    expect(await send({ type: 'capture-active', kind: 'element', tabId: 1 })).toEqual({ tabId: 1, picking: true });
    const pickId = harness.state.activePickIds['1'];
    expect(pickId).toBeTruthy();
    await send({ type: 'clear-draft', tabId: 1 });
    expect(harness.browser.tabs.sendMessage).toHaveBeenCalledWith(1, { type: 'cancel-pick', pickId });
    // Simulate a background restart: only durable state survives, not its maps.
    vi.resetModules();
    await import('../entrypoints/background');
    await harness.listeners.message!({ type: 'capture-result', pickId, payload: { kind: 'element', text: 'Late block' } }, { tab: { id: 1 }, frameId: 0 });
    expect(harness.state.pendingCaptures).toEqual([]);
    expect(stored(1)).toBeUndefined();
  });

  it('clears tab documents on browser startup but preserves shared settings', async () => {
    harness.state.draftsByTab['2'] = initialDraft({ id: 'draft-b' });
    harness.state.pendingCaptures = [{ id: 'pending', tabId: 1, payload: { kind: 'page', text: 'x' } }];
    harness.listeners.startup!();
    const state = await send({ type: 'state', tabId: 1 });
    expect(state.draft).toBeUndefined();
    expect(harness.state.draftsByTab).toBeUndefined();
    expect(harness.state.pendingCaptures).toBeUndefined();
    expect(state.settings).toEqual({ language: 'uk' });
  });

  it('migrates the removed source preference to always enabled', async () => {
    harness.state.settings = { language: 'en', includeSource: false };
    expect((await send({ type: 'state', tabId: 1 })).settings).toEqual({ language: 'en' });
    await send({ type: 'settings', settings: { language: 'uk', includeSource: false } });
    expect(harness.state.settings).toEqual({ language: 'uk' });
  });

  it('migrates a legacy singleton draft once into the active tab', async () => {
    harness.state.draft = initialDraft({ markdown: '# Legacy' });
    delete harness.state.draftModelVersion;
    delete harness.state.draftsByTab;
    const state = await send({ type: 'state', tabId: 8 }, 8);
    expect(state.draft.markdown).toBe('# Legacy');
    expect(harness.state.draftsByTab).toEqual({ '8': expect.objectContaining({ markdown: '# Legacy' }) });
    expect(harness.state.draft).toBeUndefined();
    await send({ type: 'state', tabId: 9 }, 9);
    expect(stored(9)).toBeUndefined();
  });

  it('does not deliver a delayed result from another or closed tab to the active document', async () => {
    await harness.listeners.message!({ type: 'capture-result', payload: { kind: 'page', text: 'A result' } }, { tab: { id: 1 }, frameId: 0 });
    const stateB = await send({ type: 'state', tabId: 2 }, 2);
    expect(stateB.pendingCaptures).toEqual([]);
    harness.listeners.tabRemoved!(1);
    await send({ type: 'state', tabId: 2 }, 2);
    await harness.listeners.message!({ type: 'capture-result', payload: { kind: 'page', text: 'late result' } }, { tab: { id: 1 }, frameId: 0 });
    expect(harness.state.pendingCaptures).toEqual([]);
    expect(stored(2)).toBeUndefined();
  });

  it('rejects draft mutation messages from page content scripts', async () => {
    await harness.listeners.message!({ type: 'save-draft', tabId: 1, draft: initialDraft({ markdown: 'overwrite' }), expectedId: 'draft-a', expectedRevision: 3 }, { tab: { id: 1 }, url: 'https://example.com' });
    expect(stored().markdown).toBe('# Notes');
  });
});

describe('capture script lifecycle', () => {
  it('reuses a matching live capture script without reinjection', async () => {
    harness.browser.tabs.sendMessage
      .mockResolvedValueOnce({ protocol: CAPTURE_PROTOCOL_VERSION })
      .mockResolvedValueOnce({ payload: { kind: 'page', text: 'Current', capturedAt: '2026-09-24T12:00:00Z' } });
    const result = await send({ type: 'capture-active', kind: 'page', tabId: 1 });
    expect(result.payload.text).toBe('Current');
    expect(harness.browser.scripting.executeScript).not.toHaveBeenCalled();
    expect(harness.browser.tabs.sendMessage).toHaveBeenNthCalledWith(1, 1, { type: 'capture-ping' });
  });

  it('reinjects when the page has an old or missing capture script', async () => {
    harness.browser.tabs.sendMessage
      .mockResolvedValueOnce({ protocol: CAPTURE_PROTOCOL_VERSION - 1 })
      .mockResolvedValueOnce({ protocol: CAPTURE_PROTOCOL_VERSION })
      .mockResolvedValueOnce({ payload: { kind: 'page', text: 'Fresh', capturedAt: '2026-09-24T12:00:00Z' } });
    const result = await send({ type: 'capture-active', kind: 'page', tabId: 1 });
    expect(result.payload.text).toBe('Fresh');
    expect(harness.browser.scripting.executeScript).toHaveBeenCalledWith({ target: { tabId: 1 }, files: ['/content-scripts/capture.js'] });
  });

  it('reports access failure without changing the current draft', async () => {
    harness.browser.tabs.sendMessage.mockRejectedValue(new Error('Restricted page'));
    harness.browser.scripting.executeScript.mockRejectedValue(new Error('Restricted page'));
    expect(await send({ type: 'capture-active', kind: 'page', tabId: 1 })).toEqual({ error: 'access', tabId: 1 });
    expect(stored().markdown).toBe('# Notes');
  });
});

describe('revision, replacement, and export identity', () => {
  it('allows only one concurrent save based on the same stored revision', async () => {
    const first = initialDraft({ markdown: '# Panel A', revision: 4 });
    const second = initialDraft({ markdown: '# Panel B', revision: 4 });
    expect(await Promise.all([save(first), save(second)])).toEqual([{ ok: true }, { conflict: true }]);
    expect(stored().markdown).toBe('# Panel A');
  });

  it('replaces a document immediately after a valid new import save and rejects stale writes', async () => {
    await save(initialDraft({ id: 'replacement', markdown: '# Imported', revision: 0 }));
    expect(stored().markdown).toBe('# Imported');
    expect(await save(initialDraft({ markdown: '# Stale', revision: 4 }))).toEqual({ conflict: true });
    expect(stored().markdown).toBe('# Imported');
  });

  it('requires an empty identity to create a document for a new tab', async () => {
    expect(await save(initialDraft(), null, null, 5)).toEqual({ ok: true });
    expect(stored(5).id).toBe('draft-a');
  });

  it('marks only the matching document, revision, tab, and export identity', async () => {
    const winner = initialDraft({ markdown: '# Winner', revision: 4 });
    const loser = initialDraft({ markdown: '# Loser', revision: 4 });
    await save(winner);
    await send({ type: 'mark-exported', tabId: 1, id: loser.id, revision: loser.revision, identity: exportIdentity(loser) });
    expect(stored().exportedRevision).toBeNull();
    await send({ type: 'mark-exported', tabId: 1, id: winner.id, revision: winner.revision, identity: exportIdentity(winner) });
    expect(stored().exportedRevision).toBe(4);
    await send({ type: 'mark-exported', tabId: 2, id: winner.id, revision: winner.revision, identity: exportIdentity(winner) });
    expect(stored().exportedRevision).toBe(4);
  });

  it('preserves an export completion when a newer revision is saved', async () => {
    await send({ type: 'mark-exported', tabId: 1, id: 'draft-a', revision: 3, identity: exportIdentity(initialDraft()) });
    await save(initialDraft({ markdown: '# Edited', revision: 4 }));
    expect(stored().revision).toBe(4);
    expect(stored().exportedRevision).toBe(3);
  });

  it('tracks a download until completion and does not mark cancellation as exported', async () => {
    expect(await download()).toEqual({ ok: true });
    expect(stored().exportedRevision).toBeNull();
    expect(harness.state.downloads[42]).toEqual({ id: 'draft-a', tabId: 1, revision: 3, identity: exportIdentity(initialDraft()) });
    await finish('complete');
    expect(stored().exportedRevision).toBe(3);
    expect(harness.state.downloads[42]).toBeUndefined();
    expect(harness.state.exportEvent.state).toBe('complete');
    expect(harness.state.exportEvent.tabId).toBe(1);
  });

  it('does not mark a cancelled, interrupted, stale, or replaced document exported', async () => {
    harness.browser.downloads.download.mockRejectedValueOnce(new Error('User cancelled'));
    expect(await download()).toEqual({ error: 'download' });
    expect(stored().exportedRevision).toBeNull();
    await download();
    await save(initialDraft({ id: 'new-doc', markdown: '# Replacement', revision: 0 }));
    await finish('interrupted');
    expect(stored().id).toBe('new-doc');
    expect(stored().exportedRevision).toBeNull();
    expect(harness.state.downloads[42]).toBeUndefined();
  });

  it('handles completion before download tracking is installed', async () => {
    harness.browser.downloads.search.mockResolvedValueOnce([{ id: 42, state: 'complete' }]);
    await download();
    expect(stored().exportedRevision).toBe(3);
    expect(harness.state.downloads[42]).toBeUndefined();
  });

  it('uses Firefox Blob URLs and revokes them after completion', async () => {
    vi.stubEnv('FIREFOX', 'true');
    await download();
    expect(URL.createObjectURL).toHaveBeenCalledWith(expect.any(Blob));
    expect(harness.state.downloads[42].objectUrl).toBe('blob:moz-extension://test/export-42');
    await finish('complete');
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:moz-extension://test/export-42');
  });
});

describe('export snapshot identity', () => {
  it('is stable across bookkeeping changes and sensitive to each export input', () => {
    const baseline = initialDraft();
    expect(exportIdentity({ ...baseline, id: 'other', revision: 9, exportedRevision: 8, warnings: ['warning'] })).toBe(exportIdentity(baseline));
    for (const change of [
      { markdown: '# Different' }, { filename: 'other' }, { sourceUrl: 'https://example.com/' },
      { capturedAt: '2026-09-25T12:00:00Z' },
    ]) expect(exportIdentity({ ...baseline, ...change })).not.toBe(exportIdentity(baseline));
  });
});
