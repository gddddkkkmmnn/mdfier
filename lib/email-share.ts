import { renderExport, sanitizeFilename } from './conversion';
import type { Draft } from './types';

// A conservative interoperability budget, not a universal browser limit.
// Longer documents use an explicit clipboard handoff and are never truncated.
export const EMAIL_LINK_BUDGET = 1800;

export interface EmailShare {
  text: string;
  subjectUrl: string;
  inlineUrl?: string;
}

export function prepareEmailShare(draft: Draft): EmailShare {
  const subject = sanitizeFilename(draft.filename).toWellFormed();
  const text = renderExport(draft);
  const subjectUrl = `mailto:?subject=${encodeURIComponent(subject)}`;
  // Do not percent-encode megabytes of text just to decide it is too long.
  if (text.length > EMAIL_LINK_BUDGET - subjectUrl.length - 6) return { text, subjectUrl };
  const body = text.toWellFormed().replace(/\r\n|\r|\n/g, '\r\n');
  const inlineUrl = `${subjectUrl}&body=${encodeURIComponent(body)}`;
  return { text, subjectUrl, inlineUrl: inlineUrl.length <= EMAIL_LINK_BUDGET ? inlineUrl : undefined };
}

export interface EmailSharePorts {
  copy(text: string): Promise<void>;
  open(url: string): Promise<unknown>;
  isCurrent(): boolean;
}

/** Request a compose window only. Never choose a recipient, send, or mark the draft exported. */
export async function shareEmail(share: EmailShare, mode: 'inline' | 'clipboard', ports: EmailSharePorts): Promise<'requested' | 'cancelled'> {
  if (!ports.isCurrent()) return 'cancelled';
  if (mode === 'clipboard') await ports.copy(share.text);
  if (!ports.isCurrent()) return 'cancelled';
  const url = mode === 'clipboard' ? share.subjectUrl : share.inlineUrl;
  if (!url) throw new Error('email-body-too-long');
  await ports.open(url);
  return 'requested';
}
