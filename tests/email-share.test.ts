import { describe, expect, it, vi } from 'vitest';
import { EMAIL_LINK_BUDGET, prepareEmailShare, shareEmail } from '../lib/email-share';
import { renderExport } from '../lib/conversion';
import type { Draft } from '../lib/types';

const draft = (overrides: Partial<Draft> = {}): Draft => ({
  id: 'email-document', filename: 'Польові нотатки', markdown: '# Notes\n\nUseful **text** & a reference.',
  sourceUrl: 'https://example.test/notes', capturedAt: '2026-10-10T08:00:00.000Z',
  revision: 2, exportedRevision: null, warnings: [], ...overrides,
});
const ports = () => ({ copy: vi.fn().mockResolvedValue(undefined), open: vi.fn().mockResolvedValue(undefined), isCurrent: () => true });

describe('email handoff', () => {
  it('uses the export text and document name without a recipient or attachment', () => {
    const document = draft();
    const prepared = prepareEmailShare(document);
    const url = new URL(prepared.inlineUrl!);
    expect(url.protocol).toBe('mailto:');
    expect(url.pathname).toBe('');
    expect(url.searchParams.get('subject')).toBe(document.filename);
    expect(url.searchParams.get('body')?.replace(/\r\n/g, '\n')).toBe(renderExport(document));
    expect([...url.searchParams.keys()]).toEqual(['subject', 'body']);
  });
  it('encodes URL syntax and prevents document text from injecting mail headers', () => {
    const prepared = prepareEmailShare(draft({ filename: 'Report\nBcc: hidden@example.test&body=replace.md', markdown: 'Text &bcc=other@example.test\n# literal? + 100%' }));
    const url = new URL(prepared.inlineUrl!);
    expect([...url.searchParams.keys()]).toEqual(['subject', 'body']);
    expect(url.searchParams.get('subject')).not.toMatch(/[\r\n]/);
    expect(url.searchParams.get('body')).toContain('Text &bcc=other@example.test');
  });
  it.each(['Plain text '.repeat(200_000), '海'.repeat(300)])('keeps all oversized text for the explicit clipboard path', markdown => {
    const document = draft({ markdown, sourceUrl: undefined });
    const prepared = prepareEmailShare(document);
    expect(prepared.inlineUrl).toBeUndefined();
    expect(prepared.text).toBe(markdown);
    expect(prepared.subjectUrl.length).toBeLessThan(EMAIL_LINK_BUDGET);
    expect(new URL(prepared.subjectUrl).searchParams.get('body')).toBeNull();
  });
  it('handles a lone Unicode surrogate without losing the stored draft', () => {
    const document = draft({ markdown: 'Invalid character: \ud800', sourceUrl: undefined });
    expect(() => prepareEmailShare(document)).not.toThrow();
    expect(document.markdown).toContain('\ud800');
  });
  it('opens an inline draft without copying or marking the document exported', async () => {
    const document = draft();
    const before = structuredClone(document);
    const io = ports();
    const prepared = prepareEmailShare(document);
    await expect(shareEmail(prepared, 'inline', io)).resolves.toBe('requested');
    expect(io.open).toHaveBeenCalledWith(prepared.inlineUrl);
    expect(io.copy).not.toHaveBeenCalled();
    expect(document).toEqual(before);
  });
  it('copies the full document before requesting the subject-only draft', async () => {
    const order: string[] = [];
    const prepared = prepareEmailShare(draft({ markdown: 'Long note '.repeat(1_000) }));
    const io = ports();
    io.copy.mockImplementation(async text => { expect(text).toBe(prepared.text); order.push('copy'); });
    io.open.mockImplementation(async url => { expect(url).toBe(prepared.subjectUrl); order.push('open'); });
    await shareEmail(prepared, 'clipboard', io);
    expect(order).toEqual(['copy', 'open']);
  });
  it('does not open a misleading empty draft when copying fails', async () => {
    const io = ports();
    io.copy.mockRejectedValueOnce(new Error('Clipboard denied'));
    await expect(shareEmail(prepareEmailShare(draft()), 'clipboard', io)).rejects.toThrow('Clipboard denied');
    expect(io.open).not.toHaveBeenCalled();
  });
  it('cancels a delayed handoff after its document has been cleared or switched', async () => {
    let current = true;
    let completeCopy!: () => void;
    const io = { ...ports(), isCurrent: () => current };
    io.copy.mockReturnValue(new Promise<void>(resolve => { completeCopy = resolve; }));
    const pending = shareEmail(prepareEmailShare(draft()), 'clipboard', io);
    current = false;
    completeCopy();
    await expect(pending).resolves.toBe('cancelled');
    expect(io.open).not.toHaveBeenCalled();
  });
  it('reports an opener failure instead of claiming that an email was sent', async () => {
    const io = ports();
    io.open.mockRejectedValueOnce(new Error('Opening denied'));
    await expect(shareEmail(prepareEmailShare(draft()), 'inline', io)).rejects.toThrow('Opening denied');
  });
});
