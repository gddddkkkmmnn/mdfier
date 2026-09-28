export type CaptureKind = 'paste' | 'page' | 'element' | 'selection';
export type ExtractionMode = 'semantic-page' | 'exact-block' | 'selection' | 'paste';
export interface ExtractionInfo { mode: ExtractionMode; fallback?: boolean; }
export interface CapturePayload { kind: CaptureKind; html?: string; text?: string; sourceUrl?: string; title?: string; capturedAt: string; warnings?: string[]; extraction?: ExtractionInfo; }
export interface ConversionResult { markdown: string; filename: string; warnings: string[]; }
export interface Draft { id: string; markdown: string; filename: string; sourceUrl?: string; capturedAt: string; revision: number; exportedRevision: number | null; warnings: string[]; extraction?: ExtractionInfo; }
export interface Settings { language: 'en' | 'uk'; }
// Page routing changed in 0.4.0; reinjection replaces stale handlers in tabs
// that predate the local Readability adapter.
export const CAPTURE_PROTOCOL_VERSION = 8;
export type CaptureCommand = { type: 'capture-ping' } | { type: 'capture'; kind: 'page' | 'selection' } | { type: 'pick'; language: 'en' | 'uk'; pickId: string } | { type: 'cancel-pick'; pickId: string };
export type CaptureReply = { protocol: number } | { payload: CapturePayload } | { error: string } | { picking: true };
