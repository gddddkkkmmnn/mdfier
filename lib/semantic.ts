/** Local, deterministic page-to-content extraction. It intentionally has no site adapters. */
import { extractReadability, type ReadabilityCandidate } from './readability';
import { accountCaptureNode, CAPTURE_LIMITS, CaptureLimitError, type CaptureBudget } from './capture-limits';
const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'IMG', 'PICTURE', 'SVG', 'CANVAS', 'IFRAME', 'OBJECT', 'EMBED', 'VIDEO', 'AUDIO', 'INPUT', 'TEXTAREA', 'SELECT', 'OPTION', 'BUTTON']);
const CHROME_TAGS = new Set(['NAV', 'ASIDE', 'FOOTER', 'FORM']);
const CHROME_ROLES = new Set(['navigation', 'banner', 'contentinfo', 'complementary', 'search', 'dialog', 'alertdialog', 'menu', 'menubar', 'toolbar']);
const NOISE_HINT = /(?:\b(?:nav|menu|sidebar|filters?|facet|toolbar|pagination|pager|cookie|consent|banner|advert|promo|account|cart|login|sign[ -]?in|share|wishlist|sort|control|modal|dialog|toast|newsletter)\b)/i;
const AMBIGUOUS_HINT = /(?:\b(?:comments?|related|profile)\b)/i;
const METADATA_HINTS: Array<[RegExp, string]> = [
  [/discount|sale/i, 'Discount'], [/price|cost/i, 'Price'], [/release|date|launch/i, 'Release'],
  [/developer/i, 'Developer'], [/publisher/i, 'Publisher'], [/tag|genre/i, 'Tags'], [/status/i, 'Status'],
];

export interface SemanticPage { html: string; text: string; fallback: boolean; warnings: string[]; strategy?: 'readability' | 'semantic'; }
export interface SemanticTiming { snapshotMs: number; normalizationMs: number; }

function words(value: string) { return value.replace(/\s+/g, ' ').trim(); }
function hint(element: Element) { return `${element.id} ${element.className} ${element.getAttribute('role') || ''}`; }
// All normalization below works on a detached, already sanitized snapshot.
function chrome(element: Element) {
  // Body classes describe site-wide layout/state, not the role of all content.
  // Still inspect each descendant, and apply visibility checks to body normally.
  if (element.tagName === 'BODY') return false;
  if (SKIP_TAGS.has(element.tagName) || CHROME_TAGS.has(element.tagName)) return true;
  if (element.tagName === 'HEADER' && !element.closest('main,article,[role=main]')) return true;
  if (CHROME_ROLES.has((element.getAttribute('role') || '').toLowerCase()) || NOISE_HINT.test(hint(element))) return true;
  // "profile", "comments" and "related" describe content just as often as
  // controls.  A class name or short copy is never enough to remove them:
  // require an actual control before treating an ambiguous block as chrome.
  return AMBIGUOUS_HINT.test(hint(element)) && hasControl(element);
}
function readableText(element: Element): string {
  const parts: string[] = [];
  const walker = element.ownerDocument.createTreeWalker(element, 4);
  let node: Node | null;
  while ((node = walker.nextNode())) parts.push(node.textContent || '');
  return words(parts.join(' '));
}

interface Snapshot {
  root: HTMLElement;
  sizes: WeakMap<Element, number>;
  warnings: string[];
}

/**
 * Cheap routing only.  Catalogs, feeds and documentation never enter the
 * synchronous Readability pass: their repeated objects and dense structures
 * are better represented by the conservative normalizer below.
 */
function articleRoute(root: HTMLElement): Element | null {
  const articles = root.querySelectorAll('article');
  if (articles.length !== 1) return null;
  const article = articles[0]!;
  if (!article.querySelector('h1') || article.querySelectorAll('p').length < 2) return null;
  if (article.querySelector('pre,table,dl') || root.querySelectorAll('[role=listitem], [class*="card" i], [class*="product" i], [class*="result" i]').length > 1) return null;
  if (root.querySelectorAll('li').length > 12 || root.querySelectorAll('article').length > 1) return null;
  return article;
}

