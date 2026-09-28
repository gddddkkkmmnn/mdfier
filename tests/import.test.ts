import { afterEach, describe, expect, it, vi } from 'vitest';
import { createImportedDraft } from '../lib/import-capture';
import type { CapturePayload, Settings } from '../lib/types';

const settings: Settings = { language: 'en' };
const payload = (overrides: Partial<CapturePayload> = {}): CapturePayload => ({
  kind: 'paste', text: 'Imported notes', sourceUrl: 'https://example.com/notes', capturedAt: '2026-09-24T10:00:00Z', ...overrides,
});

afterEach(() => vi.restoreAllMocks());

describe('successful capture replacement drafts', () => {
  it('does not create a replacement for empty content', () => {
    expect(createImportedDraft(payload({ text: ' \n\t' }), settings)).toBeUndefined();
  });

  it('creates a fresh, unexported draft only for nonempty imported content', () => {
    vi.spyOn(crypto, 'randomUUID').mockReturnValue('00000000-0000-4000-8000-000000000001');
    const draft = createImportedDraft(payload({ text: '# New notes', extraction: { mode: 'paste' } }), settings);
    expect(draft).toEqual({
      id: '00000000-0000-4000-8000-000000000001', markdown: '# New notes', filename: 'New notes',
      sourceUrl: 'https://example.com/notes', capturedAt: '2026-09-24T10:00:00Z',
      revision: 0, exportedRevision: null, warnings: [], extraction: { mode: 'paste' },
    });
  });
});
