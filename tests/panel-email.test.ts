import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Draft } from '../lib/types';
import { renderExport } from '../lib/conversion';

const io = vi.hoisted(() => ({ rpc: vi.fn(), open: vi.fn(), copy: vi.fn(), activated: vi.fn(), changed: vi.fn(), query: vi.fn(), manifest: vi.fn(), permission: vi.fn() }));
vi.mock('wxt/browser', () => ({ browser: {
  runtime: { sendMessage: io.rpc, getManifest: io.manifest },
  permissions: { request: io.permission },
  tabs: { query: io.query, create: io.open, onActivated: { addListener: io.activated } },
  storage: { onChanged: { addListener: io.changed } },
} }));
let stored: Draft;
const clipboardDescriptor = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
const button = (id: string) => document.getElementById(id) as HTMLButtonElement;
const editor = () => document.getElementById('editor') as HTMLTextAreaElement;
async function start(markdown = '# A useful note\n\nShare this text.') {
  stored = { id: 'panel-note', filename: 'A useful note', markdown, capturedAt: '2026-10-10T08:00:00.000Z', sourceUrl: 'https://example.test/notes', revision: 0, exportedRevision: null, warnings: [] };
  io.rpc.mockImplementation(async message => message.type === 'state' ? { draft: structuredClone(stored), settings: { language: 'en' }, pendingCaptures: [] } : { ok: true });
  await import('../entrypoints/panel/main');
  await vi.waitFor(() => expect(button('share-email')).not.toBeNull());
}
beforeEach(() => {
  vi.resetModules();
  Object.values(io).forEach(mock => mock.mockReset());
  io.query.mockResolvedValue([{ id: 7 }]);
  io.open.mockResolvedValue({ id: 8 });
  io.copy.mockResolvedValue(undefined);
  io.manifest.mockReturnValue({});
  io.permission.mockResolvedValue(true);
  document.body.innerHTML = '<div id="app"></div>';
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: io.copy } });
});
afterEach(() => {
  if (clipboardDescriptor) Object.defineProperty(navigator, 'clipboard', clipboardDescriptor);
  else delete (navigator as unknown as { clipboard?: unknown }).clipboard;
});

