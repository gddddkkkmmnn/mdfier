import { CAPTURE_PROTOCOL_VERSION } from '../lib/types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { extractCapture, extractPageCapture } from '../lib/extract';
import { convertCapture } from '../lib/conversion';
import { extractReadability, READABILITY_MAX_NODES } from '../lib/readability';
import { extractSemanticPage } from '../lib/semantic';
import captureContent from '../entrypoints/capture.content';

const { JSDOM } = createRequire(join(process.cwd(), 'package.json'))('jsdom');

const runtime = vi.hoisted(() => ({ addListener: vi.fn(), removeListener: vi.fn(), sendMessage: vi.fn().mockResolvedValue(undefined) }));
vi.mock('wxt/browser', () => ({ browser: { runtime: { onMessage: { addListener: runtime.addListener, removeListener: runtime.removeListener }, sendMessage: runtime.sendMessage } } }));

beforeEach(() => { document.head.innerHTML = ''; document.body.innerHTML = ''; document.getSelection()?.removeAllRanges(); });

describe('visible DOM capture', () => {
  it('keeps below-viewport text and code, but removes navigation and hidden or active content', () => {
    document.body.innerHTML = '<nav>Menu</nav><p style="position:absolute;top:10000px">Loaded below screen</p><pre><code class="language-ts">  const x = 1;\n</code></pre><div hidden>hidden</div><div style="display:none">invisible</div><script>SECRET</script><img alt="not imported"><iframe srcdoc="SECRET"></iframe>';
    const result = extractCapture(document, 'page');
    expect(result.text).not.toContain('Menu'); expect(result.text).toContain('Loaded below screen');
    expect(result.html).toContain('  const x = 1;\n'); expect(result.html).toContain('language-ts');
    expect(result.html).not.toMatch(/hidden|invisible|SECRET|<img|<iframe/);
  });
  it('omits form values, closed details contents and shadow trees', () => {
    document.body.innerHTML = '<p>Public</p><input value="password"><textarea>secret</textarea><select><option>private</option></select><details><summary>Summary</summary>closed text<p>Closed body</p></details><div id="host"></div>';
    document.querySelector('#host')!.attachShadow({ mode: 'open' }).innerHTML = '<p>Shadow secret</p>';
    const result = extractCapture(document, 'page');
    expect(result.text).toContain('Summary'); expect(result.text).not.toMatch(/password|secret|private|closed text|Closed body|Shadow/);
  });
  it('refuses pages and blocks whose nesting exceeds the safe capture depth', () => {
    const root = document.createElement('article');
    document.body.append(root);
    let current: Element = root;
    for (let index = 0; index < 140; index++) {
      const child = document.createElement('div');
      current.append(child);
      current = child;
    }
    current.textContent = 'Useful content';
    expect(() => extractCapture(document, 'page')).toThrow('capture-too-large');
    expect(() => extractCapture(document, 'element', root)).toThrow('capture-too-large');
  });
  it('refuses a single oversized text node without returning a partial document', () => {
    document.body.append(document.createTextNode('x'.repeat(2_000_001)));
    expect(() => extractCapture(document, 'page')).toThrow('capture-too-large');
  });
  it('bounds a very wide page without allocating a full descendant list', () => {
    document.body.innerHTML = '<article>' + '<i></i>'.repeat(10_001) + '</article>';
    expect(() => extractCapture(document, 'page')).toThrow('capture-too-large');
    expect(() => extractCapture(document, 'element', document.querySelector('article')!)).toThrow('capture-too-large');
  });
  it('preserves selection formatting and only selected text', () => {
    document.body.innerHTML = '<p>Before <strong>Hello World</strong> after</p><p>Unselected</p>';
    const text = document.querySelector('strong')!.firstChild!;
    const range = document.createRange(); range.setStart(text, 0); range.setEnd(text, 5);
    document.getSelection()!.addRange(range);
    const result = extractCapture(document, 'selection');
    expect(result.html).toBe('<strong>Hello</strong>'); expect(result.text).toBe('Hello'); expect(result.extraction).toEqual({ mode: 'selection' });
  });
  it('omits CSS-hidden text within selections and retains partially selected wrappers', () => {
    document.body.innerHTML = '<p>Hello <span style="visibility:hidden">secret</span><em>world</em> suffix</p>';
    const p = document.querySelector('p')!;
    const range = document.createRange(); range.setStart(p.firstChild!, 3); range.setEnd(p.lastChild!, 3);
    document.getSelection()!.addRange(range);
    const result = extractCapture(document, 'selection');
    expect(result.html).toBe('<p>lo <em>world</em> su</p>');
  });
  it('resolves links against base URL and excludes event handlers', () => {
    document.head.innerHTML = '<base href="https://example.org/docs/">';
    document.body.innerHTML = '<a href="guide" onclick="alert(1)">Guide</a>';
    expect(extractCapture(document, 'page').html).toContain('href="https://example.org/docs/guide"');
    expect(extractCapture(document, 'page').html).not.toContain('onclick');
  });
  it('rejects empty capture and collapsed selection', () => {
    document.body.innerHTML = '<img alt="picture">';
    expect(() => extractCapture(document, 'page')).toThrow('empty-capture');
    expect(() => extractCapture(document, 'selection')).toThrow('empty-selection');
  });
  it('uses the selected block heading and ignores extension overlays', () => {
    document.body.innerHTML = '<h1>Outside</h1><article><h2>Inside</h2><p>Text</p></article><div data-md-capture-ui>Overlay</div>';
    const result = extractCapture(document, 'element', document.querySelector('article')!);
    expect(result.title).toBe('Inside'); expect(result.text).not.toContain('Outside');
    expect(extractCapture(document, 'page').text).not.toContain('Overlay');
  });
  it('keeps short ambiguous content while excluding actual account controls', () => {
    document.body.innerHTML = `<main><h1>Study update</h1>
      <section class="user-profile"><h2>Participant</h2><p>CRITICAL: Consent withdrawn.</p></section>
      <section class="comments"><h2>Comments</h2><p>CRITICAL: Preserve this note.</p></section>
      <section class="related"><h2>Related safety</h2><p>Keep this linked warning.</p></section>
      <div class="account-panel"><a href="/settings">Account settings</a><button>Sign out</button></div></main>`;
    const result = extractCapture(document, 'page');
    expect(result.text).toContain('Participant');
    expect(result.text).toContain('CRITICAL: Consent withdrawn');
    expect(result.text).toContain('Preserve this note');
    expect(result.text).toContain('Keep this linked warning');
    expect(result.text).not.toContain('Account settings');
  });
  it('removes an ambiguous block only when it contains controls', () => {
    document.body.innerHTML = '<main><h1>Report</h1><section class="comments"><p>Sign in to reply.</p><button>Reply</button></section><p>Keep this report.</p></main>';
    const result = extractCapture(document, 'page');
    expect(result.text).toContain('Keep this report');
    expect(result.text).not.toContain('Sign in to reply');
  });
});

