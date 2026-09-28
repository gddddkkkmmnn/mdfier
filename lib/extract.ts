import type { CapturePayload } from './types';
import { extractSemanticPage, extractSemanticPageAsync, extractSemanticPageAsyncTimed, type SemanticPage, type SemanticTiming } from './semantic';
import { accountCaptureNode, CAPTURE_LIMITS, CaptureLimitError, type CaptureBudget } from './capture-limits';

const excluded = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'IMG', 'PICTURE', 'SVG', 'CANVAS', 'IFRAME', 'OBJECT', 'EMBED', 'VIDEO', 'AUDIO', 'INPUT', 'TEXTAREA', 'SELECT', 'OPTION']);
const attributes = ['open', 'href', 'title', 'colspan', 'rowspan', 'start', 'reversed', 'value', 'class'];

function hidden(element: Element, cache: WeakMap<Element, boolean>): boolean {
  if (cache.has(element)) return cache.get(element)!;
  if (element.hasAttribute('hidden') || element.hasAttribute('data-md-capture-ui')) return true;
  const style = element.ownerDocument.defaultView?.getComputedStyle(element);
  const value = !!style && (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse' || style.opacity === '0' || style.contentVisibility === 'hidden');
  cache.set(element, value);
  return value;
}

function eligible(element: Element, cache: WeakMap<Element, boolean>): boolean {
  if (excluded.has(element.tagName)) return false;
  for (let current: Element | null = element; current; current = current.parentElement) {
    if (hidden(current, cache)) return false;
    if (current.parentElement?.tagName === 'DETAILS' && !current.parentElement.hasAttribute('open')) {
      const summary: Element | undefined = Array.from(current.parentElement.children).find(child => child.tagName === 'SUMMARY');
      if (current !== summary) return false;
    }
  }
  return true;
}

/** Clone only loaded, visible light DOM. Never serializes form values or event handlers. */
export function cloneVisible(node: Node, range?: Range, visibility = new WeakMap<Element, boolean>(), budget: CaptureBudget = { nodes: 0, textCharacters: 0 }, depth = 0): Node | null {
  if (range && !range.intersectsNode(node)) return null;
  accountCaptureNode(budget, node, depth, attributes);
  const doc = node.ownerDocument!;
  if (node.nodeType === 3) {
    if (node.parentElement && !eligible(node.parentElement, visibility)) return null;
    // Direct text under a closed details is not rendered.
    if (node.parentElement?.tagName === 'DETAILS' && !node.parentElement.hasAttribute('open')) return null;
    let value = node.textContent ?? '';
    const start = range?.startContainer === node ? range.startOffset : 0;
    const end = range?.endContainer === node ? range.endOffset : value.length;
    value = value.slice(start, end);
    return doc.createTextNode(value);
  }
  if (node.nodeType !== 1) return null;
  const element = node as Element;
  // Preserve static checkbox semantics for GFM task lists without reading live input values.
  if (element.tagName === 'INPUT' && element.getAttribute('type') === 'checkbox') {
    if (hidden(element, visibility) || !element.closest('li') || !eligible(element.parentElement!, visibility)) return null;
    const checkbox = doc.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.disabled = true;
    if (element.hasAttribute('checked')) checkbox.setAttribute('checked', '');
    return checkbox;
  }
  if (!eligible(element, visibility)) return null;
  const copy = doc.createElement(element.tagName.toLowerCase());
  for (const attr of attributes) {
    if (element.hasAttribute(attr) && (attr !== 'value' || element.tagName === 'LI')) copy.setAttribute(attr, element.getAttribute(attr)!);
  }
  // Resolve against the actual document base, including <base href>.
  if (element.tagName === 'A' && element.hasAttribute('href')) {
    try { copy.setAttribute('href', new URL(element.getAttribute('href')!, doc.baseURI).href); } catch { copy.removeAttribute('href'); }
  }
  for (const child of Array.from(element.childNodes)) {
    const clone = cloneVisible(child, range, visibility, budget, depth + 1);
    if (clone) copy.appendChild(clone);
  }
  return copy;
}

function pagePayload(doc: Document, page: SemanticPage): CapturePayload {
  if (!page.text.trim()) throw new Error('empty-capture');
  return { kind: 'page', html: page.html, text: page.text, sourceUrl: doc.location.href,
    title: doc.title, capturedAt: new Date().toISOString(), warnings: page.warnings,
    extraction: { mode: 'semantic-page', fallback: page.fallback } };
}

export async function extractPageCapture(doc: Document): Promise<CapturePayload> {
  const url = doc.location.href;
  const page = await extractSemanticPageAsync(doc);
  if (doc.location.href !== url) throw new Error('page-changed');
  return pagePayload(doc, page);
}

/** Offline benchmark hook; production capture uses `extractPageCapture`. */
export async function extractPageCaptureTimed(doc: Document): Promise<{ payload: CapturePayload; timing: SemanticTiming }> {
  const url = doc.location.href;
  const { page, timing } = await extractSemanticPageAsyncTimed(doc);
  if (doc.location.href !== url) throw new Error('page-changed');
  return { payload: pagePayload(doc, page), timing };
}

export function extractCapture(doc: Document, kind: 'page' | 'element' | 'selection', element?: Element): CapturePayload {
  if (kind === 'page') return pagePayload(doc, extractSemanticPage(doc));
  const sourceLength = doc.location.href.length;
  if (sourceLength > CAPTURE_LIMITS.textCharacters) throw new CaptureLimitError();
  const holder = doc.createElement('div');
  const warnings = new Set<string>();
  const scope = kind === 'element' ? element! : doc.getSelection()?.anchorNode?.parentElement ?? doc.body;
  const visibility = new WeakMap<Element, boolean>();
  const scanBudget: CaptureBudget = { nodes: 0, textCharacters: sourceLength };
  const inspect = (candidate: Element) => {
    accountCaptureNode(scanBudget, candidate, 0, []);
    if ((candidate.shadowRoot || ['IFRAME','OBJECT','EMBED'].includes(candidate.tagName)) && !hidden(candidate, visibility) && (!candidate.parentElement || eligible(candidate.parentElement, visibility))) warnings.add('unsupported-content');
  };
  inspect(scope);
  const walker = doc.createTreeWalker(scope, 1);
  let candidate: Node | null;
  while ((candidate = walker.nextNode())) inspect(candidate as Element);
  if (kind === 'selection') {
    const selection = doc.getSelection();
    if (!selection || selection.isCollapsed || !selection.rangeCount) throw new Error('empty-selection');
    const budget: CaptureBudget = { nodes: 0, textCharacters: sourceLength };
    for (let i = 0; i < selection.rangeCount; i++) {
      const range = selection.getRangeAt(i);
      if (range.collapsed) continue;
      const ancestor = range.commonAncestorContainer;
      const root = ancestor.nodeType === 1 ? ancestor : ancestor.parentElement;
      if (root) {
        const cloned = cloneVisible(root, range, visibility, budget);
        if (cloned) holder.appendChild(cloned);
      }
    }
  } else if (kind === 'element') {
    const cloned = cloneVisible(element!, undefined, visibility, { nodes: 0, textCharacters: sourceLength });
    if (cloned) holder.appendChild(cloned);
  }
  const text = holder.textContent ?? '';
  if (!text.trim()) throw new Error('empty-capture');
  const heading = holder.querySelector('h1,h2,h3,h4,h5,h6')?.textContent?.trim();
  return {
    kind,
    html: holder.innerHTML,
    text,
    sourceUrl: doc.location.href,
    title: heading || undefined,
    capturedAt: new Date().toISOString(),
    warnings: [...warnings],
    extraction: kind === 'element' ? { mode: 'exact-block' } : { mode: 'selection' },
  };
}