describe('Email in the panel', () => {
  it('shares current edits from Preview and leaves the document unchanged', async () => {
    await start();
    editor().value = '# Edited note\n\nLatest **text**.';
    editor().dispatchEvent(new Event('input', { bubbles: true }));
    button('tab-preview').click();
    button('share-email').click();
    await vi.waitFor(() => expect(io.open).toHaveBeenCalledOnce());
    const url = new URL(io.open.mock.calls[0]![0].url);
    expect(url.searchParams.get('body')?.replace(/\r\n/g, '\n')).toBe(renderExport({ ...stored, markdown: editor().value }));
    expect(editor().value).toContain('Latest **text**');
    expect(io.copy).not.toHaveBeenCalled();
    expect(io.permission).not.toHaveBeenCalled();
    expect(io.rpc.mock.calls.some(([message]) => message.type === 'mark-exported')).toBe(false);
  });
  it('asks before copying a long document and preserves the editor on cancel', async () => {
    await start('Loaded notes '.repeat(500));
    const existingEditor = editor();
    button('share-email').click();
    expect(document.getElementById('email-fallback')!.hidden).toBe(false);
    expect(document.activeElement?.id).toBe('email-copy-open');
    expect(io.open).not.toHaveBeenCalled();
    expect(io.copy).not.toHaveBeenCalled();
    button('email-cancel').click();
    expect(document.getElementById('email-fallback')!.hidden).toBe(true);
    expect(editor()).toBe(existingEditor);
    expect(editor().value).toBe(stored.markdown);
    expect(document.activeElement?.id).toBe('share-email');
  });
  it('copies every character only after Copy & open email is chosen', async () => {
    await start('Loaded notes '.repeat(500));
    button('share-email').click();
    button('email-copy-open').click();
    await vi.waitFor(() => expect(io.open).toHaveBeenCalledOnce());
    expect(io.copy).toHaveBeenCalledWith(renderExport(stored));
    expect(new URL(io.open.mock.calls[0]![0].url).searchParams.get('body')).toBeNull();
    expect(document.getElementById('status')?.textContent).toContain('Paste the Markdown');
  });
  it('retains the document and shows an error when clipboard access fails', async () => {
    await start('Loaded notes '.repeat(500));
    io.copy.mockRejectedValueOnce(new Error('Denied'));
    button('share-email').click();
    button('email-copy-open').click();
    await vi.waitFor(() => expect(document.getElementById('status')?.classList.contains('error')).toBe(true));
    expect(io.open).not.toHaveBeenCalled();
    expect(editor().value).toBe(stored.markdown);
    expect(button('share-email').disabled).toBe(false);
  });
  it('does not open a late email after Clear', async () => {
    await start('Loaded notes '.repeat(500));
    let completeCopy!: () => void;
    io.copy.mockReturnValueOnce(new Promise<void>(resolve => { completeCopy = resolve; }));
    button('share-email').click();
    button('email-copy-open').click();
    button('clear').click();
    await vi.waitFor(() => expect(document.getElementById('document')!.hidden).toBe(true));
    completeCopy();
    await Promise.resolve();
    await Promise.resolve();
    expect(io.open).not.toHaveBeenCalled();
    expect(button('share-email').hidden).toBe(true);
  });
  it('does not open a delayed email after switching to another tab', async () => {
    await start('Loaded notes '.repeat(500));
    let completeCopy!: () => void;
    io.copy.mockReturnValueOnce(new Promise<void>(resolve => { completeCopy = resolve; }));
    button('share-email').click();
    button('email-copy-open').click();
    stored = { ...stored, id: 'other-tab', markdown: 'A separate tab document.' };
    io.query.mockResolvedValueOnce([{ id: 19 }]);
    io.activated.mock.calls[0]![0]({ tabId: 19 });
    await vi.waitFor(() => expect(editor().value).toBe('A separate tab document.'));
    completeCopy();
    await Promise.resolve();
    await Promise.resolve();
    expect(io.open).not.toHaveBeenCalled();
    expect(editor().value).toBe('A separate tab document.');
    expect(document.getElementById('email-fallback')!.hidden).toBe(true);
  });
  it('retains current edits when the mail handoff is rejected', async () => {
    await start();
    io.open.mockRejectedValueOnce(new Error('Opening denied'));
    button('share-email').click();
    await vi.waitFor(() => expect(document.getElementById('status')?.classList.contains('error')).toBe(true));
    expect(editor().value).toBe(stored.markdown);
    expect(button('share-email').disabled).toBe(false);
    expect(io.rpc.mock.calls.some(([message]) => message.type === 'mark-exported')).toBe(false);
  });
  it('localizes Email and disables it for an empty editor', async () => {
    await start();
    button('language-uk').click();
    expect(button('share-email').textContent).toBe('Пошта');
    expect(button('share-email').getAttribute('aria-label')).toBe('Надіслати електронною поштою');
    editor().value = '  \n';
    editor().dispatchEvent(new Event('input', { bubbles: true }));
    expect(button('share-email').disabled).toBe(true);
    button('share-email').click();
    expect(io.open).not.toHaveBeenCalled();
  });
  it('requests optional Firefox consent before copying and opening', async () => {
    await start('Loaded notes '.repeat(500));
    io.manifest.mockReturnValue({ browser_specific_settings: { gecko: { data_collection_permissions: { required: ['none'], optional: ['websiteContent', 'browsingActivity'] } } } });
    button('share-email').click();
    expect(io.permission).not.toHaveBeenCalled();
    button('email-copy-open').click();
    await vi.waitFor(() => expect(io.open).toHaveBeenCalledOnce());
    expect(io.permission).toHaveBeenCalledWith({ data_collection: ['websiteContent', 'browsingActivity'] });
    expect(io.permission.mock.invocationCallOrder[0]).toBeLessThan(io.copy.mock.invocationCallOrder[0]!);
    expect(io.copy.mock.invocationCallOrder[0]).toBeLessThan(io.open.mock.invocationCallOrder[0]!);
  });
  it('keeps the document and opens nothing if Firefox consent is denied', async () => {
    await start();
    io.manifest.mockReturnValue({ browser_specific_settings: { gecko: { data_collection_permissions: { optional: ['websiteContent', 'browsingActivity'] } } } });
    io.permission.mockResolvedValue(false);
    button('share-email').click();
    await vi.waitFor(() => expect(document.getElementById('status')?.textContent).toContain('not allowed'));
    expect(io.open).not.toHaveBeenCalled();
    expect(io.copy).not.toHaveBeenCalled();
    expect(editor().value).toBe(stored.markdown);
    expect(button('share-email').disabled).toBe(false);
  });
  it('does not open an old message when Clear happens during Firefox consent', async () => {
    await start();
    io.manifest.mockReturnValue({ browser_specific_settings: { gecko: { data_collection_permissions: { optional: ['websiteContent', 'browsingActivity'] } } } });
    let grant!: (allowed: boolean) => void;
    io.permission.mockReturnValueOnce(new Promise<boolean>(resolve => { grant = resolve; }));
    button('share-email').click();
    button('clear').click();
    await vi.waitFor(() => expect(document.getElementById('document')!.hidden).toBe(true));
    grant(true);
    await Promise.resolve();
    await Promise.resolve();
    expect(io.open).not.toHaveBeenCalled();
    expect(button('share-email').hidden).toBe(true);
  });
});