describe('Readability adapter', () => {
  it('extracts only a detached, article-sized safe snapshot and returns metadata', () => {
    const snapshot = document.createElement('div');
    snapshot.innerHTML = `<article><h1>Detached report</h1><p>${'The article keeps each useful sentence in a local document. '.repeat(5)}</p><h2>Evidence</h2><p>${'A second section makes the article long enough for a meaningful candidate. '.repeat(4)}</p></article>`;
    const candidate = extractReadability(snapshot, 'https://example.test/report', { title: 'Fallback title', lang: 'uk' });
    expect(candidate).toEqual(expect.objectContaining({ title: 'Fallback title', lang: 'uk' }));
    expect(candidate?.text).toContain('second section');
    expect(snapshot.querySelector('h1')?.textContent).toBe('Detached report');
  });
  it('declines an oversized snapshot before the synchronous parser starts', () => {
    const snapshot = document.createElement('div');
    snapshot.innerHTML = '<article><h1>Too large</h1>' + '<span>x</span>'.repeat(READABILITY_MAX_NODES + 1) + '</article>';
    expect(extractReadability(snapshot, 'https://example.test/large')).toBeNull();
  });
  it('uses the adapter only for a complete, connected article', () => {
    document.title = 'A page title that is not the article heading';
    document.body.innerHTML = `<main><article><h1>Local field report</h1><p>${'The first visible paragraph is retained in the export. '.repeat(5)}</p><h2>Measurements</h2><p>${'The second visible paragraph is retained too. '.repeat(5)}</p><p>${'A concluding paragraph gives Readability enough meaningful material. '.repeat(4)}</p></article></main>`;
    const page = extractSemanticPage(document);
    expect(page.strategy).toBe('readability');
    expect(page.text).toContain('concluding paragraph');
    expect(page.html).not.toContain('A page title that is not the article heading');
    expect(page.html.match(/Local field report/g)).toHaveLength(1);
  });
  it.each(['article-sibling-main', 'article-sibling-bare'])('keeps an adjacent content section in both landmark layouts: %s', name => {
    document.body.innerHTML = fixture(name, 'html');
    const page = extractSemanticPage(document);
    expect(page.text).toContain('Safety limits');
    expect(page.text).toContain('CRITICAL: Stop immediately at 200 metres visibility');
  });
  it('falls back when Readability drops a contentful sibling from a main landmark', () => {
    document.body.innerHTML = fixture('article-sibling-main', 'html');
    expect(extractSemanticPage(document).strategy).toBe('semantic');
  });
  it.each([0, 1, 2])('checks useful branches outside an article through %i wrapper(s)', wrappers => {
    const article = `<article><h1>Route report</h1><p>${'The team records each observation before moving through exposed terrain. '.repeat(4)}</p><h2>Observations</h2><p>${'Every decision is documented so a later team can follow the safe route. '.repeat(4)}</p></article>`;
    document.body.innerHTML = `<main>${'<div class="article-wrapper">'.repeat(wrappers)}${article}${'</div>'.repeat(wrappers)}<section><h2>Safety limits</h2><p>CRITICAL: Stop immediately at 200 metres visibility.</p></section><p>Top-level field note remains part of the page.</p><ul><li>Top-level safety checklist remains part of the page.</li></ul></main>`;
    const page = extractSemanticPage(document);
    expect(page.strategy).toBe('semantic');
    expect(page.text).toContain('CRITICAL: Stop immediately at 200 metres visibility');
    expect(page.text).toContain('Top-level field note remains part of the page');
    expect(page.text).toContain('Top-level safety checklist remains part of the page');
  });
});

