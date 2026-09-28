import { describe, expect, it } from 'vitest';
import { COMPLEX_TABLE_WARNING, convertCapture, renderExport, sanitizeFilename } from '../lib/conversion';
import { renderPreview } from '../lib/preview';
import type { CapturePayload, Draft } from '../lib/types';

const capture = (html: string, overrides: Partial<CapturePayload> = {}) => convertCapture({ kind: 'page', html, title: 'Example', sourceUrl: 'https://example.com/docs/start', capturedAt: '2026-09-24T12:00:00Z', ...overrides });
const draft: Draft = { id: '1', markdown: '# Привіт\n\n  text\n', filename: 'hello', sourceUrl: 'https://example.com/', capturedAt: '2026-09-24T12:00:00Z', revision: 1, exportedRevision: null, warnings: [] };

describe('HTML conversion', () => {
  it('keeps document structure, nested lists and absolute links', () => {
    const { markdown } = capture('<h1>Title</h1><p><strong>Bold</strong> and <em>soft</em> <a href="../guide?q=1">Guide</a></p><blockquote>Quote</blockquote><ul><li>One<ul><li>Nested</li></ul></li></ul>');
    expect(markdown).toContain('# Title');
    expect(markdown).toContain('**Bold**');
    expect(markdown).toContain('*soft*');
    expect(markdown).toContain('[Guide](https://example.com/guide?q=1)');
    expect(markdown).toContain('> Quote');
    expect(markdown).toMatch(/-\s+One\n\s+-\s+Nested/);
  });
  it('preserves code whitespace and chooses a fence longer than content backticks', () => {
    const { markdown } = capture('<div class="highlight-source-js"><pre><code class="language-js">  const x = `a`;\n\n```\n    return x;\n</code></pre></div>');
    expect(markdown).toBe('````js\n  const x = `a`;\n\n```\n    return x;\n````');
  });
  it('treats breaks inside source code as literal newlines without changing spacing', () => {
    const { markdown } = capture('<pre><code class="language-python">if ready:<br>    first()<br><br>    second()</code></pre>');
    expect(markdown).toBe('```python\nif ready:\n    first()\n\n    second()\n```');
  });
  it('recognizes source-language code wrappers', () => {
    expect(capture('<div class="highlight-source-python"><pre>  pass</pre></div>').markdown).toBe('```python\n  pass\n```');
  });
  it('removes graphics while retaining independent captions and visible document text', () => {
    const { markdown } = capture('<figure><img src="a.png" alt="not imported"><figcaption>Caption</figcaption></figure><svg><text>vector</text></svg><p>Visible</p><p hidden>Hidden</p><p style="display:none">Hidden2</p><details><summary>Summary</summary>Closed</details><input value="secret"><textarea>private</textarea><select><option>private2</option></select>');
    expect(markdown).toContain('Caption');
    expect(markdown).toContain('Visible');
    expect(markdown).toContain('Summary');
    expect(markdown).not.toMatch(/imported|vector|Hidden|Closed|secret|private|!\[/);
  });
  it('preserves task lists and GFM strike', () => {
    const { markdown } = capture('<ul><li><input type="checkbox" checked value="secret">Done</li><li><label><input type="checkbox">Todo</label></li></ul><del>Removed</del>');
    expect(markdown).toMatch(/-\s+\[x\] Done/);
    expect(markdown).toMatch(/-\s+\[ \] Todo/);
    expect(markdown).toContain('~~Removed~~');
    expect(markdown).not.toContain('secret');
  });
  it('writes GFM tables including tables without th cells', () => {
    const { markdown, warnings } = capture('<table><caption>People</caption><tr><td>Name</td><td>Role</td></tr><tr><td>A | B</td><td><strong>Dev</strong></td></tr></table>');
    expect(markdown).toContain('| Name | Role |\n| --- | --- |\n| A \\| B | **Dev** |');
    expect(markdown).toContain('People');
    expect(warnings).toEqual([]);
  });
  it('flattens merged tables without losing text and warns once', () => {
    const { markdown, warnings } = capture('<table><tr><td colspan="2">Merged</td></tr><tr><td>A</td><td>B</td></tr></table>');
    expect(markdown).toContain('Merged');
    expect(markdown).toContain('A | B');
    expect(warnings).toEqual([COMPLEX_TABLE_WARNING]);
    expect(markdown).not.toContain('<table');
  });
  it('preserves unsafe-link labels but removes dangerous destinations', () => {
    const { markdown } = capture('<p><a href="javascript:alert(1)">Click</a> <a href="data:text/html,evil">Data</a><a href="/safe" onclick="evil()">Safe</a></p><script>evil()</script>');
    expect(markdown).toContain('Click');
    expect(markdown).toContain('Data');
    expect(markdown).not.toMatch(/javascript:|data:text|evil/);
    expect(markdown).toContain('[Safe](https://example.com/safe)');
  });
});

describe('plain text, names and exports', () => {
  it('keeps plain Markdown exactly, including CRLF, leading spaces and trailing newline', () => {
    const text = '  # Hello\r\n\r\n    code\r\n';
    expect(convertCapture({ kind: 'paste', text, capturedAt: '' }).markdown).toBe(text);
  });
  it('prefers HTML without assigning the active page as paste source', () => {
    const result = capture('<h2>Clipboard</h2><p><a href="/relative">Link</a></p>', { kind: 'paste', sourceUrl: undefined, text: 'plain' });
    expect(result.filename).toBe('Clipboard');
    expect(result.markdown).toContain('[Link](/relative)');
    expect(result.markdown).not.toContain('example.com');
  });
  it('uses page title, element heading and useful fallbacks', () => {
    expect(capture('<h1>Heading</h1>').filename).toBe('Example');
    expect(capture('<h1>Heading</h1>', { kind: 'element' }).filename).toBe('Heading');
    expect(convertCapture({ kind: 'paste', text: '\n# Notes\nText', capturedAt: '' }).filename).toBe('Notes');
    expect(sanitizeFilename(' .md.md ')).toBe('untitled');
    expect(sanitizeFilename('CON.md')).toBe('_CON');
    expect(sanitizeFilename('name.md.')).toBe('name');
    expect(sanitizeFilename('bad/file:*?.md')).toBe('bad-file---');
    expect(Array.from(sanitizeFilename('😀'.repeat(90)))).toHaveLength(80);
  });
  it('uses a readable final URL segment when a captured page has no useful title', () => {
    const result = convertCapture({
      kind: 'page', html: '<p>Long body copy does not become the file name.</p>', title: '',
      sourceUrl: 'https://docs.example.test/guides/Persona%205-Royal/?campaign=mdfier#setup', capturedAt: '',
    });
    expect(result.filename).toBe('Persona 5 Royal');
  });
  it('never uses the current page URL as the name of pasted text', () => {
    const result = convertCapture({ kind: 'paste', text: '', sourceUrl: 'https://example.test/some-article?x=1', capturedAt: '' });
    expect(result.filename).toBe('untitled');
  });
  it('always appends stable metadata when a source URL exists', () => {
    const content = renderExport(draft);
    expect(content).toContain('Source: <https://example.com/>');
    expect(content).toContain('Captured: 2026-09-24T12:00:00.000Z');
    const legacyDraft: Draft & { includeSource: boolean } = { ...draft, includeSource: false };
    expect(renderExport(legacyDraft)).toBe(content);
    expect(renderExport({ ...draft, sourceUrl: undefined })).toBe(draft.markdown);
    expect(draft.markdown).not.toContain('Source:');
    expect(new TextDecoder().decode(new TextEncoder().encode(content))).toBe(content);
  });
});

describe('safe preview', () => {
  it('renders Markdown, escapes code and disables raw HTML and images', () => {
    const html = renderPreview('# Hello\n\n![remote](https://example.com/a.png)\n\n<img src="x" onerror="alert(1)">\n\n<script>alert(1)</script>\n\n```html\n<script>code</script>\n```');
    expect(html).toContain('<h1>Hello</h1>');
    const root = document.createElement('div'); root.innerHTML = html;
    expect(root.querySelector('img,script')).toBeNull();
    expect(root.querySelector('code')?.textContent).toBe('<script>code</script>\n');
  });
  it('blocks unsafe links and opens valid links safely', () => {
    const root = document.createElement('div');
    root.innerHTML = renderPreview('[bad](javascript:alert%281%29) [file](file:///etc/passwd) [ok](https://example.com)');
    const anchors = [...root.querySelectorAll('a')];
    expect(anchors[0]!.hasAttribute('href')).toBe(false);
    expect(anchors[1]!.hasAttribute('href')).toBe(false);
    expect(anchors[2]!.getAttribute('rel')).toBe('noopener noreferrer');
  });
});
