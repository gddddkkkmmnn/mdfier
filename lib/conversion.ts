import TurndownService from 'turndown';
import { gfm } from 'turndown-plugin-gfm';
import type { CapturePayload, ConversionResult, Draft } from './types';

/** Warnings are stable codes; the UI supplies localized messages. */
export const COMPLEX_TABLE_WARNING = 'complex-table';

export function sanitizeFilename(name: string): string {
  let value = name.trim().replace(/(?:\.md)+$/i, '')
    .replace(/[<>:"/\\|?*\u0000-\u001f\u007f]/g, '-')
    .replace(/\s+/g, ' ').replace(/^[. ]+|[. ]+$/g, '');
  value = Array.from(value).slice(0, 80).join('').replace(/[. ]+$/g, '').replace(/(?:\.md)+$/i, '').replace(/[. ]+$/g, '');
  if (!value) return 'untitled';
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(value)) value = `_${value}`;
  return Array.from(value).slice(0, 80).join('');
}

function safeHref(href: string, base?: string): string | null {
  const trimmed = href.trim();
  // Control characters can conceal an active protocol from a naive prefix check.
  if (/[\u0000-\u0020\u007f]/.test(trimmed.replace(/ /g, ''))) return null;
  try {
    const url = new URL(trimmed, base || 'https://md-capture.invalid/');
    if (!['http:', 'https:', 'mailto:', 'tel:'].includes(url.protocol)) return null;
    return base ? url.href : trimmed;
  } catch { return null; }
}

/** A URL contributes only its final readable path segment, never its query, fragment, or full address. */
function filenameFromUrl(sourceUrl?: string): string {
  if (!sourceUrl) return '';
  try {
    const url = new URL(sourceUrl);
    const segments = url.pathname.split('/').filter(Boolean);
    let segment = segments.at(-1) || url.hostname;
    if (/^(?:index|home)(?:\.[a-z0-9]{1,8})?$/i.test(segment) && segments.length > 1) segment = segments.at(-2)!;
    try { segment = decodeURIComponent(segment); } catch { /* Keep malformed percent escapes readable. */ }
    return segment.replace(/\.[a-z0-9]{1,8}$/i, '').replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim();
  } catch { return ''; }
}

function cleanHtml(html: string, sourceUrl?: string): HTMLElement {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const root = doc.body;
  root.querySelectorAll('script,style,noscript,template,img,picture,svg,canvas,iframe,object,embed,video,audio,textarea,select,[data-md-capture]').forEach(el => el.remove());
  root.querySelectorAll('input').forEach(el => {
    // A checked list item is document structure, never a form value.
    if (el.type === 'checkbox' && el.closest('li')) {
      el.removeAttribute('value');
    } else el.remove();
  });
  root.querySelectorAll('[hidden],[aria-hidden="true"]').forEach(el => el.remove());
  root.querySelectorAll<HTMLElement>('[style]').forEach(el => {
    if (el.style.display === 'none' || ['hidden', 'collapse'].includes(el.style.visibility) || el.style.contentVisibility === 'hidden') el.remove();
  });
  root.querySelectorAll('details:not([open])').forEach(el => {
    const summary = Array.from(el.children).find(child => child.tagName === 'SUMMARY');
    el.replaceChildren(...(summary ? [summary] : []));
  });
  root.querySelectorAll('a').forEach(el => {
    const href = safeHref(el.getAttribute('href') || '', sourceUrl);
    if (href !== null && el.hasAttribute('href')) el.setAttribute('href', href);
    else el.removeAttribute('href');
  });
  root.querySelectorAll('*').forEach(el => {
    Array.from(el.attributes).forEach(attr => {
      if (!['href', 'title', 'class', 'colspan', 'rowspan', 'start', 'type', 'checked'].includes(attr.name)) el.removeAttribute(attr.name);
    });
  });
  return root;
}

/** `textContent` omits `<br>`; inside source code it is a real line break. */
function codeText(element: Element): string {
  let result = '';
  const walk = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) { result += node.textContent || ''; return; }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    if ((node as Element).tagName === 'BR') { result += '\n'; return; }
    for (const child of Array.from(node.childNodes)) walk(child);
  };
  for (const child of Array.from(element.childNodes)) walk(child);
  return result;
}

