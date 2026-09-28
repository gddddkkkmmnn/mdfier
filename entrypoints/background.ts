import { browser } from 'wxt/browser';
import { exportIdentity } from '../lib/export-identity';
import { CAPTURE_PROTOCOL_VERSION, type CapturePayload, type Draft, type Settings } from '../lib/types';

type PendingCapture = { id: string; tabId: number; payload: CapturePayload };
type DownloadRecord = { id: string; tabId: number; revision: number; identity: string; objectUrl?: string };
type ActivePickIds = Record<string, string>;
const DRAFT_MODEL_VERSION = 2;

export default defineBackground(() => {
  let queue: Promise<unknown> = Promise.resolve();
  const serial = <T>(fn: () => Promise<T>) => {
    const next = queue.then(fn, fn);
    queue = next.catch(() => {});
    return next;
  };
  let startupCleanup: Promise<unknown> = Promise.resolve();
  const closedTabs = new Set<number>();
  const documentEpochs = new Map<number, number>();
  const epoch = (tabId: number) => documentEpochs.get(tabId) ?? 0;
  const initialSettings = (): Settings => ({
    language: browser.i18n.getUILanguage().startsWith('uk') ? 'uk' : 'en',
  });
  async function settings(): Promise<Settings> {
    const stored = (await browser.storage.local.get('settings')).settings as Settings | undefined;
    return { language: stored?.language === 'uk' ? 'uk' : stored?.language === 'en' ? 'en' : initialSettings().language };
  }
  async function menu() {
    const s = await settings();
    await browser.contextMenus.removeAll();
    browser.contextMenus.create({
      id: 'selection',
      title: s.language === 'uk' ? 'Зберегти виділення як Markdown' : 'Capture selection as Markdown',
      contexts: ['selection'],
    });
  }
  function openPanel(windowId?: number) {
    if (import.meta.env.FIREFOX) return (browser as unknown as { sidebarAction: { open(): Promise<void> } }).sidebarAction.open();
    return browser.sidePanel.open({ windowId: windowId ?? browser.windows.WINDOW_ID_CURRENT });
  }
  // Open synchronously within the toolbar gesture; Firefox requires user activation.
  browser.action.onClicked.addListener((tab) => { void openPanel(tab.windowId).catch(() => {}); });
  browser.runtime.onInstalled.addListener(() => { void menu(); });
  browser.runtime.onStartup.addListener(() => {
    startupCleanup = serial(async () => {
      const { draftModelVersion } = await browser.storage.local.get('draftModelVersion') as { draftModelVersion?: number };
      // Keep the previous single draft only until its one-time migration has run.
      if (draftModelVersion === DRAFT_MODEL_VERSION) {
        await browser.storage.local.remove(['draftsByTab', 'pendingCaptures', 'draft', 'pendingCapture']);
      }
      // Pickers live in page content scripts; clear their tokens after a browser restart.
      await browser.storage.local.remove('activePickIds');
      await menu();
    });
  });
  browser.tabs.onRemoved.addListener((tabId) => {
    closedTabs.add(tabId);
    documentEpochs.delete(tabId);
    void serial(async () => {
      const { draftsByTab = {}, pendingCaptures = [], activePickIds = {} } = await browser.storage.local.get(['draftsByTab', 'pendingCaptures', 'activePickIds']) as {
        draftsByTab?: Record<string, Draft>; pendingCaptures?: PendingCapture[]; activePickIds?: ActivePickIds;
      };
      delete draftsByTab[String(tabId)];
      delete activePickIds[String(tabId)];
      const remaining = pendingCaptures.filter((item) => item.tabId !== tabId);
      await browser.storage.local.set({ draftsByTab, pendingCaptures: remaining, activePickIds });
    });
  });
  browser.tabs.onActivated.addListener(({ tabId }) => { closedTabs.delete(tabId); });

  async function captureProtocol(tabId: number) {
    try {
      const reply = await browser.tabs.sendMessage(tabId, { type: 'capture-ping' });
      return reply?.protocol === CAPTURE_PROTOCOL_VERSION;
    } catch { return false; }
  }
  async function capture(tabId: number, kind: 'page' | 'selection' | 'element', pickId?: string) {
    if (!(await captureProtocol(tabId))) {
      await browser.scripting.executeScript({ target: { tabId }, files: ['/content-scripts/capture.js'] });
      if (!(await captureProtocol(tabId))) throw new Error('capture-script-unavailable');
    }
    if (kind === 'element') {
      if (!pickId) throw new Error('missing-pick-id');
      return browser.tabs.sendMessage(tabId, { type: 'pick', language: (await settings()).language, pickId });
    }
    return browser.tabs.sendMessage(tabId, { type: 'capture', kind });
  }
  async function dropActivePick(tabId: number, cancel = false) {
    let pickId: string | undefined;
    await serial(async () => {
      const { activePickIds = {} } = await browser.storage.local.get('activePickIds') as { activePickIds?: ActivePickIds };
      pickId = activePickIds[String(tabId)];
      if (pickId) {
        delete activePickIds[String(tabId)];
        await browser.storage.local.set({ activePickIds });
      }
    });
    if (cancel && pickId) {
      try { await browser.tabs.sendMessage(tabId, { type: 'cancel-pick', pickId }); } catch { /* The page may have navigated or be protected. */ }
    }
  }
  async function publishPickResult(tabId: number, pickId: string, payload: CapturePayload) {
    return serial(async () => {
      if (closedTabs.has(tabId)) return;
      const { activePickIds = {}, pendingCaptures = [] } = await browser.storage.local.get(['activePickIds', 'pendingCaptures']) as {
        activePickIds?: ActivePickIds; pendingCaptures?: PendingCapture[];
      };
      if (activePickIds[String(tabId)] !== pickId) return;
      delete activePickIds[String(tabId)];
      const item = { id: crypto.randomUUID(), tabId, payload };
      await browser.storage.local.set({ activePickIds, pendingCaptures: [...pendingCaptures, item] });
    });
  }
  async function publish(tabId: number, payload: CapturePayload, expectedEpoch = epoch(tabId)) {
    return serial(async () => {
      if (closedTabs.has(tabId) || epoch(tabId) !== expectedEpoch) return;
      const { pendingCaptures = [] } = await browser.storage.local.get('pendingCaptures') as { pendingCaptures?: PendingCapture[] };
      const item = { id: crypto.randomUUID(), tabId, payload };
      await browser.storage.local.set({ pendingCaptures: [...pendingCaptures, item] });
    });
  }
  browser.contextMenus.onClicked.addListener((info, tab) => {
    if (info.menuItemId !== 'selection' || tab?.id === undefined) return;
    const tabId = tab.id;
    const captureEpoch = epoch(tabId);
    // Open during the gesture, then extract. The pending import always carries
    // the tab where the user made the selection.
    void openPanel(tab.windowId).catch(() => {});
    void (async () => {
      try {
        const result = await capture(tabId, 'selection');
        if (result?.payload) await publish(tabId, result.payload, captureEpoch);
        else if (info.selectionText?.trim()) await publish(tabId, {
          kind: 'selection', text: info.selectionText, title: tab.title, sourceUrl: tab.url, capturedAt: new Date().toISOString(),
        }, captureEpoch);
        else await browser.storage.local.set({ captureError: { id: crypto.randomUUID(), tabId } });
      } catch {
        if (info.selectionText?.trim()) await publish(tabId, {
          kind: 'selection', text: info.selectionText, title: tab.title, sourceUrl: tab.url, capturedAt: new Date().toISOString(),
        }, captureEpoch);
        else await browser.storage.local.set({ captureError: { id: crypto.randomUUID(), tabId } });
      }
    })();
  });

  async function getDrafts() {
    return ((await browser.storage.local.get('draftsByTab')).draftsByTab as Record<string, Draft> | undefined) ?? {};
  }
  async function migrateLegacyDraft(tabId: number) {
    const stored = await browser.storage.local.get(['draftModelVersion', 'draft', 'draftsByTab']) as {
      draftModelVersion?: number; draft?: Draft; draftsByTab?: Record<string, Draft>;
    };
    if (stored.draftModelVersion === DRAFT_MODEL_VERSION) return stored.draftsByTab ?? {};
    const draftsByTab = stored.draftsByTab ?? {};
    if (stored.draft && !closedTabs.has(tabId)) draftsByTab[String(tabId)] ??= stored.draft;
    await browser.storage.local.set({ draftsByTab, draftModelVersion: DRAFT_MODEL_VERSION });
    await browser.storage.local.remove('draft');
    return draftsByTab;
  }
  async function markExported(tabId: number, id: string, revision: number, identity: string) {
    const draftsByTab = await getDrafts();
    const key = String(tabId);
    const draft = draftsByTab[key];
    if (draft?.id === id && draft.revision === revision && exportIdentity(draft) === identity) {
      draftsByTab[key] = { ...draft, exportedRevision: revision };
      await browser.storage.local.set({ draftsByTab });
    }
  }
  async function finishDownload(downloadId: number, state: string) {
    const { downloads = {} } = await browser.storage.local.get('downloads') as { downloads?: Record<number, DownloadRecord> };
    const item = downloads[downloadId];
    if (!item) return;
    if (state === 'complete') await markExported(item.tabId, item.id, item.revision, item.identity);
    if (item.objectUrl) URL.revokeObjectURL(item.objectUrl);
    delete downloads[downloadId];
    await browser.storage.local.set({ downloads });
    await browser.storage.local.set({ exportEvent: { id: crypto.randomUUID(), tabId: item.tabId, state } });
  }
  browser.downloads.onChanged.addListener((delta) => {
    if (delta.state?.current === 'complete' || delta.state?.current === 'interrupted') {
      void serial(() => finishDownload(delta.id, delta.state!.current!));
    }
  });

  browser.runtime.onMessage.addListener((msg, sender) => {
    if (msg.type === 'capture-result') {
      if (sender.tab?.id !== undefined && sender.frameId === 0 && typeof msg.pickId === 'string') {
        return publishPickResult(sender.tab.id, msg.pickId, msg.payload);
      }
      return;
    }
    if (msg.type === 'pick-cancelled') {
      if (sender.tab?.id !== undefined) {
        const tabId = sender.tab.id;
        return serial(async () => {
          const { activePickIds = {} } = await browser.storage.local.get('activePickIds') as { activePickIds?: ActivePickIds };
          if (!msg.pickId || activePickIds[String(tabId)] !== msg.pickId) return;
          delete activePickIds[String(tabId)];
          await browser.storage.local.set({ activePickIds, pickerCancelled: { id: crypto.randomUUID(), tabId } });
        });
      }
      return;
    }
    if (!sender.url?.startsWith(browser.runtime.getURL('/panel.html'))) return;
    if (msg.type === 'capture-active') return (async () => {
      const [active] = await browser.tabs.query({ active: true, currentWindow: true });
      const tabId = Number(msg.tabId);
      if (!Number.isInteger(tabId) || !active || active.id !== tabId || closedTabs.has(tabId)) return { error: 'access', tabId };
      try {
        if (msg.kind !== 'element') await dropActivePick(tabId, true);
        const pickId = msg.kind === 'element' ? crypto.randomUUID() : undefined;
        if (pickId) {
          await serial(async () => {
            const { activePickIds = {} } = await browser.storage.local.get('activePickIds') as { activePickIds?: ActivePickIds };
            activePickIds[String(tabId)] = pickId;
            await browser.storage.local.set({ activePickIds });
          });
        }
        const result = await capture(tabId, msg.kind, pickId);
        if (result?.picking) {
          return { tabId, picking: true };
        }
        if (pickId) await dropActivePick(tabId);
        return { tabId, ...result };
      } catch {
        if (msg.kind === 'element') await dropActivePick(tabId, true);
        return { error: 'access', tabId };
      }
    })();
    if (msg.type === 'state') return serial(async () => {
      await startupCleanup;
      const tabId = Number(msg.tabId);
      if (!Number.isInteger(tabId)) return { settings: await settings(), draft: undefined, draftsByTab: {}, pendingCaptures: [] };
      const draftsByTab = await migrateLegacyDraft(tabId);
      const { pendingCaptures = [] } = await browser.storage.local.get('pendingCaptures') as { pendingCaptures?: PendingCapture[] };
      return {
        settings: await settings(), draftsByTab,
        draft: draftsByTab[String(tabId)],
        pendingCaptures: pendingCaptures.filter((item) => item.tabId === tabId),
      };
    });
    if (msg.type === 'save-draft') return serial(async () => {
      const tabId = Number(msg.tabId);
      const incoming = msg.draft as Draft;
      if (!Number.isInteger(tabId) || closedTabs.has(tabId)) return { closed: true };
      const draftsByTab = await getDrafts();
      const key = String(tabId);
      const draft = draftsByTab[key];
      if ((draft?.id ?? null) !== msg.expectedId || (draft?.revision ?? null) !== msg.expectedRevision) return { conflict: true };
      if (draft?.id === incoming.id && draft.revision > incoming.revision) return { conflict: true };
      if (draft?.id === incoming.id) incoming.exportedRevision = draft.exportedRevision;
      draftsByTab[key] = incoming;
      await browser.storage.local.set({ draftsByTab, draftModelVersion: DRAFT_MODEL_VERSION });
      return { ok: true };
    });
    if (msg.type === 'clear-draft') return serial(async () => {
      const tabId = Number(msg.tabId);
      if (!Number.isInteger(tabId) || closedTabs.has(tabId)) return { closed: true };
      documentEpochs.set(tabId, epoch(tabId) + 1);
      const draftsByTab = await getDrafts();
      delete draftsByTab[String(tabId)];
      const { pendingCaptures = [], activePickIds = {} } = await browser.storage.local.get(['pendingCaptures', 'activePickIds']) as { pendingCaptures?: PendingCapture[]; activePickIds?: ActivePickIds };
      const pickId = activePickIds[String(tabId)];
      delete activePickIds[String(tabId)];
      await browser.storage.local.set({ draftsByTab, activePickIds, pendingCaptures: pendingCaptures.filter((item) => item.tabId !== tabId) });
      if (pickId) {
        try { await browser.tabs.sendMessage(tabId, { type: 'cancel-pick', pickId }); } catch { /* The page may have navigated or be protected. */ }
      }
      return { ok: true };
    });
    if (msg.type === 'consume-capture') return serial(async () => {
      const { pendingCaptures = [] } = await browser.storage.local.get('pendingCaptures') as { pendingCaptures?: PendingCapture[] };
      await browser.storage.local.set({ pendingCaptures: pendingCaptures.filter((item) => item.id !== msg.id || item.tabId !== msg.tabId) });
    });
    if (msg.type === 'settings') return serial(async () => {
      await browser.storage.local.set({ settings: { language: msg.settings.language === 'uk' ? 'uk' : 'en' } });
      await menu();
    });
    if (msg.type === 'mark-exported') return serial(() => markExported(Number(msg.tabId), msg.id, msg.revision, msg.identity));
    if (msg.type === 'download') return serial(async () => {
      let objectUrl: string | undefined;
      try {
        const tabId = Number(msg.tabId);
        const url = import.meta.env.FIREFOX
          ? (objectUrl = URL.createObjectURL(new Blob([msg.text], { type: 'text/markdown;charset=utf-8' })))
          : 'data:text/markdown;charset=utf-8,' + encodeURIComponent(msg.text);
        const downloadId = await browser.downloads.download({ url, filename: msg.filename + '.md', saveAs: true });
        const { downloads = {} } = await browser.storage.local.get('downloads') as { downloads?: Record<number, DownloadRecord> };
        downloads[downloadId] = { id: msg.id, tabId, revision: msg.revision, identity: msg.identity, ...(objectUrl ? { objectUrl } : {}) };
        await browser.storage.local.set({ downloads });
        const [item] = await browser.downloads.search({ id: downloadId });
        if (item && item.state !== 'in_progress') await finishDownload(downloadId, item.state);
        return { ok: true };
      } catch {
        if (objectUrl) URL.revokeObjectURL(objectUrl);
        return { error: 'download' };
      }
    });
  });
});