function candidateKeepsArticle(candidate: ReadabilityCandidate, article: Element, captured: Snapshot): boolean {
  const sourceText = readableText(article);
  // A candidate that removes a material part of an isolated article is not
  // "cleaner" for mdfier.  The threshold is deliberately conservative; title
  // and small structural whitespace account for the permitted difference.
  if (candidate.text.length < Math.max(READABILITY_MINIMUM_CONTENT, sourceText.length * 0.72)) return false;
  // Paragraphs are visible, authored material.  Readability's tendency to
  // discard a header/byline block is useful for reader mode but not for an
  // export tool, so retain the conservative path if even one disappears.
  const paragraphs = Array.from(article.querySelectorAll('p')).map(paragraph => words(paragraph.textContent || '')).filter(Boolean);
  if (paragraphs.some(paragraph => !candidate.text.includes(paragraph))) return false;
  const headings = Array.from(article.querySelectorAll('h2,h3')).map(heading => words(heading.textContent || '')).filter(Boolean);
  if (headings.some(heading => !candidate.text.includes(heading))) return false;
  // Readability frequently takes the article and drops another branch in the
  // selected area. Walk outward through any wrappers once, collecting the
  // maximal contentful branches that do not contain the article. This covers
  // direct siblings, a sibling of an article wrapper, and top-level prose or
  // lists without turning the decision into a page-wide scoring pass.
  if (outsideArticleSegments(captured.root, article).some(segment => !candidateKeepsSegment(candidate, segment))) return false;
  const total = captured.sizes.get(captured.root) || 0;
  return sourceText.length >= total * 0.55;
}

function hasControl(element: Element): boolean {
  if (element.querySelector('button,input,textarea,select,[role=button],[role=search]')) return true;
  return Array.from(element.querySelectorAll('a')).some(link => /^(?:sign[ -]?in|log[ -]?in|reply|subscribe|show more|load more)$/i.test(words(link.textContent || '')));
}

function usefulOutsideSegment(element: Element): boolean {
  const text = readableText(element);
  if (!text) return false;
  if (['SECTION', 'ARTICLE', 'P', 'PRE', 'TABLE', 'UL', 'OL', 'DL', 'BLOCKQUOTE'].includes(element.tagName)) return true;
  return element.tagName === 'DIV' && Boolean(element.querySelector('h1,h2,h3,p,pre,table,ul,ol,dl,blockquote'));
}

function outsideArticleSegments(root: HTMLElement, article: Element): Element[] {
  const segments: Element[] = [];
  const visit = (element: Element) => {
    if (element === article) return;
    if (element.contains(article)) {
      for (const child of Array.from(element.children)) visit(child);
      return;
    }
    if (usefulOutsideSegment(element)) { segments.push(element); return; }
    for (const child of Array.from(element.children)) visit(child);
  };
  for (const child of Array.from(root.children)) visit(child);
  return segments;
}

function candidateKeepsSegment(candidate: ReadabilityCandidate, segment: Element): boolean {
  const text = readableText(segment);
  if (!candidate.text.includes(text)) return false;
  const headings = Array.from(segment.querySelectorAll('h1,h2,h3')).map(heading => words(heading.textContent || '')).filter(Boolean);
  if (!headings.every(heading => candidate.text.includes(heading))) return false;
  const structuredTags = ['pre', 'table', 'ul', 'ol', 'dl'].filter(tag => segment.querySelector(tag));
  return structuredTags.every(tag => candidate.html.includes(`<${tag}`));
}

const READABILITY_MINIMUM_CONTENT = 140;

/** One live-DOM pass. Each retained element's computed style is read once.
 * Yield points let the content script give the browser time to paint/respond.
 * The synchronous entry point uses this same generator for fixtures.
 */