describe('element picker', () => {
  beforeEach(() => {
    delete (window as Window & { __mdCaptureInstalled?: boolean }).__mdCaptureInstalled;
    const state = window as Window & { __mdfierCaptureRuntime?: { dispose(): void } };
    state.__mdfierCaptureRuntime?.dispose();
    delete state.__mdfierCaptureRuntime;
    runtime.addListener.mockClear(); runtime.removeListener.mockClear(); runtime.sendMessage.mockClear();
    captureContent.main({} as never);
    clickListenerSpy = vi.spyOn(document, 'addEventListener');
  });
  afterEach(() => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); clickListenerSpy.mockRestore(); });
  let pickId = 0;
  let clickListenerSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => { pickId = 0; });
  const pick = () => runtime.addListener.mock.calls[0]![0]({ type: 'pick', language: 'en', pickId: `pick-${++pickId}` });
  const trustedClick = (element: Element) => {
    const listener = (clickListenerSpy.mock.calls as unknown as Array<[string, EventListener]>).find(([type]) => type === 'click')?.[1];
    if (!listener) throw new Error('Picker click listener was not registered.');
    let defaultPrevented = false;
    const event = {
      isTrusted: true,
      target: element,
      preventDefault: () => { defaultPrevented = true; },
      stopPropagation: vi.fn(),
      stopImmediatePropagation: vi.fn(),
    } as unknown as MouseEvent;
    listener.call(document, event);
    return { defaultPrevented, event };
  };

  it('replaces the previous listener when reinjected', () => {
    captureContent.main({} as never);
    expect(runtime.addListener).toHaveBeenCalledTimes(2);
    expect(runtime.removeListener).toHaveBeenCalledTimes(1);
  });
  it('reports the current capture protocol', async () => {
    await expect(runtime.addListener.mock.calls[0]![0]({ type: 'capture-ping' })).resolves.toEqual({ protocol: CAPTURE_PROTOCOL_VERSION });
  });
  it('captures the picked block and suppresses link activation', async () => {
    document.body.innerHTML = '<article><h2>Heading</h2><a href="https://example.org">Link</a></article>';
    const link = document.querySelector('a')!;
    const activated = vi.fn(); link.addEventListener('click', activated);
    await pick();
    link.dispatchEvent(new MouseEvent('mousemove', { bubbles: true }));
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
    const click = trustedClick(link);
    expect(activated).not.toHaveBeenCalled(); expect(click.defaultPrevented).toBe(true); expect(click.event.stopImmediatePropagation).toHaveBeenCalledOnce();
    expect(runtime.sendMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'capture-result', pickId: 'pick-1', payload: expect.objectContaining({ kind: 'element', title: 'Heading' }) }));
    expect(document.querySelector('[data-md-capture-ui]')).toBeNull();
  });
  it('returns to the prior block and cancels without leaving event interception', async () => {
    document.body.innerHTML = '<article><a href="#">Link</a></article>';
    const link = document.querySelector('a')!;
    await pick();
    link.dispatchEvent(new MouseEvent('mousemove', { bubbles: true }));
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    trustedClick(link);
    expect(runtime.sendMessage).toHaveBeenCalledWith(expect.objectContaining({ pickId: 'pick-1', payload: expect.objectContaining({ html: expect.stringMatching(/^<a /) }) }));
    await pick();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    const activated = vi.fn(); link.addEventListener('click', activated);
    link.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    expect(activated).toHaveBeenCalledOnce();
    expect(runtime.sendMessage).toHaveBeenCalledWith({ type: 'pick-cancelled', pickId: 'pick-2' });
    expect(document.querySelector('[data-md-capture-ui]')).toBeNull();
  });
  it('ignores page-script synthetic clicks and leaves the picker active', async () => {
    document.body.innerHTML = '<article><p>Page-owned content</p></article>';
    const article = document.querySelector('article')!;
    await pick();
    article.dispatchEvent(new MouseEvent('mousemove', { bubbles: true }));
    const click = new MouseEvent('click', { bubbles: true, cancelable: true });
    article.dispatchEvent(click);
    expect(click.defaultPrevented).toBe(false);
    expect(runtime.sendMessage).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'capture-result' }));
    expect(document.querySelector('[data-md-capture-ui]')).not.toBeNull();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  });
});

