// Reproducible, anonymized Page/Block completeness corpus. It uses the real
// extraction and conversion modules, but no browser profile, page script, or
// network resource.
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { JSDOM } from 'jsdom';

const project = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const expectations = JSON.parse(readFileSync(join(project, 'tests', 'parser-lab', 'expectations.json'), 'utf8'));
const temporary = mkdtempSync(join(tmpdir(), 'mdfier-parser-lab-'));

function fixture({ records, landmark }) {
  const entries = Array.from({ length: records }, (_, index) => {
    const number = String(index + 1).padStart(3, '0');
    return `<div class="entry"><h2>Record ${number}</h2><p>Loaded route ${number}: keep this record in source order.</p><a href="/records/${number}">Reference ${number}</a></div>`;
  }).join('');
  const content = `<h1>Loaded field records</h1><p>Every already loaded record belongs to this document.</p><section id="log">${entries}</section><p>${expectations.tail}</p>`;
  return `<!doctype html><html><body><nav>Site navigation</nav>${landmark ? `<main><article>${content}</article></main>` : `<div class="content-shell">${content}</div>`}<footer>Footer links</footer></body></html>`;
}

try {
  await build({ entryPoints: [join(project, 'lib', 'extract.ts')], bundle: true, platform: 'node', format: 'esm', outfile: join(temporary, 'extract.mjs') });
  await build({ entryPoints: [join(project, 'lib', 'conversion.ts')], bundle: true, platform: 'node', format: 'esm', outfile: join(temporary, 'conversion.mjs') });
  const { extractCapture, extractPageCapture } = await import(pathToFileURL(join(temporary, 'extract.mjs')).href);
  const { convertCapture } = await import(pathToFileURL(join(temporary, 'conversion.mjs')).href);
  const reports = [];
  for (const sample of expectations.cases) {
    const dom = new JSDOM(fixture(sample), { url: `https://example.test/${sample.name}` });
    Object.assign(globalThis, { Node: dom.window.Node, NodeFilter: dom.window.NodeFilter, DOMParser: dom.window.DOMParser });
    const page = convertCapture(await extractPageCapture(dom.window.document)).markdown;
    const block = convertCapture(extractCapture(dom.window.document, 'element', dom.window.document.querySelector('#log'))).markdown;
    const expectedNumbers = Array.from({ length: sample.records }, (_, index) => String(index + 1).padStart(3, '0'));
    const numbers = [...page.matchAll(/Loaded route (\d+):/g)].map(match => match[1]);
    assert.deepEqual(numbers, expectedNumbers, `${sample.name}: Page must retain every record in order`);
    assert.equal([...block.matchAll(/Loaded route \d+:/g)].length, sample.records, `${sample.name}: Block must retain every record`);
    assert.ok(page.includes(expectations.tail), `${sample.name}: Page must retain the final paragraph`);
    reports.push({ name: sample.name, recordsInPage: numbers.length, recordsInBlock: sample.records, allInOrder: true });
    dom.window.close();
  }
  console.log(JSON.stringify({ environment: `Offline jsdom, Node ${process.version}; no installed extension or network.`, reports }, null, 2));
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