function* snapshot(doc: Document): Generator<void, Snapshot> {
  const root = doc.createElement('div');
  const sizes = new WeakMap<Element, number>();
  const warnings = new Set<string>();
  const budget: CaptureBudget = { nodes: 0, textCharacters: doc.title.length + doc.location.href.length };
  if (budget.textCharacters > CAPTURE_LIMITS.textCharacters) throw new CaptureLimitError();
  type Frame = { target: HTMLElement; nextChild: Node | null; onlyChild?: Node | null; size: number };
  const rootVisible = [doc.documentElement, doc.body].every(element => {
    if (element.hasAttribute('hidden') || element.hasAttribute('data-md-capture-ui')) return false;
    const style = doc.defaultView?.getComputedStyle(element);
    return !style || (style.display !== 'none' && !['hidden', 'collapse'].includes(style.visibility) && style.opacity !== '0' && style.contentVisibility !== 'hidden');
  });
  const stack: Frame[] = [{ target: root, nextChild: rootVisible ? doc.body.firstChild : null, size: 0 }];
  while (stack.length) {
    const frame = stack[stack.length - 1]!;
    if (!frame.nextChild) {
      stack.pop();
      sizes.set(frame.target, frame.size);
      if (stack.length) stack[stack.length - 1]!.size += frame.size;
      continue;
    }
    yield;
    const node = frame.nextChild;
    frame.nextChild = frame.onlyChild ? null : node.nextSibling;
    const depth = stack.length;
    if (node.nodeType === 3) {
      if (node.parentElement?.tagName === 'DETAILS' && !node.parentElement.hasAttribute('open')) continue;
      accountCaptureNode(budget, node, depth, []);
      frame.target.appendChild(doc.createTextNode(node.textContent || ''));
      frame.size += words(node.textContent || '').length;
      continue;
    }
    if (node.nodeType !== 1) continue;
    const source = node as Element;
    const embedded = Boolean(source.shadowRoot) || ['IFRAME', 'OBJECT', 'EMBED'].includes(source.tagName);
    const imageLabel = source.tagName === 'IMG';
    const task = source.tagName === 'INPUT' && source.getAttribute('type') === 'checkbox' && Boolean(source.closest('li'));
    if ((!embedded && !imageLabel && !task && chrome(source)) || source.hasAttribute('hidden') || source.hasAttribute('data-md-capture-ui')) continue;
    accountCaptureNode(budget, source, depth, ['open', 'title', 'colspan', 'rowspan', 'start', 'reversed', 'class', 'type', 'checked', 'href', 'alt']);
    const style = doc.defaultView?.getComputedStyle(source);
    if (style && (style.display === 'none' || ['hidden', 'collapse'].includes(style.visibility) || style.opacity === '0' || style.contentVisibility === 'hidden')) continue;
    if (embedded) warnings.add('unsupported-content');
    if (['IFRAME', 'OBJECT', 'EMBED'].includes(source.tagName)) continue;
    if (source.tagName === 'A' && /^(?:edit|редагувати|редактировать)$/i.test(words(source.textContent || ''))) {
      try { if (new URL(source.getAttribute('href') || '', doc.baseURI).searchParams.get('action') === 'edit') continue; } catch { /* Keep ambiguous links. */ }
    }
    const copy = doc.createElement(source.tagName.toLowerCase());
    copyAttributes(source, copy, doc);
    // Preserve structural evidence only until normalization; no data/config attributes.
    if (source.getAttribute('role') === 'main') copy.setAttribute('role', 'main');
    if (source.getAttribute('role') === 'listitem') copy.setAttribute('role', 'listitem');
    if (imageLabel) { copy.setAttribute('alt', source.getAttribute('alt') || ''); frame.target.appendChild(copy); continue; }
    if (task) { copy.setAttribute('type', 'checkbox'); if (source.hasAttribute('checked')) copy.setAttribute('checked', ''); frame.target.appendChild(copy); continue; }
    frame.target.appendChild(copy);
    const summary = source.tagName === 'DETAILS' && !source.hasAttribute('open') ? source.querySelector(':scope > summary') : null;
    stack.push({ target: copy, nextChild: summary ?? source.firstChild, onlyChild: summary ?? undefined, size: 0 });
  }
  return { root, sizes, warnings: [...warnings] };
}

