import { convertCapture } from './conversion';
import type { CapturePayload, Draft, Settings } from './types';

/** Converts one capture into a replacement draft, or leaves the current one untouched by returning undefined. */
export function createImportedDraft(payload: CapturePayload, _settings: Settings): Draft | undefined {
  const result = convertCapture(payload);
  if (!result.markdown.trim()) return undefined;
  return {
    id: crypto.randomUUID(),
    markdown: result.markdown,
    filename: result.filename,
    sourceUrl: payload.sourceUrl,
    capturedAt: payload.capturedAt,
    revision: 0,
    exportedRevision: null,
    warnings: result.warnings,
    extraction: payload.extraction,
  };
}