function createConverter(warnings: Set<string>): TurndownService {
  const service = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced', bulletListMarker: '-', emDelimiter: '*', strongDelimiter: '**' });
  service.use(gfm);
  service.addRule('taskCheckbox', {
    filter: node => node.nodeName === 'INPUT' && (node as HTMLInputElement).type === 'checkbox',
    replacement: (_content, node) => (node as HTMLInputElement).checked ? '[x] ' : '[ ] ',
  });
  service.addRule('highlightWrapper', {
    filter: node => node.nodeName === 'DIV' && /highlight-(?:text|source)-/.test((node as HTMLElement).className),
    replacement: content => content,
  });
  service.addRule('semanticField', {
    filter: node => node.nodeName === 'LI' && /(?:^|\s)mdfier-field(?:\s|$)/.test((node as HTMLElement).className),
    replacement: content => `\n- ${content.trim().replace(/\s+/g, ' ')}\n`,
  });
  service.addRule('strike', { filter: node => ['DEL', 'S', 'STRIKE'].includes(node.nodeName), replacement: content => `~~${content}~~` });
  service.addRule('literalCode', {
    filter: 'pre',
    replacement: (_content, node) => {
      const element = node as HTMLElement;
      const code = element.querySelector('code');
      const text = codeText(code || element);
      const cls = `${code?.className || ''} ${element.className} ${element.parentElement?.className || ''}`;
      const language = /(?:language|lang|highlight-source|highlight-text)-([\w+-]+)/.exec(cls)?.[1] || '';
      const runs = text.match(/`+/g) || [];
      const fence = '`'.repeat(Math.max(3, ...runs.map(run => run.length + 1)));
      return `\n\n${fence}${language}\n${text}${text.endsWith('\n') ? '' : '\n'}${fence}\n\n`;
    },
  });
  service.addRule('allTables', {
    filter: 'table',
    replacement: (_content, node) => {
      const table = node as HTMLTableElement;
      const rows = Array.from(table.rows);
      const complex = rows.some(row => Array.from(row.cells).some(cell => cell.colSpan > 1 || cell.rowSpan > 1)) || Boolean(table.querySelector('table'));
      const values = rows.map(row => Array.from(row.cells).map(cell => service.turndown(cell.innerHTML).replace(/\n+/g, ' ').replace(/\|/g, '\\|')));
      const caption = table.caption ? service.turndown(table.caption.innerHTML) : '';
      if (!values.length) return caption ? `\n\n${caption}\n\n` : '';
      if (complex) {
        warnings.add(COMPLEX_TABLE_WARNING);
        return `\n\n${caption ? `${caption}\n\n` : ''}${values.map(row => row.join(' | ')).join('\n\n')}\n\n`;
      }
      const width = Math.max(...values.map(row => row.length));
      const line = (row: string[]) => `| ${Array.from({ length: width }, (_, i) => row[i] || '').join(' | ')} |`;
      return `\n\n${caption ? `${caption}\n\n` : ''}${line(values[0]!)}\n${line(Array(width).fill('---'))}\n${values.slice(1).map(line).join('\n')}\n\n`;
    },
  });
  return service;
}

export function convertCapture(payload: CapturePayload): ConversionResult {
  const warnings = new Set<string>(payload.warnings ?? []);
  let markdown: string;
  let heading = '';
  if (payload.html?.trim()) {
    const root = cleanHtml(payload.html, payload.sourceUrl);
    heading = root.querySelector('h1,h2,h3,h4,h5,h6')?.textContent?.trim() || '';
    markdown = createConverter(warnings).turndown(root);
  } else markdown = payload.text ?? '';
  const firstLine = markdown.split(/\r?\n/).find(line => line.trim())?.replace(/^#{1,6}\s+/, '').trim();
  const urlFallback = payload.kind === 'paste' ? '' : filenameFromUrl(payload.sourceUrl);
  const name = payload.kind === 'page'
    ? payload.title || heading || urlFallback || firstLine
    : heading || firstLine || payload.title || urlFallback;
  return { markdown, filename: sanitizeFilename(name || 'untitled'), warnings: [...warnings] };
}

/** The canonical string used by preview, clipboard and downloads. */
export function renderExport(draft: Draft): string {
  if (!draft.sourceUrl) return draft.markdown;
  const source = safeHref(draft.sourceUrl);
  if (!source) return draft.markdown;
  const date = new Date(draft.capturedAt);
  const stamp = Number.isNaN(date.getTime()) ? '' : `\nCaptured: ${date.toISOString()}`;
  return `${draft.markdown.replace(/\s+$/, '')}\n\n---\n\nSource: <${source.replace(/</g, '%3C').replace(/>/g, '%3E')}>${stamp}\n`;
}