function chooseScope({ root, sizes }: Snapshot) {
  const total = sizes.get(root) || 0;
  // No scoring every div or trying to infer intent from prose. Use a single
  // landmark only if it covers the cleaned page; otherwise preserve the body.
  for (const selector of ['main,[role=main]', 'article']) {
    const candidates = root.querySelectorAll(selector);
    if (candidates.length !== 1) continue;
    const element = candidates[0]!;
    if ((sizes.get(element) || 0) >= total - 40) return { element, fallback: false };
  }
  return { element: root, fallback: true };
}
function copyAttributes(from: Element, to: Element, doc: Document) {
  for (const name of ['open', 'title', 'colspan', 'rowspan', 'start', 'reversed', 'class', 'type', 'checked']) {
    if (from.hasAttribute(name)) to.setAttribute(name, from.getAttribute(name)!);
  }
  if (from.tagName === 'A' && from.hasAttribute('href')) {
    try {
      const url = new URL(from.getAttribute('href')!, doc.baseURI);
      if (['http:', 'https:', 'mailto:', 'tel:'].includes(url.protocol)) to.setAttribute('href', url.href);
    } catch { /* Link text remains useful without a destination. */ }
  }
}
function primaryLink(card: Element, doc: Document) {
  for (const link of Array.from(card.querySelectorAll('a[href]'))) {
    try {
      const url = new URL(link.getAttribute('href')!, doc.baseURI);
      if (['http:', 'https:'].includes(url.protocol)) return url.href;
    } catch { /* Continue to the next link. */ }
  }
  return undefined;
}
function slug(url?: string) {
  if (!url) return '';
  try {
    const segment = new URL(url).pathname.split('/').filter(Boolean).at(-1) || '';
    return decodeURIComponent(segment).replace(/[-_]+/g, ' ').replace(/\.[a-z0-9]{1,8}$/i, '').trim();
  } catch { return ''; }
}
function cardTitle(card: Element, doc: Document, url?: string) {
  const heading = card.querySelector('h1,h2,h3,h4,h5,h6');
  if (words(heading?.textContent || '')) return words(heading!.textContent || '');
  for (const link of Array.from(card.querySelectorAll('a'))) {
    if (url && link.getAttribute('href') !== url) continue;
    const label = words(link.textContent || '');
    if (label && !/^(?:read more|learn more|details|view|докладніше|детальніше|подробнее)$/i.test(label)) return label;
  }
  const alt = Array.from(card.querySelectorAll('img[alt]')).map(image => words(image.getAttribute('alt') || '')).find(Boolean);
  return alt || slug(url);
}
function isCard(element: Element, doc: Document) {
  // Cheap structural gate FIRST. Never recursively classify all descendants.
  if (!['DIV', 'ARTICLE'].includes(element.tagName)) return false;
  const marked = /(?:^|[\s_-])(?:card|capsule|product|result|tile)(?:$|[\s_-])/i.test(hint(element)) || /(?:Card|Capsule|Tile)$/.test(element.className) || element.getAttribute('role') === 'listitem';
  if (!marked) return false;
  // Large/mixed objects keep their original structure instead of another analysis.
  const walker = doc.createTreeWalker(element, 1);
  let count = 0;
  let descendant: Node | null;
  while ((descendant = walker.nextNode())) {
    if (++count > 60 || ['PRE', 'TABLE', 'BLOCKQUOTE', 'OL', 'UL', 'ARTICLE'].includes((descendant as Element).tagName)) return false;
  }
  return Boolean(primaryLink(element, doc));
}
function metadata(card: Element) {
  const fields: Array<{ label: string; value: string }> = [];
  for (const element of Array.from(card.querySelectorAll('p,span,div'))) {
    if (element.children.length > 2) continue;
    const value = words(element.textContent || '');
    if (!value || value.length > 180) continue;
    const explicit = /^([^:]{1,32}):\s*(.+)$/.exec(value);
    if (explicit) fields.push({ label: explicit[1]!.trim(), value: explicit[2]!.trim() });
    else {
      const match = METADATA_HINTS.find(([pattern]) => pattern.test(hint(element)));
      if (match) fields.push({ label: match[1], value });
    }
  }
  return fields.filter((field, index, values) => values.findIndex(other => other.label === field.label && other.value === field.value) === index);
}
function appendCard(holder: HTMLElement, card: Element, doc: Document) {
  const url = primaryLink(card, doc);
  const title = cardTitle(card, doc, url);
  if (!title) return false;
  const heading = doc.createElement('h3');
  if (url) { const link = doc.createElement('a'); link.href = url; link.textContent = title; heading.appendChild(link); }
  else heading.textContent = title;
  holder.appendChild(heading);
  const fields = metadata(card);
  const descriptions = Array.from(card.querySelectorAll('p')).map(node => words(node.textContent || '')).filter(value => value && value !== title && !fields.some(field => `${field.label}: ${field.value}` === value));
  if (descriptions.length) { const paragraph = doc.createElement('p'); paragraph.textContent = descriptions.filter((value, index, values) => values.indexOf(value) === index).join(' '); holder.appendChild(paragraph); }
  if (fields.length) {
    const list = doc.createElement('ul');
    for (const field of fields) { const item = doc.createElement('li'); item.className = 'mdfier-field'; const strong = doc.createElement('strong'); strong.textContent = `${field.label}:`; item.append(strong, ` ${field.value}`); list.appendChild(item); }
    holder.appendChild(list);
  }
  return true;
}
/** Preserve unknown card content; only recover a missing object label. */
function cloneCard(card: Element, doc: Document): Node | null {
  const copy = cloneNormalized(card, doc, false) as HTMLElement | null;
  if (!copy || card.querySelector('h1,h2,h3,h4,h5,h6')) return copy;
  const url = primaryLink(card, doc);
  const title = cardTitle(card, doc, url);
  if (title) {
    const heading = doc.createElement('h3');
    const label = doc.createElement(url ? 'a' : 'span');
    if (url) label.setAttribute('href', url);
    label.textContent = title;
    heading.append(label); copy.prepend(heading);
    // Drop only redundant control links to the recovered title destination.
    for (const link of Array.from(copy.querySelectorAll('a[href]'))) {
      if (link !== label && link.getAttribute('href') === url && /^(?:read more|learn more|details|view|докладніше|детальніше|подробнее)$/i.test(words(link.textContent || ''))) link.remove();
    }
  }
  return copy;
}

