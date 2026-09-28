import type { Draft } from './types';

/** Exact export snapshot identity, independent of mutable revision bookkeeping. */
export function exportIdentity(draft: Draft): string {
  return JSON.stringify({
    filename: draft.filename,
    markdown: draft.markdown,
    sourceUrl: draft.sourceUrl ?? null,
    capturedAt: draft.capturedAt,
  });
}