describe('capture completeness', () => {
 it('keeps open details open across the extraction/conversion boundary', () => {
  document.body.innerHTML = '<details open><summary>Expanded</summary><p>Included body</p></details>';
  const result = extractCapture(document, 'page');
  expect(result.html).toContain('open=""');
  expect(result.html).toContain('Included body');
 });
 it('warns when visible web-component content cannot be captured', () => {
  document.body.innerHTML = '<h1>Docs</h1><mdn-code-example></mdn-code-example>';
  document.querySelector('mdn-code-example')!.attachShadow({mode:'open'}).innerHTML = '<pre>Uncaptured code</pre>';
  const result = extractCapture(document, 'page');
  expect(result.warnings).toEqual(['unsupported-content']);
  expect(result.html).not.toContain('Uncaptured code');
 });
});

const fixture = (name: string, extension: 'html' | 'md') => readFileSync(join(process.cwd(), 'tests', 'fixtures', 'semantic', `${name}.${extension}`), 'utf8').trim();
const captureFixture = (name: string) => {
  document.head.innerHTML = '<base href="https://example.test/">';
  document.body.innerHTML = fixture(name, 'html');
  document.title = name;
  return extractCapture(document, 'page');
};

describe('semantic Page capture', () => {
  it('reads live styles at most once per element and retains every loaded feed item', () => {
    const style = vi.spyOn(window, 'getComputedStyle');
    try {
      for (const count of [100, 200]) {
        style.mockClear();
        document.body.innerHTML = '<div>' + Array.from({ length: count }, (_, i) => `<article><div><div><div><h2>Item ${i}</h2><p>All loaded text ${i}.</p></div></div></div></article>`).join('') + '</div>';
        const result = extractCapture(document, 'page');
        expect(style.mock.calls.length).toBeLessThanOrEqual(document.body.querySelectorAll('*').length + 2);
        expect(new Set(style.mock.calls.map(call => call[0])).size).toBe(style.mock.calls.length);
        for (let i = 0; i < count; i++) expect(result.text).toContain(`All loaded text ${i}.`);
      }
    } finally { style.mockRestore(); }
  });

  it('yields to browser tasks while capturing and returns the same document', async () => {
    const isolated = new JSDOM('<main><h1>Capture</h1>' + '<p>Keep every paragraph.</p>'.repeat(40) + '</main>', { url: 'https://example.test/' });
    const doc = isolated.window.document;
    const expected = extractCapture(doc, 'page');
    let ticked = false;
    let now = 0;
    const clock = vi.spyOn(performance, 'now').mockImplementation(() => now += 2);
    try {
      setTimeout(() => { ticked = true; }, 0);
      const captured = await extractPageCapture(doc);
      expect(ticked).toBe(true);
      expect(captured.html).toBe(expected.html);
      expect(captured.extraction).toEqual(expected.extraction);
    } finally { clock.mockRestore(); isolated.window.close(); }
  });

  it('removes edit controls but retains citations and explanatory links', () => {
    document.body.innerHTML = '<main><h1>Article</h1><h2>History</h2><a href="/w/index.php?action=edit">edit</a><p>Fact <a href="#cite_note-1">[1]</a>. <a href="/editing">Editing as a profession</a></p><a href="/map"> </a><ol><li>Source, retrieved today.</li></ol></main>';
    const markdown = convertCapture(extractCapture(document, 'page')).markdown;
    expect(markdown).not.toContain('[edit]');
    expect(markdown).not.toMatch(/\[\s*\]\(/);
    expect(markdown).toContain('cite_note-1');
    expect(markdown).toContain('Editing as a profession');
    expect(markdown).toContain('Source, retrieved today.');
  });

  it('retains the whole heterogeneous feed instead of its longest review', () => {
    document.body.innerHTML = `<nav>Login</nav><div class="feed"><h1>Community</h1>
      <div class="guide"><h2>Achievement guide</h2><div>All twenty achievements and the final secret.</div></div>
      <article><h2>A long review</h2>${'<p>A long account of the adventure and its many details.</p>'.repeat(110)}</article>
      <div class="workshop"><a href="/maps/new">New map</a><div>Explore the newly loaded island.</div></div></div>`;
    const markdown = convertCapture(extractCapture(document, 'page')).markdown;
    expect(markdown).toContain('Achievement guide');
    expect(markdown).toContain('final secret');
    expect(markdown).toContain('newly loaded island');
    expect(markdown).not.toContain('Login');
  });

  it('does not reinterpret encyclopedia sections or references as catalog cards', () => {
    document.body.innerHTML = `<main><h1>Encyclopedia</h1>
      <section><h2>History</h2><a href="/edit/1">Edit</a><p>History with <a href="/citation">a citation</a>.</p><ul><li>A historical event</li></ul></section>
      <section><h2>Structure</h2><a href="/edit/2">Edit</a><table><tr><th>Unit</th><th>Role</th></tr><tr><td>Research</td><td>Analysis</td></tr></table></section>
      <section><h2>References</h2><ol><li><a href="/source">Original source</a><span class="date">Retrieved 25 September</span></li></ol></section></main>`;
    const markdown = convertCapture(extractCapture(document, 'page')).markdown;
    expect(markdown).toContain('## History');
    expect(markdown).toContain('[a citation]');
    expect(markdown).toContain('A historical event');
    expect(markdown).toContain('| Research | Analysis |');
    expect(markdown).toContain('[Original source]');
    expect(markdown).not.toContain('**Release:**');
    expect(markdown).not.toContain('### [History]');
  });

  it('preserves unrecognized card text and distinct reviews sharing a destination', () => {
    document.body.innerHTML = `<main><h1>Reviews</h1>${['First review with valuable details', 'Second review with different observations'].map(text => `<div class="review-card"><h2><a href="/same-game">Game</a></h2><div class="review-body">${text}</div><ul><li>Keep this point</li></ul></div>`).join('')}</main>`;
    const markdown = convertCapture(extractCapture(document, 'page')).markdown;
    expect(markdown).toContain('First review with valuable details');
    expect(markdown).toContain('Second review with different observations');
    expect(markdown.match(/Keep this point/g)).toHaveLength(2);
  });

  it('does not turn a page title into a successful empty import', () => {
    document.title = 'Community';
    document.body.innerHTML = '<nav>Only navigation</nav>';
    expect(() => extractCapture(document, 'page')).toThrow('empty-capture');
  });

  it('preserves literal whitespace in code including dash-prefixed lines', () => {
    document.body.innerHTML = '<main><h1>Code</h1><pre><code>-    preserve these spaces\n-\n\nend</code></pre></main>';
    expect(convertCapture(extractCapture(document, 'page')).markdown).toContain('-    preserve these spaces\n-\n\nend');
  });
  it('keeps article structure while removing global chrome, calls to action, comments, and related links', () => {
    const result = captureFixture('article');
    const markdown = convertCapture(result).markdown.trim();
    expect(markdown).toBe(fixture('article', 'md'));
    expect(result.extraction).toEqual({ mode: 'semantic-page', fallback: false });
    expect(markdown).not.toMatch(/Example Magazine|Subscribe|Comments|Related story|Copyright/);
  });

  it('keeps documentation headings, code, notes, tables, and reference links', () => {
    const markdown = convertCapture(captureFixture('docs')).markdown;
    expect(markdown).toContain('# Request options');
    expect(markdown).toContain('```ts\nconst reply = await request({ retries: 2 });');
    expect(markdown).toContain('| Name | Meaning |');
    expect(markdown).toContain('[error reference](https://example.test/reference/errors)');
    expect(markdown).not.toMatch(/Introduction|Privacy/);
  });

  it('turns card collections into named structured sections and preserves intentional cross-section repeats', () => {
    const markdown = convertCapture(captureFixture('catalog')).markdown.trim();
    expect(markdown).toBe(fixture('catalog', 'md'));
    expect(markdown.match(/Citadel Rush/g)).toHaveLength(2);
    expect(markdown).toContain('### [iron garden](https://example.test/games/iron-garden)');
    expect(markdown).toContain('- **Developer:** Lumen Works');
    expect(markdown).not.toMatch(/Filter|Sort|Sign in/);
  });

  it('handles a sanitized Steam-shaped catalog through generic card rules only', () => {
    const markdown = convertCapture(captureFixture('steam-shaped')).markdown;
    expect(markdown).toContain('## Featured games');
    expect(markdown).toContain('### [Kingdom Come: Deliverance](https://example.test/app/100/kingdom-come-deliverance)');
    expect(markdown).toContain('- **Developer:** Warhorse Studios');
    expect(markdown).toContain('### [no visible title](https://example.test/app/400/no-visible-title)');
    expect(markdown).not.toMatch(/Community|Login|Ukrainian|Add to cart|Sort/);
  });

  it('uses a conservative fallback and preserves content when no confident main scope exists', () => {
    document.body.innerHTML = '<div><p>This is a small but still useful page with enough text to preserve without pretending we know its layout.</p></div>';
    document.title = 'Small page';
    const result = extractCapture(document, 'page');
    expect(result.extraction).toEqual({ mode: 'semantic-page', fallback: true });
    expect(result.text).toContain('small but still useful page');
  });

  it('keeps a picked block exact instead of applying page extraction', () => {
    document.body.innerHTML = '<main><article><h1>Document</h1><p>Body</p><div class="filters">Filter label</div></article></main>';
    const result = extractCapture(document, 'element', document.querySelector('article')!);
    expect(result.extraction).toEqual({ mode: 'exact-block' });
    expect(result.text).toContain('Filter label');
  });
});


describe('page-wide layout classes', () => {
  it('keeps article content with a sidebar state on body in sync and async Page capture', async () => {
    const dom = new JSDOM(readFileSync(join(process.cwd(), 'tests/fixtures/semantic/body-sidebar-state.html'), 'utf8'), { url: 'https://example.test/report' });
    try {
      for (const payload of [extractCapture(dom.window.document, 'page'), await extractPageCapture(dom.window.document)]) {
        const markdown = convertCapture(payload).markdown;
        expect(markdown).toContain('# Field report');
        expect(markdown).toContain('First observation: the entire article remains readable.');
        expect(markdown).toContain('## Measurements');
        expect(markdown).toContain('[research notes](https://example.test/research)');
        expect(markdown).toContain('Final observation: the team returned safely.');
        expect(markdown).not.toMatch(/Global navigation|Share controls|Sidebar promotions|PRIVATE-VALUE|Hidden content|Footer navigation/);
      }
      const block = extractCapture(dom.window.document, 'element', dom.window.document.querySelector('.single-page__content'));
      expect(block.text).toContain('Final observation');
    } finally { dom.window.close(); }
  });
  it('does not bypass visibility checks on the body', () => {
    const dom = new JSDOM('<body class="sidebar-show" hidden><p>Hidden report</p></body>');
    try { expect(() => extractCapture(dom.window.document, 'page')).toThrow('empty-capture'); }
    finally { dom.window.close(); }
  });
});


describe('lightweight structured content', () => {
  it('recovers standalone and sibling card labels without losing metadata or citations', () => {
    document.body.innerHTML = `<main><h1>Equipment</h1><section><h2>Featured</h2><article class="card"><a href="/coat"><img alt="Rain coat"></a><p>Waterproof fabric.</p><dl><dt>Price</dt><dd>2400</dd></dl><a href="/coat">Read more</a></article></section><section><h2>All</h2><article class="card"><a href="/coat"><img alt="Rain coat"></a><p>Waterproof fabric.</p><dl><dt>Weight</dt><dd>200 g</dd></dl></article><article class="card"><a href="/trail-lantern"><img alt=""></a><p>Long battery life. <a href="/manual">Safety manual</a></p><dl><dt>Runtime</dt><dd>36 hours</dd></dl></article></section></main>`;
    const md = convertCapture(extractCapture(document, 'page')).markdown;
    expect(md.match(/### \[Rain coat\]/g)).toHaveLength(2);
    expect(md).toContain('### [trail lantern]');
    expect(md).toContain('**Price:** 2400');
    expect(md).toContain('**Weight:** 200 g');
    expect(md).toContain('**Runtime:** 36 hours');
    expect(md).toContain('[Safety manual]');
    expect(md).not.toContain('Read more');
    expect(md).not.toContain('![');
  });
  it('keeps multi-paragraph definitions and inline formatting', () => {
    document.body.innerHTML = '<main><h1>Glossary</h1><dl><dt>Range</dt><dd><em>15 km</em></dd><dt>Notes</dt><dd><p>First explanation.</p><p>Second explanation with <a href="/reference">reference</a>.</p></dd></dl></main>';
    const md = convertCapture(extractCapture(document, 'page')).markdown;
    expect(md).toContain('**Range:** *15 km*');
    expect(md).toContain('First explanation.');
    expect(md).toContain('Second explanation with [reference]');
  });
});


it('does not invent nested card headings for BEM card internals', () => {
  document.body.innerHTML = '<main><h1>News</h1><article class="article-card"><div class="article-card__image"><a href="/news/story"><img alt="Story title"></a></div><div class="article-card__body"><a href="/category/news">News category</a><a href="/news/story">Story title</a><p>Full description.</p></div></article></main>';
  const md = convertCapture(extractCapture(document, 'page')).markdown;
  expect((md.match(/^### /gm) || []).length).toBe(1);
  expect(md).toContain('Full description.');
  expect(md).toContain('[News category]');
});