function cloneNormalized(source: Node, doc: Document, normalizeCards = true): Node | null {
  if (source.nodeType === Node.TEXT_NODE) {
    const parent = source.parentElement;
    if (parent?.tagName === 'DETAILS' && !parent.hasAttribute('open')) return null;
    return doc.createTextNode(source.textContent || '');
  }
  if (source.nodeType !== Node.ELEMENT_NODE) return null;
  const element = source as Element;
  if (SKIP_TAGS.has(element.tagName) && !(element.tagName === 'INPUT' && element.getAttribute('type') === 'checkbox')) return null;
  // Definition lists explicitly associate terms with values. Keep all children,
  // including multi-paragraph definitions, without guessing from prose.
  if (element.tagName === 'DL') {
    const list = doc.createElement('ul');
    let item: HTMLElement | undefined;
    for (const child of Array.from(element.childNodes)) {
      if (child.nodeType === Node.TEXT_NODE && !words(child.textContent || '')) continue;
      if ((child as Element).tagName === 'DT') {
        item = doc.createElement('li'); list.append(item);
        const term = doc.createElement('strong'); appendChildren(child as Element, term, doc, normalizeCards);
        term.append(':'); item.append(term);
      } else if ((child as Element).tagName === 'DD') {
        if (!item) { item = doc.createElement('li'); list.append(item); }
        const value = doc.createElement((child as Element).querySelector('p,div,pre,table,ul,ol,blockquote,dl') ? 'div' : 'span'); appendChildren(child as Element, value, doc, normalizeCards);
        item.append(' ', value);
      } else {
        const other = cloneNormalized(child, doc, normalizeCards);
        if (other) { const extra = doc.createElement('li'); extra.append(other); list.append(extra); }
      }
    }
    return list;
  }
  const copy = doc.createElement(element.tagName.toLowerCase());
  copyAttributes(element, copy, doc);
  appendChildren(element, copy, doc, normalizeCards);
  if (copy.tagName === 'A' && !words(copy.textContent || '')) return null;
  return copy;
}
/**
 * Recurses through ordinary document structure, but converts only adjacent
 * sibling cards. This keeps cards under a section/container discoverable while
 * keeping headings and their visual order intact.
 */
