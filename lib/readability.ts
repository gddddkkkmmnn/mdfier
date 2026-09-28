import Readability from './vendor/mozilla-readability.js';

/**
 * A small, browser-independent boundary around Mozilla Readability.  Callers
 * supply an already-safe detached tree: the adapter never reads a live page,
 * fetches resources, or adds removed DOM back to its input.
 */
export interface ReadabilityCandidate {
  html: string;
  text: string;
  title?: string;
  lang?: string;
}

export const READABILITY_MAX_NODES = 1_800;
export const READABILITY_MIN_TEXT = 140;

function normalized(value: string | null | undefined): string {
  return (value || '').replace(/\s+/g, ' ').trim();
}

export function extractReadability(snapshot: HTMLElement, url: string, metadata?: { title?: string; lang?: string }): ReadabilityCandidate | null {
  // Readability mutates its document.  This is the only full-tree copy used
  // for its route; the conservative route continues to use `snapshot`.
  if (snapshot.querySelectorAll('*').length > READABILITY_MAX_NODES) return null;
  const source = snapshot.ownerDocument;
  const detached = source.implementation.createHTMLDocument(metadata?.title || '');
  if (metadata?.lang) detached.documentElement.lang = metadata.lang;
  // Links in the snapshot were already resolved by the visible-DOM collector.
  // A base keeps relative links safe should a test create a detached snapshot.
  const base = detached.createElement('base');
  base.href = url;
  detached.head.append(base);
  detached.body.append(snapshot.cloneNode(true));

  try {
    const article = new Readability(detached, {
      charThreshold: READABILITY_MIN_TEXT,
      maxElemsToParse: READABILITY_MAX_NODES,
      keepClasses: false,
    }).parse();
    const text = normalized(article?.textContent);
    if (!article || text.length < READABILITY_MIN_TEXT || !article.content.trim()) return null;
    return {
      html: article.content,
      text,
      title: normalized(article.title) || undefined,
      lang: normalized(article.lang) || metadata?.lang,
    };
  } catch {
    // The caller keeps the complete conservative snapshot on every refusal.
    return null;
  }
}