function appendChildren(source: Element, target: HTMLElement, doc: Document, normalizeCards = true) {
  const nodes = Array.from(source.childNodes);
  for (let index = 0; index < nodes.length;) {
    const node = nodes[index]!;
    if (node.nodeType !== Node.ELEMENT_NODE) {
      const copy = cloneNormalized(node, doc, normalizeCards);
      if (copy) target.appendChild(copy);
      index++;
      continue;
    }
    const child = node as Element;
    if (SKIP_TAGS.has(child.tagName) && !(child.tagName === 'INPUT' && child.getAttribute('type') === 'checkbox')) { index++; continue; }
    if (!normalizeCards || !isCard(child, doc)) {
      const copy = cloneNormalized(child, doc, normalizeCards);
      if (copy) target.appendChild(copy);
      index++;
      continue;
    }
    const run: Element[] = [];
    let cursor = index;
    while (cursor < nodes.length) {
      const candidate = nodes[cursor]!;
      if (candidate.nodeType === Node.TEXT_NODE && !words(candidate.textContent || '')) { cursor++; continue; }
      if (candidate.nodeType !== Node.ELEMENT_NODE || !isCard(candidate as Element, doc)) break;
      run.push(candidate as Element);
      cursor++;
    }
    if (run.length < 2) {
      const copy = cloneCard(run[0]!, doc);
      if (copy) target.appendChild(copy);
      index = cursor;
      continue;
    }
    const seen = new Set<string>();
    for (const card of run) {
      // Same destination does not mean same content (reviews often link to
      // the same game). Collapse only genuinely identical text and link.
      const key = `${primaryLink(card, doc)}\n${cardTitle(card, doc, primaryLink(card, doc))}\n${readableText(card)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const normalized = doc.createElement('div');
      appendCard(normalized, card, doc);
      const tokens = (text: string) => text.match(/[\p{L}\p{N}]+/gu) || [];
      const available = new Map<string, number>();
      for (const token of tokens(readableText(normalized))) available.set(token, (available.get(token) || 0) + 1);
      const complete = tokens(readableText(card)).every(token => {
        const count = available.get(token) || 0;
        available.set(token, count - 1);
        return count > 0;
      });
      // Unknown div-based descriptions, lists, citations or other content
      // must survive even when the card schema cannot represent them.
      if (complete && !card.querySelector('pre,table,blockquote,ol,ul,dl') && Array.from(card.querySelectorAll('a[href]')).every(link => link.getAttribute('href') === primaryLink(card, doc))) target.append(...Array.from(normalized.childNodes));
      else {
        const copy = cloneCard(card, doc);
        if (copy) target.appendChild(copy);
      }
    }
    index = cursor;
  }
}

function finishSnapshot(doc: Document, captured: Snapshot): SemanticPage {
  const route = articleRoute(captured.root);
  const candidate = route ? extractReadability(captured.root, doc.location.href, { title: doc.title, lang: doc.documentElement.lang }) : null;
  const useReadability = Boolean(route && candidate && candidateKeepsArticle(candidate, route, captured));
  const { element, fallback } = chooseScope(captured);
  const holder = doc.createElement('div');
  if (useReadability && candidate) {
    const parsed = doc.implementation.createHTMLDocument('mdfier-readability-result');
    parsed.body.innerHTML = candidate.html;
    appendChildren(parsed.body, holder, doc, false);
    const sourceTitle = words(route?.querySelector('h1')?.textContent || '');
    const candidateTitle = sourceTitle || candidate.title || doc.title.trim();
    const hasEquivalentHeading = Array.from(holder.querySelectorAll('h1,h2,h3,h4,h5,h6'))
      .some(heading => words(heading.textContent || '').toLocaleLowerCase() === candidateTitle.toLocaleLowerCase());
    if (words(holder.textContent || '') && !holder.querySelector('h1') && !hasEquivalentHeading && candidateTitle) {
      const heading = doc.createElement('h1'); heading.textContent = candidateTitle; holder.prepend(heading);
    }
  } else {
    appendChildren(element, holder, doc);
    if (words(holder.textContent || '') && !holder.querySelector('h1') && doc.title.trim()) {
      const heading = doc.createElement('h1'); heading.textContent = doc.title.trim(); holder.prepend(heading);
    }
  }
  return { html: holder.innerHTML, text: words(holder.textContent || ''), fallback: useReadability ? false : fallback, warnings: captured.warnings, strategy: useReadability ? 'readability' : 'semantic' };
}

export function extractSemanticPage(doc: Document): SemanticPage {
  const work = snapshot(doc);
  let step = work.next();
  while (!step.done) step = work.next();
  return finishSnapshot(doc, step.value);
}

export async function extractSemanticPageAsyncTimed(doc: Document): Promise<{ page: SemanticPage; timing: SemanticTiming }> {
  const started = performance.now();
  const work = snapshot(doc);
  let step = work.next();
  let deadline = performance.now() + 8;
  while (!step.done) {
    if (performance.now() >= deadline) {
      await new Promise<void>(resolve => setTimeout(resolve, 0));
      deadline = performance.now() + 8;
    }
    step = work.next();
  }
  const snapshotMs = performance.now() - started;
  const page = finishSnapshot(doc, step.value);
  return { page, timing: { snapshotMs, normalizationMs: performance.now() - started - snapshotMs } };
}

export async function extractSemanticPageAsync(doc: Document): Promise<SemanticPage> {
  return (await extractSemanticPageAsyncTimed(doc)).page;
}
